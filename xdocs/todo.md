# New April 2026

- Rate limit error not being caught in the model fallback logic
  - C:\Users\XanderBerry\OneDrive - Fullsteam Operations LLC\Programming Projects\opencommitx\opencommitx\out\cli.cjs:74946
  return new RateLimitError2(provider, retryAfter, message);
   ^
  RateLimitError2: 429 Provider returned error
  at normalizeEngineError (C:\Users\XanderBerry\OneDrive - Fullsteam Operations LLC\Programming Projects\opencommitx\opencommitx\out\cli.cjs:74946:14)
  at OpenRouterEngine.generateCommitMessage (C:\Users\XanderBerry\OneDrive - Fullsteam Operations LLC\Programming Projects\opencommitx\opencommitx\out\cli.cjs:87446:15)
  at process.processTicksAndRejections (node:internal/process/task_queues:103:5) {
  provider: 'openrouter',
  retryAfter: undefined
  }
  Node.js v22.22.2
- Check directory to see if pre-commit hooks are installed. if they are, enable a pre-processing pipeline via toggle in config:
  - Store index of staged files
  - git add -A
  - pre-commit run
  - if failures, run the above 2 steps again
  - if no failures after 1st or 2nd run
    - git restore --staged .
    - re-stage the index of staged files from step 1
  - run through normal commit message generating pipeline
    - when committing messages, pass --no-verify flag to git commit
- Figure out with TOO_MUCH_TOKENS error means - it looks like it's getting thrown by the package itself rather than the anthropic API maybe?
  - This seems to come even if I use very high token settings
- Edit commit message doesn't really work - it only shows 1 line and if the edit to a line is accepted, that's the whole commit message.
- Check what the latest updates to OCO are and determine if they should be folded in.
- When committing from a cwd somewhere in the repo, it fails with a pathspec error because it tries to add the files as if sourced from the CWD.
- Fix  [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.

# March 2026

- add dynamic provider utility to route specific requests to different APIs
  - Fallback model on rate-limit/model-not-found: `OCO_FALLBACK_MODEL` + `OCO_FALLBACK_PROVIDER` config keys. `generateCommitMessageByDiff` retries with the fallback engine on retriable errors.
- For the long python files, if the diff length is the same as the length of the file (maybe have a buffer for empty or skipped lines) then use the docstring script. otherwise this will just read docstrings on comprehensive refactors. — Implemented via `OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO` (default 0.9): docstring extraction only activates when `addedLines / totalFileLines >= ratio`. Deleted lines excluded — a refactor with many deletions will not trigger.
- consider changing home directory file operations to a dedicated .opencommitx directory rather than individual files, since this version may save multiple files. — Implemented: all cache files now live in `~/.opencommitx/cache-<repo>-<hash>.json`.
- Fix incorrect version check warning (was querying `opencommit` npm package instead of `opencommitx`).
- Fix hang during multi-commit generation: switched `Promise.all` to sequential `for...of` in `generatePerFileCommits` to avoid concurrent `@clack/prompts` spinner + git subprocess + WASM conflicts.
- Fix Ctrl+C not working during generation: added `SIGINT` handler around spinner that stops the spinner and exits cleanly.
- Add 60s timeout to OpenRouter engine as a defensive measure against silent API hangs.
- Bump version to 1.0.1.
- Fix docstring ratio: was using `added + deleted` lines, causing comprehensive refactors to incorrectly trigger whole-file mode. Now uses `added` lines only.
- Fix `ocox config set KEY VALUE` (space-separated): parser now normalises adjacent non-`=` args into `KEY=VALUE` before splitting.
- Cache: moved to `~/.opencommitx/cache-<repo>-<hash>.json` (per-repo); `files` field now inferred from diff when not supplied; each group message is cached individually before commit attempts.
- Add partially-staged file warning: files with both staged and unstaged changes are flagged before message generation.
- Fix `performCommit` spinner: now stops on commit failure; pre-commit hook output surfaced cleanly; advisory message tells user to re-stage reformatted files.
- Expand `extract_docstrings.py` with `--changed <names>` argument; TypeScript now parses `@@` hunk headers to pass changed function names, enriching partial-refactor diffs with relevant docstrings without replacing the diff.
- Pre-commit visual feedback: spinner message now streams live stderr from `git commit` (shows hook progress); a note is shown before the commit if `.pre-commit-config.yaml` is detected.
- Formatter-tolerant cache hash: diff content lines are whitespace-normalised before hashing so ruff/black formatting changes do not cause cache misses.
- Docstring fallback for large Python diffs: when a Python diff exceeds the token limit (would have been chunked), docstrings are extracted first and sent as a single request — avoiding the repetitive multi-block chunked messages.
- Fix `TypeError: Cannot read properties of undefined (reading 'length')` when `OCO_TOKENS_MAX_OUTPUT` is set too high: guarded `mergeDiffs` against empty arrays and added an early `MAX_REQUEST_TOKENS <= 0` check with a descriptive error message.
- Better EMPTY_MESSAGE error: now includes provider, model, and actionable suggestions; all `oco setup` references updated to `ocox setup`.
- Debug mode (`OCO_DEBUG=true` or `ocox config set OCO_DEBUG true`): writes full LLM prompts and responses to `~/.opencommitx/debug/` as timestamped JSON files.
- Docstring mode visibility: spinner now shows which files are being processed and flags when docstring mode is active for a file group.
- Fix debug log not writing: `writeDebugLog` now requires the caller to pass the `debugEnabled` flag (read from the already-loaded config) instead of using a dynamic `require()` that fails in the esbuild bundle. Debug calls in `generateCommitMessageByDiff` are gated behind `currentConfig.OCO_DEBUG`.
- Better empty-response error for thinking models: detects model names containing "thinking"/"think" and adds a note that reasoning tokens consume the budget before output is produced.
- 90s per-group generation timeout: `Promise.race` ensures the process can exit if the LLM/network stalls. Added `SIGBREAK` handler for Windows terminals (e.g. PowerShell pixi shell) where Ctrl+C may not deliver SIGINT.
- Fix Ctrl+C latency: `tokenCount()` was creating a new `Tiktoken` WASM instance on every call, blocking the event loop for hundreds of ms per invocation and queuing SIGINT until WASM returned. Now uses a module-level singleton — WASM initialises once, subsequent calls run the encoder only (orders of magnitude faster).
- Fix debug mode not producing log files: `writeDebugLog` was silently swallowing all errors via a bare `catch {}`; now prints to `process.stderr` so path/permission failures are visible. Added a top-of-function `routing` debug log entry (fires before any model call) showing `diffTokens`, `maxRequestTokens`, and `path` (normal vs large-diff). Added `chunked-response` debug log entries in the chunked path — previously the chunked code path had zero debug coverage.
- Fix docstring fallback for new Python files: when the diff is too large and the docstring fallback is used, the payload now includes the git diff file header (shows `new file mode`, `--- /dev/null`, etc.) so the model understands the change type rather than just seeing abstract docstrings and echoing the few-shot example.
- Fix "Sequential strategy would omit staged files" error: files excluded from `git diff` by `.gitattributes` (e.g. `pixi.lock`, `package-lock.json`) are staged but never appear in any file group. Previously this threw a hard error. Now they are noted to the user and appended to the last commit group so they are committed rather than dropped.
- Fix premature chunking: `MAX_REQUEST_TOKENS` was incorrectly computed as `OCO_TOKENS_MAX_INPUT - promptOverhead - OCO_TOKENS_MAX_OUTPUT`, meaning a large output setting (e.g. 5000) would eat most of the input budget and trigger chunking on diffs that comfortably fit. `OCO_TOKENS_MAX_INPUT` and `OCO_TOKENS_MAX_OUTPUT` are independent API limits — output tokens are not reserved from the input budget. Formula is now `OCO_TOKENS_MAX_INPUT - promptOverhead` only.
- Add raw API response logging to OpenRouter engine: `raw-api-response` debug event now includes full `choices` (with `finish_reason`), `usage` (prompt/completion/total tokens), and the model echo. `api-error` debug event captures HTTP status, error code, and raw error body. `thinking-truncated` event fires when `removeContentTags` strips a `<think>` block that consumed all output tokens, with a hint to increase `OCO_TOKENS_MAX_OUTPUT`.
- Fix few-shot example framing: system prompt now explicitly states "An example input/output pair follows to demonstrate the expected format. Your actual task will be the final user message." — prevents weak models from summarizing the example response instead of analyzing the actual diff.
- Fix pre-processed payload chunking: when `docstringOverride=true` the payload passed to `generateCommitMessageByDiff` is already extracted docstring text (not a raw git diff). If that text exceeded `MAX_REQUEST_TOKENS` it was being chunked into arbitrary pieces, producing garbage messages like "Fixed" / "feat updates". Now detects the absence of `diff --git`  headers and applies line-based truncation to fit the budget, sending as a single request instead.

## Phase 3 improvements (completed)

- Fix `Symbol(clack:cancel)` committed as message: added `isCancel()` guard in sequential Edit branch.
- Fix `.opencommitignore` not applied to `getStagedFilesStats` → LLM was receiving ignored files (e.g. `out/cli.cjs`).
- Fix cache never read in per-file generation path: `generatePerFileCommits` now checks cache before calling LLM per group.
- Fix `archiveCacheEntry` missing in per-file commit path.
- Fix cache recording wrong model after fallback: `consumeLastUsedModel()` tracks actual model used.
- Replace `require('fs')` / `require('path')` with static imports in `commitCache.ts` and `config.ts`.
- Remove redundant `OCO_DIFF_INDIVIDUAL_FILES` key; boilerplate grouping now wired to `OCO_PER_FILE_COMMIT_MODE=always`.
- Add `OCO_MAX_LINES_PER_GROUP` (default 1500) — caps combined line count of small-file groups to prevent everything glomming together.
- Subdirectory-aware grouping for small files: `groupByDirectory()` sorts by directory before bin-packing.
- Fix migration tracking file name: `.opencommit_migrations` → `.opencommitx_migrations` with copy-over logic.
- Fix `_run.ts` provider early-exit: only skips migration00 for unsupported providers, not all migrations.
- Fix provider pre-selection in `runSetup`: current provider sorted first so clack highlights it.
- Add `OCO_GENERATION_TIMEOUT_SECONDS` config key (default 90) replacing hardcoded constant.
- Add missing keys to `runFullSetup`: `OCO_FALLBACK_MODEL`, `OCO_FALLBACK_PROVIDER`, `OCO_TEMPERATURE`, `OCO_COMMIT_DETAIL`, `OCO_MAX_FILES_PER_GROUP`, `OCO_WHY`, `OCO_DEBUG`, `OCO_GENERATION_TIMEOUT_SECONDS`.
- Thematic ordering in `ocox config describe`; added describe entries for all new keys.
- API key plain-text warning shown once when writing a key via setup/promptForKey.
- Fallback model UX: naming convention hint, interactive provider/key setup on first failure.
- Staged files table DS column now uses `shouldUseDocstringMode()` directly instead of `docstringOverride` truthy check.
- Refactor `generateCommitMessageFromGitDiff.ts`: extracted `splitDiff` to `src/utils/splitDiff.ts` (no engine deps), chunking utils to `src/utils/diffChunking.ts`.
- Fix `getIsGlobalConfigFileExist` and `getGlobalConfig` to only check legacy path when using the default (production) path, not test temp paths.
- Test suite: updated `diffRouter.test.ts`, `commitCache.test.ts`, `commitStrategy.test.ts`; added `diffChunking.test.ts` (via `splitDiff.ts`), `configValidators.test.ts`. 10/10 suites pass.
- `ocox benchmark` command: setup wizard, per-candidate runner, single-call evaluator with structured JSON grades (score, accuracy, completeness, missing_key_details, hallucinations, conventional_commit_compliance, pros/cons, suggested_improvement, overall), terminal display, model selection, `benchmark_results_<ts>.md` output.
- `xdocs/inspo_notes.md` annotated with `[x]` for all addressed items.
- `xdocs/README.md` updated with all new keys, benchmark section, updated cache section.

## Phase 2 improvements (completed)

- Fix "Committing…" cascade spinner: `committingChangesSpinner.start()` inside `stderr.on('data')` replaced with `.message()`. This also eliminates the `MaxListenersExceededWarning` (each `.start()` added a new keypress listener).
- Fix "Generating:" cascade spinner: file list in `genSpinner.message()` now truncated to terminal width via `truncateFileList()`, preventing clack bug #132 (line re-renders when message > terminal columns).
- Add `process.stdin.setMaxListeners(+20)` guard in `cli.ts` to suppress residual warnings in sequential multi-commit mode.
- Fix sequential mode spinner leak: `try/finally` added around both `execa` commit calls in the `acceptAll` path so `committingSpinner.stop()` is guaranteed even on hook failure.
- Fix `modelCache.ts` namespace: model cache now stored at `~/.opencommitx-data/models.json` (was `~/.opencommit-models.json`).
- Fix `mlx` provider validation: `'mlx'` added to `OCO_AI_PROVIDER` validator allowlist in `config.ts`.
- Fix `splitDiff` character vs token: `substring` now uses `maxChangeLength * 4` chars (≈4 chars/token) instead of token count directly.
- Fix `prompts.ts` module-level config snapshot: `getConfig()` now called fresh inside each helper function instead of cached at module import time (fixes stale config in dry-run/test mode).
- Upfront staged-files table: after routing, a `note()` table shows File / +/- lines / New? / DS mode / Group# for every staged file.
- `getStagedFilesStatus()` added to `git.ts` to retrieve A/M/D/R status for staged files.
- `OCO_DIFF_INDIVIDUAL_FILES=true`: forces per-file grouping with boilerplate files (`__init__.py`, `index.ts`, etc.) grouped together.
- `OCO_MAX_FILES_PER_GROUP` (default 10): caps small-file groups to avoid oversized single groups on large repos.
- Lock file grouping fix: lock files (`pixi.lock`, `package-lock.json`, etc.) now attached to the group containing their manifest file instead of always appended to the last group.
- Cache per-group files: each cache entry now stored as a separate JSON file at `~/.opencommitx-data/<repo>-<hash>/<diffhash>.json`.
- Cache model metadata: `model` field stored in every cache entry; shown when cached model differs from current model.
- Cache lifecycle: successful commits archive their cache entry to `archived/` subdir; `pruneArchivedCache()` cleans entries older than TTL.
- Regeneration flow: "Regenerate" option added to `performCommit` select with concise/detailed/feedback sub-menu.
- Fallback model: `OCO_FALLBACK_MODEL` + `OCO_FALLBACK_PROVIDER` config keys; auto-retries on rate-limit/timeout errors.
- Setup wizard pre-population: current provider highlighted as "(current)"; existing API keys shown as masked with keep/update option.
- Config location migration: `~/.opencommitx` → `~/.opencommitx-data/config.ini` via migration `04_migrate_config_location`; backward-compat fallback read from legacy path.
- `OCO_TEMPERATURE` config key (default 0): threaded to all engine adapters (OpenAI, OpenRouter, Anthropic, Gemini, Ollama, MLX, DeepSeek).
- Thinking-model warning: `note()` shown before generation if model name contains `thinking`, `:thinking`, `-think`, or matches `o1`/`o3` patterns.
- `OCO_COMMIT_DETAIL` config key (`concise`/`normal`/`detailed`): adjusts system prompt verbosity instructions.

