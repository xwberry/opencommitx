Fetch the latest CodeRabbit review comments for the current PR and address them.

## Steps

1. Determine the current PR number and repo:

   ```bash
   gh pr view --json number,headRepository --jq '{number: .number, repo: (.headRepository.nameWithOwner)}'
   ```

   If no PR exists for the current branch, tell the user and stop.

2. Fetch unresolved CodeRabbit review comments using `gh pr-review` (always redirect output to a file, then read it — large payloads truncate in the terminal):

   ```bash
   # Windows (bash in Claude Code)
   gh pr-review review view --reviewer coderabbitai --unresolved --not_outdated --tail 2 -R <owner/repo> --pr <number> > "$TEMP/review_comments.json"
   ```

   If `gh pr-review` is not installed, tell the user:
   "Install the gh-pr-review extension: `gh extension install agynio/gh-pr-review`"

3. Parse the JSON output with Python (use `encoding='utf-8'` and `sys.stdout.reconfigure(encoding='utf-8')`). Identify the **most recent review**: the last element in the `reviews` array.

4. Build the full comment list from **two sources**, but only from the most recent review:

   **Source A — Inline threads** (already in the JSON): all objects in `reviews[-1].comments` where `is_resolved=false` and `is_outdated=false`.

   **Source B — Review body** of `reviews[-1]` only: parse the markdown body for two embedded sections:
   - `🧹 Nitpick comments (N)` — comments that CodeRabbit marked as nitpicks (too minor for inline posting)
   - ` Duplicate comments (N)` — comments that CodeRabbit found in previous reviews but were not flagged as fixed in the latest diff review. These may have been intentionally deferred or skipped, but often these are legitimate comments that it may not have actually surfaced in earlier reviews.
   - `⚠️ Outside diff range comments (N)` — comments on lines outside the PR diff

   Extract each item from these sections: file path, line range, severity, and description.

   **Skip the body of all older reviews entirely** — those have already been triaged in prior passes.

5. **Deduplicate**: if a file + approximate line range from a body comment (Source B) matches one already present in the inline threads (Source A), drop the body entry — it's the same issue posted twice.

6. If there are no comments after deduplication, report that and stop.

7. For each comment (inline or body):
   - Read the file referenced in the comment
   - Understand the suggestion or issue raised
   - Evaluate whether the suggestion is valid and worth implementing
   - If valid: make the code change
   - If not valid or a matter of style preference: skip it and note why

8. After addressing all comments, provide a summary:
   - Which comments were addressed (with brief description of changes)
   - Which comments were skipped and why
   - Suggest the user review the changes, then push and resolve threads

9. After making a code change, reply to the corresponding inline thread (Source A only — body comments have no thread ID):

   ```bash
   gh pr-review comments reply <pr-number> -R <owner/repo> --thread-id <PRRT_...> --body "Addressed in <commit-sha>"
   ```
