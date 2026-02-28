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
- [ ] Run unit tests to verify new tests pass
- [ ] Add `cross-env` to `package.json` test scripts for Windows PowerShell compatibility

## Backlog

- [ ] Context window sharing strategy for multi-chunk requests (configurable: shared vs separate contexts)
- [ ] Smart model routing — estimate tokens from diff stats and route to cheap vs expensive model automatically
- [ ] i18n for new CLI messages added in this fork
- [ ] OpenRouter free model auto-discovery (`:free` suffix models highlighted in `ocox models list openrouter`)
- [ ] Sync `ENUMS.ts` `COMMANDS` to add any new subcommands formally
- [ ] Investigate upstream's "new version available" notification — update to check npm for `opencommitx` package
- [ ] Reduce bundle size (esbuild tree-shaking improvements)
- [ ] Investigate `OCO_API_CUSTOM_HEADERS` behavior with OpenRouter SDK approach
