/**
 * Pure utility for splitting a diff string into token-budget-aware chunks.
 * No engine or LLM dependencies — safe to import in tests without mocking.
 */
import { tokenCount } from './tokenCount';

/**
 * Split a diff string into chunks where each chunk fits within maxChangeLength tokens.
 * Uses ~4 chars/token as the character budget for substring operations.
 *
 * Throws if maxChangeLength is <= 0 (would produce infinite chunks).
 */
export function splitDiff(diff: string, maxChangeLength: number): string[] {
  if (maxChangeLength <= 0) {
    throw new Error(
      `OCO_TOKENS_MAX_OUTPUT is set too high — no tokens left for the diff after the output budget.\n` +
      `  Try reducing OCO_TOKENS_MAX_OUTPUT: ocox config set OCO_TOKENS_MAX_OUTPUT 500`
    );
  }

  const lines = diff.split('\n');
  const splitDiffs: string[] = [];
  let currentDiff = '';

  for (let line of lines) {
    // If a single line exceeds maxChangeLength, split it into sub-lines.
    // maxChangeLength is in tokens; substring operates on characters.
    // Using ~4 chars/token as a conservative approximation.
    while (tokenCount(line) > maxChangeLength) {
      const charBudget = maxChangeLength * 4;
      const subLine = line.substring(0, charBudget);
      line = line.substring(charBudget);
      splitDiffs.push(subLine);
    }

    if (tokenCount(currentDiff) + tokenCount('\n' + line) > maxChangeLength) {
      splitDiffs.push(currentDiff);
      currentDiff = line;
    } else {
      currentDiff += '\n' + line;
    }
  }

  if (currentDiff) {
    splitDiffs.push(currentDiff);
  }

  return splitDiffs;
}
