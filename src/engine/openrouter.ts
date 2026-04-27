import OpenAI from 'openai';
import { getConfig } from '../commands/config';
import { writeDebugLog } from '../utils/debugLog';
import { normalizeEngineError } from '../utils/engineErrorHandler';
import { removeContentTags } from '../utils/removeContentTags';
import { AiEngine, AiEngineConfig } from './Engine';

interface OpenRouterConfig extends AiEngineConfig {}

interface OpenRouterErrorMeta {
  status?: number;
  code?: string;
  error?: unknown;
}

/**
 * OpenRouter engine using the OpenAI-compatible API.
 * Supports all models available on https://openrouter.ai including free tiers
 * (append :free to model name, e.g. google/gemma-3-27b-it:free).
 */
export class OpenRouterEngine implements AiEngine {
  client: OpenAI;

  constructor(public config: OpenRouterConfig) {
    const timeoutMs = (getConfig().OCO_GENERATION_TIMEOUT_SECONDS ?? 60) * 1000;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: timeoutMs,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/xwberry/opencommitx',
        'X-Title': 'OpenCommitX',
        ...(config.customHeaders || {})
      }
    });
  }

  public generateCommitMessage = async (
    messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam>
  ): Promise<string | null> => {
    const debugEnabled = Boolean(getConfig().OCO_DEBUG);
    try {
      const temperature = this.config.temperature ?? 0;
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        temperature,
        top_p: temperature === 0 ? 0.1 : undefined,
        max_tokens: this.config.maxTokensOutput
      });

      if (debugEnabled) {
        writeDebugLog({
          event: 'raw-api-response',
          provider: 'openrouter',
          model: this.config.model,
          response: {
            id: response.id,
            model: response.model,
            choices: response.choices.map((c) => ({
              finish_reason: c.finish_reason,
              message: c.message
            })),
            usage: response.usage
          }
        });
      }

      const content = response.choices[0]?.message?.content;
      const cleaned = removeContentTags(content ?? '', 'think');

      // If the cleaned result is empty but the raw content was not, it means
      // the model hit max_tokens inside a <think> block (reasoning filled the
      // entire output budget before producing a commit message).
      if (!cleaned && content) {
        if (debugEnabled) {
          writeDebugLog({
            event: 'thinking-truncated',
            provider: 'openrouter',
            model: this.config.model,
            meta: {
              finish_reason: response.choices[0]?.finish_reason,
              usage: response.usage,
              rawContentLength: content.length,
              hint: 'Model exhausted max_tokens inside <think> block. Increase OCO_TOKENS_MAX_OUTPUT or switch to a non-thinking model variant.'
            }
          });
        }
      }

      return cleaned || null;
    } catch (error) {
      if (debugEnabled) {
        const errMeta: OpenRouterErrorMeta =
          typeof error === 'object' && error !== null
            ? (error as OpenRouterErrorMeta)
            : {};
        writeDebugLog({
          event: 'api-error',
          provider: 'openrouter',
          model: this.config.model,
          error: error instanceof Error ? error.message : String(error),
          meta: {
            status: errMeta.status,
            code: errMeta.code,
            errorBody: errMeta.error
          }
        });
      }
      throw normalizeEngineError(error, 'openrouter', this.config.model);
    }
  };
}
