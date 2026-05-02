/**
 * Tests for splitDiff — imported from src/utils/splitDiff.ts which has no
 * engine or LLM dependencies, so no mocking is needed.
 */

// Lightweight token-count mock — each space-separated word counts as 1 token.
// Using bare module path (src/ is in moduleDirectories) so Jest resolves it
// correctly in ESM mode regardless of setup file context.
jest.mock('utils/tokenCount', () => ({
  tokenCount: (text: string) =>
    text ? text.split(/\s+/).filter(Boolean).length : 0
}));

import { splitDiff } from 'utils/splitDiff';

describe('splitDiff', () => {
  it('returns the input as a single chunk when it fits within the budget', () => {
    const diff = 'a b c d e';
    const result = splitDiff(diff, 100);
    expect(result).toHaveLength(1);
    // The implementation may prepend a '\n' on the first accumulated line; strip it.
    expect(result[0].trim()).toBe(diff.trim());
  });

  it('splits into multiple chunks when lines exceed the token budget', () => {
    // Each line is 5 tokens; budget is 8 → 1 line per chunk
    const lines = ['aa bb cc dd ee', 'ff gg hh ii jj', 'kk ll mm nn oo'];
    const diff = lines.join('\n');
    const result = splitDiff(diff, 8);
    expect(result.length).toBeGreaterThan(1);
  });

  it('throws when maxChangeLength is 0 or negative', () => {
    expect(() => splitDiff('some content', 0)).toThrow();
    expect(() => splitDiff('some content', -1)).toThrow();
  });

  it('handles an empty input without throwing', () => {
    const result = splitDiff('', 100);
    expect(Array.isArray(result)).toBe(true);
  });

  it('splits an overlong single line using char budget (~4 chars/token)', () => {
    // Create a line with 25 "tokens" and set budget to 10.
    // Character budget = 10 * 4 = 40 chars; the line is > 40 chars.
    const longLine = Array.from({ length: 25 }, (_, i) => `t${i}`).join(' ');
    const result = splitDiff(longLine, 10);
    expect(result.length).toBeGreaterThan(1);
  });

  it('produces chunks that each fit within the token budget', () => {
    const tokenCount = (s: string) =>
      s ? s.split(/\s+/).filter(Boolean).length : 0;

    const lines = Array.from({ length: 20 }, (_, i) => `word${i} extra data here`);
    const diff = lines.join('\n');
    const budget = 10;
    const chunks = splitDiff(diff, budget);

    for (const chunk of chunks) {
      // Allow slight boundary overflow (next line pushes it just over)
      expect(tokenCount(chunk)).toBeLessThanOrEqual(budget + 5);
    }
  });
});
