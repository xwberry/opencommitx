# OpenCommitX Todo

## Completed (Initial Fork Implementation)

- [x] **Phase 1**: Package identity — renamed to `opencommitx`, added `ocox`/`opencommitx` bin entries, updated repo URL and upstream references
- [x] **Phase 2**: Pre-commit result cache (`src/utils/commitCache.ts`) — caches LLM results by diff hash, survives pre-commit hook failures
- [x] **Phase 3**: Fixed module-level config bug in `generateCommitMessageFromGitDiff.ts` (OCO_TOKENS_MAX_INPUT was read at module load time)
- [x] **Phase 4**: Smart diff routing — added `getStagedFilesStats()` to `git.ts`, new `diffRouter.ts` with numstat-based per-file vs aggregate logic
- [x] **Phase 4b**: Python docstring extraction — `scripts/extract_docstrings.py` + `src/utils/pythonDocstringExtractor.ts` via `child_process`
- [x] **Phase 5**: Multi-message commit loop — per-file commit messages with Accept/Skip/Accept All options and `OCO_MULTI_COMMIT_STRATEGY` config
- [x] **Phase 6**: Per-provider API keys — `OCO_OPENAI_KEY`, `OCO_ANTHROPIC_KEY`, etc., with fallback to `OCO_API_KEY`, migration 03
- [x] **Phase 7**: OpenRouter engine refactored to use OpenAI SDK (OpenAI-compatible endpoint), passes `max_tokens`
- [x] **Phase 8**: Enhanced config UX — `ocox config describe` shows current values, `ocox setup full` walks all keys
- [x] **Phase 9**: Model management — `ocox models add/remove <provider> <model>`, custom models in `~/.opencommit-custom-models.json`
- [x] **Phase 10**: Dry run — `--dry-run` / `-d` flag, skips API key check and uses test mock
- [x] **Phase 11**: Fork hygiene — annotated `github-action.ts`, renamed deploy scripts
- [x] **Phase 12**: Documentation — `xdocs/README.md`, `xdocs/PROMPT_ANALYSIS.md`, `xdocs/DEPLOYMENT_INSTRUCTIONS.md`, fixed `OCO_WHY` prompt injection bug
- [x] **Phase 13**: Extended test suite — `test/unit/commitCache.test.ts`, `test/unit/diffRouter.test.ts`, `test/unit/perProviderKeys.test.ts`, `test/e2e/dryRun.test.ts`

## In Progress

- [x] Build and verify TypeScript compilation (`npm run build`) — **succeeded, exit code 0**
- [x] Run unit tests — 6 suites passing (1 upstream skip in gemini.test.ts, pre-existing)
- [x] Add `cross-env` to `package.json` test scripts for Windows PowerShell compatibility
- [x] Add `test/unit/pythonDocstringExtractor.test.ts` — tests `shouldUseDocstringMode` logic + conditional integration tests for Python script invocation
- [x] Extended `diffRouter.test.ts` — added docstring override coverage using `mockReturnValueOnce`
- [x] Added `test/unit/commitStrategy.test.ts` — covers `OCO_MULTI_COMMIT_STRATEGY` (buildCommitPlan file-message association, combineCommitMessages, isValidCommitStrategy, env var reading) and DEFAULT_CONFIG defaults for all new keys
- [x] Extracted `buildCommitPlan` + `combineCommitMessages` into `src/utils/commitStrategy.ts`; updated `commit.ts` to use both
- [x] Fixed sequential strategy staging bug: now does `git reset HEAD --` before loop, then `git add -- <files>` per group (and `git reset HEAD -- <files>` on Skip), ensuring group[i].files are committed with group[i].message
- [x] Fixed `diffRouter.test.ts` mock fragility — switched to dependency injection on `routeDiff(_shouldUse, _extract)` params; removed `jest.mock()` entirely
- [x] Fixed `commitStrategy.test.ts` env var tests — removed incorrect `JSON.parse` on bare strings; plain `process.env` read matches `parseConfigVarValue` fallback behaviour
- [x] Changed `defaultConfigPath` from `~/.opencommit` to `~/.opencommitx` to avoid config file collision when both packages are installed
- [x] Added `OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO` config key (default 0.9): `shouldUseDocstringMode` now checks `changedLines / fileLines >= ratio` in auto mode, preventing docstring extraction on partial refactors — updated tests with temp-file ratio scenarios

## PR Review Fixes (PR #1 CodeRabbit recommendations)

- [x] `action.yml`: Updated `node16` → `node24` runtime; fixed extra `)` typo in description; removed non-standard `repo` field
- [x] `.gitignore`: Fixed malformed `.nvmrc# pixi environments` concatenation
- [x] `pixi.toml`: Added `linux-64`, `osx-64`, `osx-arm64` platforms for cross-platform CI support
- [x] `src/utils/commitCache.ts`: Made `writeCache` best-effort (try/catch) with `0o600` file permissions
- [x] `src/utils/customModels.ts`: Made `writeCustomModels` best-effort with `0o600` perms; fixed custom model ordering (was reversing array, now preserves insertion order)
- [x] `src/utils/diffRouter.ts`: Fixed `isBinaryOrGenerated` — `.min.js`/`.min.css` were never matched because `.split('.').pop()` returned `js`/`css`; now uses explicit `endsWith` checks
- [x] `src/utils/commitStrategy.ts`: Added `RangeError` guard when `fileGroups.length !== messages.length`
- [x] `src/commands/commit.ts`: Fixed `docstringOverride` never being used in per-file message generation; added guard against sequential mode silently dropping staged files; fixed `fileGroups.length > 1` → `> 0` so single-group per-file mode works; propagated `context` + `skipCommitConfirmation` through regeneration and recursive `commit()` calls
- [x] `src/commands/config.ts`: Added `OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO` to env config parsing; added `describe` metadata for that key; fixed `OCO_HOOK_AUTO_UNCOMMENT` validator missing `return value`
- [x] `src/commands/setup.ts`: Fixed `isFirstRun` to use `getProviderApiKey` instead of only `OCO_API_KEY`; `promptForMissingApiKey` now saves provider-specific key alongside generic key; `runFullSetup` now calls `selectModel` for local providers (Ollama/MLX) too; added `toPositiveNumber` guard for numeric inputs to prevent `NaN` in config; fixed both success messages showing `~/.opencommit` → `~/.opencommitx`
- [x] `src/commands/models.ts`: `listModels` and `refreshModels` now use `getProviderApiKey(config, provider)` instead of always `config.OCO_API_KEY`
- [x] `src/generateCommitMessageFromGitDiff.ts`: Added `context: string = ''` default parameter to `generateCommitMessageChatCompletionPrompt`
- [x] `src/github-action.ts`: Added `MAX_RETRIES_PER_CHUNK = 3` guard to prevent infinite retry loop on persistent failures; wrapped temp file operations in `try/finally` for guaranteed cleanup; updated branding `OpenCommit` → `OpenCommitX`
- [x] `src/commands/prepare-commit-msg-hook.ts`: Updated `oco` → `ocox` and `opencommit` → `opencommitx` in user-facing messages
- [x] `src/engine/aimlapi.ts`: Updated `X-Title` header `opencommit` → `opencommitx`
- [x] `.github/CONTRIBUTING.md`: Updated target branch `main` → `master`
- [x] `test/e2e/dryRun.test.ts`: Replaced `render('echo', [...])` with `fs.writeFileSync` for reliable file creation; fixed `['add dryrun.ts']` → `['add', 'dryrun.ts']` argument splitting
- [x] `test/unit/commitCache.test.ts`: Fixed `CACHE_FILE` path from `.opencommit-cache.json` → `.opencommitx-cache.json`
- [x] `xdocs/todo.md`: Fixed typo `many` → `may`

## Backlog

- [ ] Context window sharing strategy for multi-chunk requests (configurable: shared vs separate contexts)
- [ ] Smart model routing — estimate tokens from diff stats and route to cheap vs expensive model automatically
- [ ] i18n for new CLI messages added in this fork
- [ ] OpenRouter free model auto-discovery (`:free` suffix models highlighted in `ocox models list openrouter`)
- [ ] Sync `ENUMS.ts` `COMMANDS` to add any new subcommands formally
- [ ] Investigate upstream's "new version available" notification — update to check npm for `opencommitx` package
- [ ] Reduce bundle size (esbuild tree-shaking improvements)
- [ ] Investigate `OCO_API_CUSTOM_HEADERS` behavior with OpenRouter SDK approach
