/**
 * Utilities for splitting large diffs into token-budget-aware chunks.
 * Pure splitDiff lives in ./splitDiff (no engine deps) and is re-exported here.
 */
import { OpenAI } from 'openai';
import { getEngine } from './engine';
import { mergeDiffs } from './mergeDiffs';
import { tokenCount } from './tokenCount';

export { splitDiff } from './splitDiff';
import { splitDiff } from './splitDiff';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Build per-hunk message promises for a single file's diff.
 * Splits the file diff by @@ hunk headers, merges hunks to fill token budget,
 * then creates one LLM promise per merged chunk.
 */
export function getMessagesPromisesByChangesInFile(
  fileDiff: string,
  separator: string,
  maxChangeLength: number,
  buildMessages: (diff: string) => Promise<ChatMessage[]>
): Promise<string | null | undefined>[] {
  const hunkHeaderSeparator = '@@ ';
  const [fileHeader, ...fileDiffByLines] = fileDiff.split(hunkHeaderSeparator);

  const mergedChanges = mergeDiffs(
    fileDiffByLines.map((line) => hunkHeaderSeparator + line),
    maxChangeLength
  );

  const lineDiffsWithHeader: string[] = [];
  for (const change of mergedChanges) {
    const totalChange = fileHeader + change;
    if (tokenCount(totalChange) > maxChangeLength) {
      const splitChanges = splitDiff(totalChange, maxChangeLength);
      lineDiffsWithHeader.push(...splitChanges);
    } else {
      lineDiffsWithHeader.push(totalChange);
    }
  }

  const engine = getEngine();
  return lineDiffsWithHeader.map(async (lineDiff) => {
    const messages = await buildMessages(separator + lineDiff);
    return engine.generateCommitMessage(messages);
  });
}

/**
 * Split a multi-file diff by file, merge files to fill token budget, then
 * return one promise array with a commit message per merged chunk.
 */
export async function getCommitMsgsPromisesFromFileDiffs(
  diff: string,
  maxDiffLength: number,
  buildMessages: (diff: string) => Promise<ChatMessage[]>
): Promise<Promise<string | null | undefined>[]> {
  const separator = 'diff --git ';
  const diffByFiles = diff
    .split(separator)
    .slice(1)
    .map((s) => separator + s);
  const mergedFilesDiffs = mergeDiffs(diffByFiles, maxDiffLength);

  const commitMessagePromises: Promise<string | null | undefined>[] = [];

  for (const fileDiff of mergedFilesDiffs) {
    if (tokenCount(fileDiff) > maxDiffLength) {
      const messagesPromises = getMessagesPromisesByChangesInFile(
        fileDiff,
        separator,
        maxDiffLength,
        buildMessages
      );
      commitMessagePromises.push(...messagesPromises);
    } else {
      const messages = await buildMessages(fileDiff);
      const engine = getEngine();
      commitMessagePromises.push(engine.generateCommitMessage(messages));
    }
  }

  return commitMessagePromises;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
