# OpenCommitX — Project Context

## What this is

`opencommitx` (binaries: `opencommitx`, `ocox`) is a Node.js CLI that generates AI commit messages from staged git diffs. It is a fork of `[di-sukharev/opencommit](https://github.com/di-sukharev/opencommit)` with extensions for caching, smart per-file routing, per-provider API keys, fallback models, Python docstring extraction, multi-commit strategies, and a benchmark harness.

For the architecture map, file-by-file index, and the current PR-review burndown, read `[xdocs/REVIEW.md](xdocs/REVIEW.md)`. It saves a lot of grep/glob and is the canonical reference — keep it up to date when the architecture changes.

The project's working backlog is `todo.md` at the root. Phase plans live under `xdocs/plans/`.

## Stack

- **Language:** TypeScript, `strict: true`, target ES2020, module NodeNext
- **Runtime:** Node 20+ (CI matrix), bin compiled to CommonJS via `esbuild` (`out/cli.cjs`, `out/github-action.cjs`)
- **Package manager:** Bun 1.3.13 (`packageManager` field is authoritative); npm works but Bun is canonical and what CI uses
- **Test runner:** Jest 29 with `ts-jest` ESM preset; tests under `test/unit/` and `test/e2e/`
- **CLI framework:** `cleye`
- **UI primitives:** `@clack/prompts` — `intro` / `outro` / `select` / `text` / `confirm` / `multiselect` / `spinner` / `note`
- **HTTP / SDKs:** `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@mistralai/mistralai`, `@azure/openai`; raw `axios` for Ollama / MLX / Flowise / aimlapi
- **Tokeniser:** `@dqbd/tiktoken` (cl100k_base, WASM); singleton encoder lives in `src/utils/tokenCount.ts`
- **Validation:** `zod` for external response shapes (e.g. benchmark evaluator JSON)
- **Git invocation:** `execa` only — never raw `child_process.exec` for git
- **Python integration:** `scripts/extract_docstrings.py` invoked via `child_process.spawnSync`

## Coding standards

### TypeScript

- `strict` is on. Treat `any` as a smell. Prefer `unknown` + narrowing, or define a proper interface.
- Use `as const` for literal config blocks; use `satisfies` to validate without widening.
- For external response shapes (provider model lists, evaluator JSON), define a Zod schema and parse at the boundary — do not cast `JSON.parse(...)` directly.
- Prefer discriminated unions over optional flags for state variants. The `RoutingResult` shape in `utils/diffRouter.ts` is a decent template.
- `Record<string, T>` over `{ [k: string]: T }`. Use a real `Map` only when keys are computed at runtime and ordering / iteration matter.
- Don't write empty `interface X extends Y {}` to alias a type; use `type X = Y` (the bare-interface pattern is repeated across most engines and should be unwound when touched).

### Files & functions

- Keep functions under ~50 lines. `commit()` and `generatePerFileCommits` in `commands/commit.ts` are over budget — when touching them, extract rather than add.
- One responsibility per file in `src/utils/`; no utility grab-bags.
- Don't write comments that restate what the code does. Use comments for non-obvious *why* — e.g. the "tiktoken alloc is expensive — module-level singleton" comment in `utils/tokenCount.ts` is useful; a comment saying `// loop over file groups` is not.

### Engines (`src/engine/*.ts`)

When adding or modifying a provider engine:

1. Implement the `AiEngine` interface from `src/engine/Engine.ts`.
2. Constructor takes a typed config (extend `AiEngineConfig`); never `constructor(config)` with no annotation.
3. Pre-flight: assert `tokenCount(prompt) <= maxTokensInput - maxTokensOutput`; throw `GenerateCommitMessageErrorEnum.tooMuchTokens` if not. This block is duplicated across 5 engines today — when you touch one, prefer extracting a shared helper rather than copy-pasting.
4. Pass `temperature` (from `config.temperature ?? 0`) and, when temp = 0, `top_p: 0.1` for determinism — except where the provider's API rejects the combination (see `anthropic.ts:43` for the `claude-*-4-5` carve-out).
5. Catch errors and re-throw via `normalizeEngineError(error, providerName, model)` from `utils/engineErrorHandler.ts` so callers can rely on the typed-error hierarchy in `utils/errors.ts`.
6. Strip reasoning tokens with `removeContentTags(content, 'think')` before returning. Every engine must do this — `aimlapi.ts` currently doesn't, treat it as a bug, not a precedent.
7. Register the engine in `utils/engine.ts`'s `getEngine()` switch and add the provider to `OCO_AI_PROVIDER_ENUM`, `MODEL_LIST`, `PROVIDER_API_KEY_URLS`, `RECOMMENDED_MODELS`, and `PROVIDER_BILLING_URLS` (in `utils/errors.ts`).

### Configuration

All persistent state lives under `~/.opencommitx-data/` (`config.ini`, `debug/`, `models.json`, `benchmark.json`, per-repo cache dirs). Custom user models live at `~/.opencommitx-custom-models.json` (separate from the data dir for migration reasons).

To add a new config key:

1. Add to `CONFIG_KEYS` enum in `src/commands/config.ts`.
2. Add a validator entry to `configValidators` — **reject invalid input, do not silently coerce** (see the `OCO_DEBUG` regression noted in `xdocs/REVIEW.md` §9.4).
3. Add to `ConfigType`, `DEFAULT_CONFIG`, and the `getEnvConfig` env-var bridge.
4. Add a `getConfigKeyDetails` case so `ocox config describe KEY` works.
5. Add the key to `THEMATIC_KEY_ORDER` so `ocox config describe` (no args) lists it in the right group.
6. Add a setup-wizard prompt in `commands/setup.ts:runFullSetup` if user-facing.
7. **Reuse the validator in the wizard** — don't duplicate `n > 0` checks; call `configValidators[CONFIG_KEYS.OCO_FOO]` so wizard and `config set` agree on what's valid.

### Persistence file modes

- API keys, cache files, custom models — write with `mode: 0o600`. Pattern is established in `commitCache.ts:123`, `customModels.ts:25`, `migrations/04_migrate_config_location.ts:18`.
- `setGlobalConfig` (in `commands/config.ts`) currently writes config without an explicit mode. When you touch it, fix to `0o600`.
- Debug logs (`utils/debugLog.ts`) currently write `0o644` and contain full prompts/responses (which include the diff). Tighten to `0o600` when convenient.

### `@clack/prompts` discipline

- Always check `isCancel(value)` after every `text` / `select` / `confirm` / `multiselect` and exit cleanly. The codebase has had multiple bugs from missing this — see REVIEW.md §9.1.
- Don't run prompts inside `Promise.all` — they share `process.stdin` and conflict with spinners + WASM. Use sequential `for…of` (this was an explicit fix; do not regress).
- Always remove `SIGINT` / `SIGBREAK` listeners in a `finally` block — see `commands/commit.ts:533-540, 637-640` for the pattern.
- Truncate file lists in spinner messages so they don't wrap (see `truncateFileList` in `commands/commit.ts:55`).

### Git invocation

- Use `execa('git', [args...])` only. Never shell out via a single string — git args are user-influenced (file paths, branches) and unsafe under `shell: true`.
- All git wrappers belong in `src/utils/git.ts`. Don't sprinkle `execa('git', ...)` calls in commands directly.
- Use `--` separators when passing pathspecs to avoid argument injection (see `commit.ts:691, 734` for the pattern).

### LLM call discipline

- Every LLM call path must be reachable through `getEngine().generateCommitMessage(...)`. The benchmark runner's evaluator path (`benchmarkRunner.ts:runEvaluator`) intentionally bypasses this for raw-response access — that's a single documented exception, not a precedent.
- Always pass `max_tokens` (or the SDK's equivalent). Never let an engine call run unbounded.
- Wrap potentially-stalling calls in a `Promise.race` against a timeout derived from `OCO_GENERATION_TIMEOUT_SECONDS` (see `commit.ts:603-619` and `engine/openrouter.ts:25` for the two patterns — one races at the orchestrator, the other sets an SDK-level timeout).
- Cache writes (`setCachedCommitMessage`) must include the actual model used — call `consumeLastUsedModel()` after every generation so fallback-model usage is recorded correctly.
- Don't read config at module load time (`const config = getConfig()` at top of file). Read it inside the function so flags like `--dry-run` that mutate `process.env` mid-flight take effect. There's a longstanding bug from this pattern, fixed in Phase 3.

### Error handling

- Engines throw via `normalizeEngineError` → typed errors (`AuthenticationError`, `RateLimitError`, `InsufficientCreditsError`, `ServiceUnavailableError`, `ModelNotFoundError`) defined in `utils/errors.ts`.
- Top-level UI catches present errors via `formatUserFriendlyError` + `printFormattedError`. Don't `console.error` raw errors from command handlers.
- Bare `catch {}` is acceptable only for genuinely non-fatal best-effort operations (cache writes, archive moves) and **must** carry a comment explaining why. The `commitCache.ts` `try { … } catch { /* non-fatal */ }` blocks are the canonical pattern.

## Build / dev / test

- `bun run dev` — ts-node entrypoint, uses live `src/cli.ts` (handy for quick iteration without rebuilding)
- `bun run build` — produces `out/cli.cjs` + `out/github-action.cjs` via esbuild; also copies `tiktoken_bg.wasm`
- `bun run test:unit` — Jest unit suites (no git, no network)
- `bun run test:e2e` — runs `test/e2e/setup.sh` then Jest e2e suites (requires git in PATH; bash-only setup script)
- `bun run lint` — ESLint + `tsc --noEmit`. Run before pushing.
- `bun run format` — Prettier write. CI's `format:check` job will fail otherwise.
- `bun run start` — runs `out/cli.cjs` against the current repo. Useful for manual smoke testing.
- `bun run dev:gemini` — starts dev with `OCO_AI_PROVIDER=gemini` preset.
- `bun run ollama:start` / `mlx:start` — same idea for local providers.

## Platform notes

- **Windows is a first-class target.** Use forward-slash path constants (`.git/hooks/...`) only when comparing strings; use `path.join` everywhere else. `process.argv[1]` returns backslash-normalised paths on Windows when launched via the `.cmd` shim.
- The `commands/commit.ts` `SIGBREAK` handler exists because PowerShell + pixi shells intercept `SIGINT`. Keep both handlers when modifying that block.
- `test/e2e/setup.sh` is bash-only. There's no Windows e2e CI today.
- The Python docstring extractor falls back gracefully when Python isn't available (`pythonDocstringExtractor.ts:isPythonAvailable`), but flag any new code that hard-requires Python.

## Don'ts

- **Don't** invoke a Python binary via `child_process` for new features without an `isPythonAvailable()`-style guard. Pure-TS solutions are preferred for cross-platform portability.
- **Don't** add `console.log` calls in user-facing paths — use `outro` / `note` / `intro` from `@clack/prompts` so the UI stays consistent. ESLint's `no-console: error` will catch this.
- **Don't** rename `OCO_`* config keys without writing a migration in `src/migrations/` and adding it to the ordered list in `_migrations.ts`.
- **Don't** delete `src/CommandsEnum.ts` casually — it's a stale duplicate of `src/commands/ENUMS.ts`, but verify nothing imports it (Grep first) before removing.
- **Don't** add features, refactor, or introduce abstractions beyond what the task requires. A bug fix doesn't need surrounding cleanup.
- **Don't** broaden a typed error to `Error` or `unknown` "to avoid the cast" — fix the type instead.

## Conventions for commits / PRs

- Commit messages follow Conventional Commits: `fix:`, `feat:`, `refactor:`, `style:`, `chore:`, `docs:`, `test:`, `ci:`, `perf:`, `build:`. Scope is the affected module (e.g. `fix(diffRouter): ...`, `refactor(commitCache): ...`).
- PR base branch is `master`.
- CodeRabbit reviews every PR. Track Major/Critical comments in `xdocs/REVIEW.md` §9 (with current-state verification) when not addressing immediately, so they don't get re-discovered.
- The `xb-phase-2` branch is the active development branch. Phase plans for upcoming work live under `xdocs/plans/`.

