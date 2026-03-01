export type CommitStrategy = 'single' | 'sequential';

export interface CommitGroupPlan {
  files: string[];
  message: string;
}

/**
 * Pairs each file group with the LLM-generated message for that group.
 * Index alignment is the contract: group[i].files are always committed with messages[i].
 * Extracting this as a pure function makes the association explicitly testable.
 */
export function buildCommitPlan(
  fileGroups: Array<{ files: string[] }>,
  messages: string[]
): CommitGroupPlan[] {
  if (fileGroups.length !== messages.length) {
    throw new RangeError(
      `buildCommitPlan: fileGroups.length (${fileGroups.length}) !== messages.length (${messages.length})`
    );
  }
  return fileGroups.map((group, i) => ({
    files: group.files,
    message: messages[i]
  }));
}

/**
 * Combines multiple per-file commit messages into one message string,
 * separated by double newlines (used when OCO_MULTI_COMMIT_STRATEGY=single).
 */
export function combineCommitMessages(messages: string[]): string {
  return messages.join('\n\n');
}

/**
 * Returns whether the given strategy value is valid.
 */
export function isValidCommitStrategy(value: string): value is CommitStrategy {
  return value === 'single' || value === 'sequential';
}
