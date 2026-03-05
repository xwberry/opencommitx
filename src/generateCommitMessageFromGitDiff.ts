import { select, confirm, isCancel } from '@clack/prompts';
import chalk from 'chalk';
import { OpenAI } from 'openai';
import {
  DEFAULT_TOKEN_LIMITS,
  getConfig,
  setGlobalConfig,
  getGlobalConfig,
  MODEL_LIST,
  RECOMMENDED_MODELS
} from './commands/config';
import { getMainCommitPrompt } from './prompts';
import { getEngine } from './utils/engine';
import {
  isModelNotFoundError,
  getSuggestedModels,
  ModelNotFoundError
} from './utils/errors';
import { mergeDiffs } from './utils/mergeDiffs';
import { tokenCount } from './utils/tokenCount';
import { writeDebugLog } from './utils/debugLog';
import {
  changedNamesFromDiff,
  extractPythonDocstrings
} from './utils/pythonDocstringExtractor';

// Note: config is intentionally read inside each function call, not at module
// load time, so that runtime config changes (e.g. --dry-run flag) are respected.

const generateCommitMessageChatCompletionPrompt = async (
  diff: string,
  fullGitMojiSpec: boolean,
  context: string = ''
): Promise<Array<OpenAI.Chat.Completions.ChatCompletionMessageParam>> => {
  const INIT_MESSAGES_PROMPT = await getMainCommitPrompt(
    fullGitMojiSpec,
    context
  );

  const chatContextAsCompletionRequest = [...INIT_MESSAGES_PROMPT];

  chatContextAsCompletionRequest.push({
    role: 'user',
    content: diff
  });

  return chatContextAsCompletionRequest;
};

export enum GenerateCommitMessageErrorEnum {
  tooMuchTokens = 'TOO_MUCH_TOKENS',
  internalError = 'INTERNAL_ERROR',
  emptyMessage = 'EMPTY_MESSAGE',
  outputTokensTooHigh = `Token limit exceeded, OCO_TOKENS_MAX_OUTPUT must not be much higher than the default ${DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_OUTPUT} tokens.`
}

async function handleModelNotFoundError(
  error: Error,
  provider: string,
  currentModel: string
): Promise<string | null> {
  console.log(
    chalk.red(`\n✖ Model '${currentModel}' not found\n`)
  );

  const suggestedModels = getSuggestedModels(provider, currentModel);
  const recommended =
    RECOMMENDED_MODELS[provider as keyof typeof RECOMMENDED_MODELS];

  if (suggestedModels.length === 0) {
    console.log(
      chalk.yellow(
        `No alternative models available. Run 'ocox setup' to configure a different model.`
      )
    );
    return null;
  }

  const options: Array<{ value: string; label: string }> = [];

  // Add recommended first if available
  if (recommended && suggestedModels.includes(recommended)) {
    options.push({
      value: recommended,
      label: `${recommended} (Recommended)`
    });
  }

  // Add other suggestions
  suggestedModels
    .filter((m) => m !== recommended)
    .forEach((model) => {
      options.push({ value: model, label: model });
    });

  options.push({ value: '__custom__', label: 'Enter custom model...' });

  const selection = await select({
    message: 'Select an alternative model:',
    options
  });

  if (isCancel(selection)) {
    return null;
  }

  let newModel: string;
  if (selection === '__custom__') {
    const { text } = await import('@clack/prompts');
    const customModel = await text({
      message: 'Enter model name:',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Model name is required';
        }
        return undefined;
      }
    });

    if (isCancel(customModel)) {
      return null;
    }
    newModel = customModel as string;
  } else {
    newModel = selection as string;
  }

  // Ask if user wants to save as default
  const saveAsDefault = await confirm({
    message: 'Save as default model?'
  });

  if (!isCancel(saveAsDefault) && saveAsDefault) {
    const existingConfig = getGlobalConfig();
    setGlobalConfig({
      ...existingConfig,
      OCO_MODEL: newModel
    } as any);
    console.log(chalk.green('✔') + ' Model saved as default\n');
  }

  return newModel;
}

const ADJUSTMENT_FACTOR = 20;

/**
 * For Python files in the diff that are NOT in whole-file docstring mode,
 * extract the docstrings of changed functions and append them as context.
 * This helps the LLM understand intent for partial refactors without replacing
 * the actual diff.  Only adds context if it fits within the remaining token budget.
 */
function enrichDiffWithPythonDocstrings(
  diff: string,
  tokenBudget: number,
  docstringMode: string | undefined
): string {
  if (docstringMode === 'never') return diff;

  // Find distinct Python files in this diff
  const pyFileMatches = [...diff.matchAll(/^diff --git a\/.+ b\/(.+\.py)$/gm)];
  if (pyFileMatches.length === 0) return diff;

  const contextSections: string[] = [];
  const changedNames = changedNamesFromDiff(diff);
  if (changedNames.length === 0) return diff;

  for (const match of pyFileMatches) {
    const filepath = match[1];
    const docContext = extractPythonDocstrings(filepath, changedNames);
    if (docContext) contextSections.push(docContext);
  }

  if (contextSections.length === 0) return diff;

  const contextBlock =
    '\n\n# Python docstring context for changed functions:\n' +
    contextSections.join('\n\n');

  if (tokenCount(diff + contextBlock) <= tokenBudget) {
    return diff + contextBlock;
  }

  return diff;
}

export const generateCommitMessageByDiff = async (
  diff: string,
  fullGitMojiSpec: boolean = false,
  context: string = '',
  retryWithModel?: string
): Promise<string> => {
  const currentConfig = getConfig();
  const provider = currentConfig.OCO_AI_PROVIDER || 'openai';
  const currentModel = retryWithModel || currentConfig.OCO_MODEL;
  const MAX_TOKENS_INPUT = currentConfig.OCO_TOKENS_MAX_INPUT;
  const MAX_TOKENS_OUTPUT = currentConfig.OCO_TOKENS_MAX_OUTPUT;
  const debugEnabled = Boolean(currentConfig.OCO_DEBUG);

  try {
    const INIT_MESSAGES_PROMPT = await getMainCommitPrompt(
      fullGitMojiSpec,
      context
    );

    const INIT_MESSAGES_PROMPT_LENGTH = INIT_MESSAGES_PROMPT.map(
      (msg) => tokenCount(msg.content as string) + 4
    ).reduce((a, b) => a + b, 0);

    // OCO_TOKENS_MAX_INPUT is the input token budget (diff + prompt).
    // OCO_TOKENS_MAX_OUTPUT is passed as max_tokens to the API independently.
    // They are NOT subtracted from each other — the API enforces them as
    // separate limits.
    const MAX_REQUEST_TOKENS =
      MAX_TOKENS_INPUT - ADJUSTMENT_FACTOR - INIT_MESSAGES_PROMPT_LENGTH;

    if (MAX_REQUEST_TOKENS <= 0) {
      throw new Error(
        `OCO_TOKENS_MAX_INPUT (${MAX_TOKENS_INPUT}) is too low — it leaves no room for the diff.\n` +
          `  Prompt overhead: ${INIT_MESSAGES_PROMPT_LENGTH + ADJUSTMENT_FACTOR}\n` +
          `  Try: ocox config set OCO_TOKENS_MAX_INPUT 4096`
      );
    }

    const diffTokens = tokenCount(diff);
    if (debugEnabled) {
      writeDebugLog({
        event: 'routing',
        provider,
        model: currentModel,
        meta: {
          diffTokens,
          maxRequestTokens: MAX_REQUEST_TOKENS,
          maxInputTokens: MAX_TOKENS_INPUT,
          maxOutputTokens: MAX_TOKENS_OUTPUT,
          promptOverhead: INIT_MESSAGES_PROMPT_LENGTH + ADJUSTMENT_FACTOR,
          path: diffTokens >= MAX_REQUEST_TOKENS ? 'large-diff' : 'normal'
        }
      });
    }

    if (diffTokens >= MAX_REQUEST_TOKENS) {
      // When the payload is pre-processed content (docstrings, not a raw git
      // diff), chunking it into arbitrary pieces produces garbage commit
      // messages.  Detect this case by the absence of `diff --git ` headers
      // and instead truncate to the token budget, sending as a single request.
      const isRawGitDiff = diff.includes('diff --git ');
      if (!isRawGitDiff) {
        // Line-based truncation: remove trailing lines until content fits.
        const lines = diff.split('\n');
        let truncated = diff;
        while (tokenCount(truncated) >= MAX_REQUEST_TOKENS && lines.length > 1) {
          lines.pop();
          truncated = lines.join('\n');
        }
        if (debugEnabled) {
          writeDebugLog({
            event: 'pre-processed-truncated',
            provider,
            model: currentModel,
            meta: {
              originalTokens: diffTokens,
              truncatedTokens: tokenCount(truncated),
              maxRequestTokens: MAX_REQUEST_TOKENS
            }
          });
        }
        const truncMessages = await generateCommitMessageChatCompletionPrompt(
          truncated,
          fullGitMojiSpec,
          context
        );
        if (debugEnabled) {
          writeDebugLog({
            event: 'llm-request-pre-processed',
            provider,
            model: currentModel,
            messages: truncMessages,
            meta: { truncatedTokens: tokenCount(truncated) }
          });
        }
        const truncEngine = getEngine();
        const truncCommit = await truncEngine.generateCommitMessage(truncMessages);
        if (debugEnabled) {
          writeDebugLog({
            event: 'llm-response-pre-processed',
            provider,
            model: currentModel,
            response: truncCommit,
            meta: { empty: !truncCommit }
          });
        }
        if (truncCommit) return truncCommit;
      }

      // For Python files: before falling back to chunk-and-join (which produces
      // repetitive multi-block messages), try extracting docstrings. Docstrings
      // give the LLM a concise structural summary in one request.
      if (currentConfig.OCO_PYTHON_DOCSTRING_MODE !== 'never') {
        const pyFiles = [
          ...diff.matchAll(/^diff --git a\/.+ b\/(.+\.py)$/gm)
        ].map((m) => m[1]);

        if (pyFiles.length > 0) {
          const changedNames = changedNamesFromDiff(diff);
          const docSections = pyFiles.flatMap((f) => {
            const doc = extractPythonDocstrings(
              f,
              changedNames.length > 0 ? changedNames : undefined
            );
            return doc ? [doc] : [];
          });

          if (docSections.length > 0) {
            // Include the per-file diff headers (new file / modified / renamed)
            // so the model knows what kind of change this is, even without hunks.
            const diffHeaders = pyFiles
              .map((f) => {
                const section = diff
                  .split('diff --git ')
                  .find((s) => s.includes(`b/${f}`));
                if (!section) return '';
                return ('diff --git ' + section.split('@@')[0]).trimEnd();
              })
              .filter(Boolean)
              .join('\n\n');

            const docPayload =
              (diffHeaders ? diffHeaders + '\n\n' : '') +
              '# Python docstring context (diff too large to send in full):\n' +
              docSections.join('\n\n');

            if (tokenCount(docPayload) < MAX_REQUEST_TOKENS) {
              const docMessages = await generateCommitMessageChatCompletionPrompt(
                docPayload,
                fullGitMojiSpec,
                context
              );
              const docEngine = getEngine();
              if (debugEnabled) {
                writeDebugLog({
                  event: 'llm-request-docstring-fallback',
                  provider,
                  model: currentModel,
                  messages: docMessages,
                  meta: { docFiles: pyFiles, tokenCount: tokenCount(docPayload) }
                });
              }
              const docCommit = await docEngine.generateCommitMessage(docMessages);
              if (debugEnabled) {
                writeDebugLog({
                  event: 'llm-response-docstring-fallback',
                  provider,
                  model: currentModel,
                  response: docCommit,
                  meta: { empty: !docCommit }
                });
              }
              if (docCommit) return docCommit;
            }
          }
        }
      }

      const commitMessagePromises = await getCommitMsgsPromisesFromFileDiffs(
        diff,
        MAX_REQUEST_TOKENS,
        fullGitMojiSpec
      );

      const commitMessages = [] as string[];
      for (const [i, promise] of commitMessagePromises.entries()) {
        const msg = (await promise) as string;
        if (debugEnabled) {
          writeDebugLog({
            event: 'chunked-response',
            provider,
            model: currentModel,
            response: msg,
            meta: {
              chunkIndex: i,
              totalChunks: commitMessagePromises.length,
              empty: !msg
            }
          });
        }
        commitMessages.push(msg);
        await delay(2000);
      }

      return commitMessages.join('\n\n');
    }

    const enrichedDiff = enrichDiffWithPythonDocstrings(
      diff,
      MAX_REQUEST_TOKENS,
      currentConfig.OCO_PYTHON_DOCSTRING_MODE
    );

    const messages = await generateCommitMessageChatCompletionPrompt(
      enrichedDiff,
      fullGitMojiSpec,
      context
    );

    const engine = getEngine();

    if (debugEnabled) {
      writeDebugLog({
        event: 'llm-request',
        provider,
        model: currentModel,
        messages,
        meta: {
          diffTokenCount: diffTokens,
          maxRequestTokens: MAX_REQUEST_TOKENS
        }
      });
    }

    const commitMessage = await engine.generateCommitMessage(messages);

    if (debugEnabled) {
      writeDebugLog({
        event: 'llm-response',
        provider,
        model: currentModel,
        response: commitMessage,
        meta: { empty: !commitMessage }
      });
    }

    if (!commitMessage) {
      const isThinkingModel =
        currentModel?.includes('thinking') ||
        currentModel?.includes(':thinking') ||
        currentModel?.includes('-think');
      const thinkingHint = isThinkingModel
        ? `\n  This model uses reasoning/thinking tokens. The model may have hit the token\n` +
          `  limit before generating any output. Try: ocox config set OCO_TOKENS_MAX_OUTPUT 2000\n` +
          `  Or switch to a non-thinking model.`
        : '';
      throw new Error(
        `${GenerateCommitMessageErrorEnum.emptyMessage}\n` +
          `  Provider: ${provider}, Model: ${currentModel}\n` +
          `  The model returned an empty response. This can happen when:\n` +
          `    - The model hit its token limit before generating output (finish_reason: length)${thinkingHint}\n` +
          `    - The model hit a content policy or safety filter\n` +
          `  Try a different model or adjust: ocox config set OCO_TOKENS_MAX_OUTPUT 1000\n` +
          (debugEnabled
            ? `  Debug logs written to ~/.opencommitx-data/debug/`
            : `  Enable debug logging: ocox config set OCO_DEBUG true`)
      );
    }

    return commitMessage;
  } catch (error) {
    // Handle model-not-found errors with interactive recovery
    if (isModelNotFoundError(error)) {
      const newModel = await handleModelNotFoundError(
        error as Error,
        provider,
        currentModel
      );

      if (newModel) {
        console.log(chalk.cyan(`Retrying with ${newModel}...\n`));
        const existingConfig = getGlobalConfig();
        setGlobalConfig({
          ...existingConfig,
          OCO_MODEL: newModel
        } as any);

        return generateCommitMessageByDiff(
          diff,
          fullGitMojiSpec,
          context,
          newModel
        );
      }
    }

    // If a fallback model is configured and we haven't already retried, try it.
    const fallbackModel = currentConfig.OCO_FALLBACK_MODEL;
    const fallbackProvider = currentConfig.OCO_FALLBACK_PROVIDER;
    if (fallbackModel && !retryWithModel) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isRetriable =
        errMsg.includes('rate limit') ||
        errMsg.includes('429') ||
        errMsg.includes('overloaded') ||
        errMsg.includes('unavailable') ||
        errMsg.includes('timeout') ||
        isModelNotFoundError(error);
      if (isRetriable) {
        console.log(chalk.yellow(`Primary model failed. Retrying with fallback: ${fallbackModel}\n`));
        const existingConfig = getGlobalConfig();
        setGlobalConfig({
          ...existingConfig,
          OCO_MODEL: fallbackModel,
          ...(fallbackProvider ? { OCO_AI_PROVIDER: fallbackProvider as any } : {})
        } as any);
        try {
          return await generateCommitMessageByDiff(diff, fullGitMojiSpec, context, fallbackModel);
        } finally {
          // Restore original model/provider so subsequent calls use the user's config.
          setGlobalConfig(existingConfig);
        }
      }
    }

    throw error;
  }
};

function getMessagesPromisesByChangesInFile(
  fileDiff: string,
  separator: string,
  maxChangeLength: number,
  fullGitMojiSpec: boolean
) {
  const hunkHeaderSeparator = '@@ ';
  const [fileHeader, ...fileDiffByLines] = fileDiff.split(hunkHeaderSeparator);

  // merge multiple line-diffs into 1 to save tokens
  const mergedChanges = mergeDiffs(
    fileDiffByLines.map((line) => hunkHeaderSeparator + line),
    maxChangeLength
  );

  const lineDiffsWithHeader = [] as string[];
  for (const change of mergedChanges) {
    const totalChange = fileHeader + change;
    if (tokenCount(totalChange) > maxChangeLength) {
      // If the totalChange is too large, split it into smaller pieces
      const splitChanges = splitDiff(totalChange, maxChangeLength);
      lineDiffsWithHeader.push(...splitChanges);
    } else {
      lineDiffsWithHeader.push(totalChange);
    }
  }

  const engine = getEngine();
  const commitMsgsFromFileLineDiffs = lineDiffsWithHeader.map(
    async (lineDiff) => {
      const messages = await generateCommitMessageChatCompletionPrompt(
        separator + lineDiff,
        fullGitMojiSpec
      );

      return engine.generateCommitMessage(messages);
    }
  );

  return commitMsgsFromFileLineDiffs;
}

function splitDiff(diff: string, maxChangeLength: number) {
  const lines = diff.split('\n');
  const splitDiffs = [] as string[];
  let currentDiff = '';

  if (maxChangeLength <= 0) {
    throw new Error(GenerateCommitMessageErrorEnum.outputTokensTooHigh);
  }

  for (let line of lines) {
    // If a single line exceeds maxChangeLength, split it into multiple lines.
    // maxChangeLength is in tokens; substring operates on characters.
    // Using ~4 chars/token as an approximate conversion (conservative).
    while (tokenCount(line) > maxChangeLength) {
      const charBudget = maxChangeLength * 4;
      const subLine = line.substring(0, charBudget);
      line = line.substring(charBudget);
      splitDiffs.push(subLine);
    }

    // Check the tokenCount of the currentDiff and the line separately
    if (tokenCount(currentDiff) + tokenCount('\n' + line) > maxChangeLength) {
      // If adding the next line would exceed the maxChangeLength, start a new diff
      splitDiffs.push(currentDiff);
      currentDiff = line;
    } else {
      // Otherwise, add the line to the current diff
      currentDiff += '\n' + line;
    }
  }

  // Add the last diff
  if (currentDiff) {
    splitDiffs.push(currentDiff);
  }

  return splitDiffs;
}

export const generateCommitMessagesPerFile = generateCommitMessageByDiff;

export const getCommitMsgsPromisesFromFileDiffs = async (
  diff: string,
  maxDiffLength: number,
  fullGitMojiSpec: boolean
) => {
  const separator = 'diff --git ';

  const diffByFiles = diff.split(separator).slice(1);

  // merge multiple files-diffs into 1 prompt to save tokens
  const mergedFilesDiffs = mergeDiffs(diffByFiles, maxDiffLength);

  const commitMessagePromises = [] as Promise<string | null | undefined>[];

  for (const fileDiff of mergedFilesDiffs) {
    if (tokenCount(fileDiff) >= maxDiffLength) {
      // if file-diff is bigger than gpt context — split fileDiff into lineDiff
      const messagesPromises = getMessagesPromisesByChangesInFile(
        fileDiff,
        separator,
        maxDiffLength,
        fullGitMojiSpec
      );

      commitMessagePromises.push(...messagesPromises);
    } else {
      const messages = await generateCommitMessageChatCompletionPrompt(
        separator + fileDiff,
        fullGitMojiSpec
      );

      const engine = getEngine();
      commitMessagePromises.push(engine.generateCommitMessage(messages));
    }
  }

  return commitMessagePromises;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
