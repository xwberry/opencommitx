Perform a deep, end-to-end review of the **entire codebase** — not just the diff vs. master. The goal is to surface latent bugs, design weaknesses, security risks, code-quality issues, **and concrete improvement opportunities** (newer libraries/APIs, better separation of concerns, parallelisation wins, thematic features that would round out an existing surface). Be rigorous; assume nothing is "already reviewed."

Read `CLAUDE.md` first for project context, stack, and standards. Then read `xdocs/REVIEW.md` §1–8 (architecture map and file index — generally trustworthy, doesn't go stale fast). **Skim §9–10 only as historical context — those sections age out as fixes land**, so re-verify any item against current code before acting on it.

If a previous review exists at `xdocs/reviews/<earlier-date>/SUMMARY.md` (the most recent dated directory), read it first. The point of dated review dirs is making the *delta* visible: which findings have been resolved, which are still open, which have regressed.

## Scope

Review **all** TypeScript source under `src/` plus `test/unit/` and `test/e2e/`. Also review `scripts/extract_docstrings.py` (the Python helper invoked from TS) and `action.yml` / `src/github-action.ts` together as the GitHub Action surface.

Treat the working tree as the source of truth — `git log` / `git blame` are only useful for understanding *why* something exists, not for deciding what to review.

Skip:
- Dependency lockfiles (`bun.lock`, `package-lock.json`, `pixi.lock`) and `node_modules/`
- Generated artifacts: `out/`, `*.tgz`, `.pixi/`
- Scratchpad / planning docs: `xdocs/plans/`, `xdocs/priv/`, `xdocs/todo.md`, `todo.md`, `.github/TODO.md`
- The legacy `src/CommandsEnum.ts` (stale duplicate of `src/commands/ENUMS.ts`; flag its existence but don't deep-review)

## Approach

Run this as a structured multi-pass audit. Spawn **one Explore subagent per pass**, in parallel where possible, and have each subagent write its findings directly to a file under `xdocs/reviews/<YYYY-MM-DD>/`. Then, as the orchestrator, read those files and synthesise a single `SUMMARY.md` in the same directory.

This split exists for two reasons: (1) the per-pass files are durable artefacts that future reviews can diff against, and (2) keeping detail in pass files lets `SUMMARY.md` stay short and high-signal.

### Pass 1 — Architecture map
Build a mental model before judging code. Identify:
- **Entry points:** `src/cli.ts`, `src/github-action.ts`, `src/commands/prepare-commit-msg-hook.ts` (when invoked AS the git hook)
- **Module boundaries:** `commands/`, `engine/`, `migrations/`, `modules/commitlint/`, `utils/`, `prompts*`, `i18n/`
- **Cross-cutting concerns:** config (`commands/config.ts`), engine dispatch (`utils/engine.ts`), token counting (`utils/tokenCount.ts`), error normalisation (`utils/engineErrorHandler.ts`), debug logging (`utils/debugLog.ts`), provider-key resolution (`utils/providerKeys.ts`)
- **External tool boundaries:** AI provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `@mistralai/mistralai`, `@azure/openai`); raw axios for Ollama/MLX/Flowise/aimlapi; `execa`-spawned git; `child_process.spawnSync`-launched Python (`scripts/extract_docstrings.py`); `@dqbd/tiktoken` WASM
- **Improvement lens:** boundary gaps that would benefit from a small new abstraction (e.g. an `assertWithinTokenBudget(messages, config)` helper to replace 5 copies of the same engine pre-flight); places where a facade would let three loosely-coupled utilities (`splitDiff` + `mergeDiffs` + `getCommitMsgsPromisesFromFileDiffs`) become one cohesive chunker; missing layers (e.g. a typed config-loader module separate from the cleye command handler) that would simplify everything downstream.

Note any architectural smells: circular imports, layering violations (commands invoking provider SDKs directly instead of going through `getEngine()`), inconsistent patterns across engines (some extend `OpenAiEngine`, others mirror it), the duplicated `formatCacheAge` helper across three files.

### Pass 2 — Correctness & bugs
For each module, hunt for:
- **Resource leaks:** dangling `process` listeners (`SIGINT`/`SIGBREAK`), un-`finally`'d `try` blocks around spinners/listeners, subprocess pipes from `execa`/`spawnSync` not awaited, unbounded `setTimeout` references that don't clear on success
- **Race conditions:** module-level mutable state (`lastUsedModel` in `generateCommitMessageFromGitDiff.ts`, top-level `const config = getConfig()` in command files), spinner/prompt overlap during concurrent LLM calls (this is why the per-file flow uses sequential `for…of`, NOT `Promise.all` — verify the invariant holds)
- **Async mistakes:** missing `await`, unhandled rejections, `Promise.all` over UI prompts, `setTimeout`-based timeouts that never get cleared on the success path, `await Promise.race(...)` where the loser keeps running and burns tokens
- **Path / encoding bugs:** Windows backslash vs POSIX (`process.argv[1].endsWith(hooksPath)` in `commands/githook.ts`), CRLF line endings in diff hashing, BOM in `.env`, non-ASCII filenames in `git diff --name-status` parsing, `lockFile.split('/')` when the file is on Windows
- **Error handling:** bare `catch {}` and `try { … } catch { /* non-fatal */ }` blocks that hide real bugs; inconsistent error types across engine boundaries (raw axios error vs `normalizeEngineError`); engines that don't route through `normalizeEngineError`
- **Logic errors in branching:** `OCO_AI_PROVIDER` switch fallthroughs in `getEngine()`, `mode === 'auto' / 'always' / 'never'` exhaustiveness in `routeDiff`, fallback-model retry conditions, the `git diff --name-status` parser's handling of renames (R100 newpath\toldpath)
- **Silent data loss:** dropping staged files in sequential commit strategy (the "omittedFiles" branch in `commit.ts`), truncating diffs without warning the user, ignoring `git commit` exit codes, swallowed cache-write errors masking permission problems
- **Improvement lens:** modern Node/TS APIs that would replace ad-hoc plumbing — `AbortController` / `AbortSignal.timeout()` for cancellation instead of homegrown `Promise.race` against `setTimeout` (the loser keeps running today); `Promise.withResolvers()` for the deferred patterns in regen; `Object.groupBy` (Node 21+) where things are reduced into `Map`s by hand; `AsyncIterator`s for streaming SDK responses; `node:test` if Jest's ESM/`ts-jest` friction stops being worth the ecosystem.

### Pass 3 — Security
Beyond the standard `/security-check` checklist:
- **Argument injection in `execa('git', [...])`:** verify all git args come from controlled sources, not arbitrary user-typed input; check for missing `--` separators when passing pathspecs
- **Subprocess invocation of Python:** `spawnSync('python', ['extract_docstrings.py', filepath, '--changed', changedNames.join(',')])` — `filepath` comes from `git diff` headers (controlled) but `changedNames` comes from regex-matched user code; check for argv injection if a Python identifier ever contains a comma or a `--flag`-shaped string (Python parses positional args lazily)
- **API-key leakage:** `validateConfig` prints failing values to stdout (`commands/config.ts:651`) — could log key fragments. Debug logs (`utils/debugLog.ts`) include full prompts and responses (which contain the entire diff and possibly secrets in changed code) — check file mode and content sanitisation
- **File permissions:** `commitCache` writes `0o600` ✓; `customModels` writes `0o600` ✓; `migration04` writes `0o600` ✓. **`setGlobalConfig` and `debugLog` do NOT set explicit modes** — flag.
- **Untrusted-data risks in prompts:** the diff (which contains arbitrary content from user-edited code) is passed to LLMs verbatim; verify it's never `eval`'d, `JSON.parse`'d without `try`, or interpolated into a string that's later interpreted as code (e.g. shell, regex, template)
- **`.env` precedence leakage:** the merge order makes `.env` override the global config — verify nothing in setup-wizard ever silently rewrites a value back into `~/.opencommitx-data/config.ini` from `.env`
- **`OCO_API_CUSTOM_HEADERS` injection:** user-supplied JSON is parsed and forwarded as HTTP headers — check for header-injection (CRLF in values), and that the parser rejects nested objects/arrays
- **Improvement lens:** "best-effort guard" code that could become "by-construction safety" — validate `OCO_API_CUSTOM_HEADERS` through a Zod schema with an explicit disallow-list of dangerous header names; centralise file-write permissions in a single `secureWrite()` helper instead of remembering `0o600` at each call site; replace the manual provider whitelist in `benchmarkRunner.ts` with a capability tag declared on each engine's class; add a `redactSecrets()` step in `validateConfig`'s error path so key fragments can never reach stdout.

### Pass 4 — Code quality & maintainability
- **Functions over ~50 lines or with high cyclomatic complexity:** `commit()` and `generatePerFileCommits` in `commands/commit.ts`; `generateCommitMessageByDiff` in `generateCommitMessageFromGitDiff.ts`; `runFullSetup` in `commands/setup.ts`; `runBenchmark` in `commands/benchmark.ts`; `routeDiff` (right at the edge)
- **Duplicated logic:** the token pre-flight check in `OpenAiEngine`, `DeepseekEngine`, `AnthropicEngine`, `MistralAiEngine`, `AzureEngine` (5 copies); `formatCacheAge` in `commitCache.ts`, `models.ts`, `setup.ts` (3 copies); the "is this a thinking model" detector in `commit.ts:502` and `generateCommitMessageFromGitDiff.ts:474`
- **Type-hint gaps:** `as any` casts at `setGlobalConfig({...} as any)` call sites; untyped engine constructors in `gemini.ts`, `ollama.ts`, `mlx.ts`, `flowise.ts`; `value: any` on every config validator
- **Dead code:** unused imports flagged by CodeRabbit (see REVIEW.md §9.4); `src/CommandsEnum.ts` (entire file is a duplicate); commented-out `excludeBigFilesFromDiff` array in `utils/git.ts`; `console.log(entriesToSet)` in `migrations/02_set_missing_default_values.ts`
- **Inconsistent naming or patterns:** `aimlapi.ts` is the only engine that doesn't strip `<think>` tags; `ollama.ts` and `mlx.ts` use `axios.create({ url: ..., headers: ... })` while `aimlapi.ts` uses `baseURL` then `client.post('')` — pick one
- **Inappropriate abstractions:** `mergeDiffs` + `splitDiff` + `getCommitMsgsPromisesFromFileDiffs` could be one cohesive chunker; `commands/config.ts` at 2008 lines should be split (proposed split is in REVIEW.md §10.2)
- **Zod usage:** Zod is used at the benchmark evaluator boundary; verify the schemas reject unexpected fields rather than silently passing them; check `modelCache.ts` ad-hoc `(m: { id: string })` casts where Zod would be more idiomatic
- **Improvement lens:** modularity wins worth proposing concretely — split `commands/config.ts` (2008 lines) into `config/keys.ts`, `config/models.ts`, `config/validators.ts`, `config/storage.ts`, `config/help.ts`; tiny libraries that would replace home-grown logic (e.g. `xstate` for the regenerate UI loop, `ow` or `zod` for runtime validation in the `value: any` validators, a real argv lib if `cleye` becomes limiting); thematic features that would round out an existing surface (e.g. `ocox cache list/clear/inspect` since the cache is now a real subsystem; `ocox doctor` to surface config + provider connectivity health in one place).

### Pass 5 — Tests
- **Modules with no test coverage at all:** `commands/setup.ts`, `commands/benchmark.ts`, `commands/models.ts`, every `engine/*.ts` except `gemini.test.ts` (which is currently skipped), `utils/engineErrorHandler.ts`, all of `migrations/`, `utils/modelCache.ts`, `github-action.ts`, `commands/prepare-commit-msg-hook.ts`
- **Tests that mock so heavily they verify nothing:** check unit suites for over-mocked engines that just round-trip the mock
- **Tests pinned to environment-specific behaviour** that breaks on Windows (e2e suites in particular)
- **Happy-path-only coverage:** `routeDiff` is well-tested; `generateCommitMessageByDiff` fallback-model and chunked-message paths are not — flag any other functions with non-trivial error paths and zero error-case tests
- **Tests pinned to behaviour that contradicts the documented contract:** the `commitCache.test.ts` whitespace-handling tests encode a specific semantic — confirm the implementation matches the test, not the other way around
- **Improvement lens:** coverage strategy upgrades — property-based tests for `routeDiff` via `fast-check` over arbitrary `FileStats[]`; snapshot tests for prompt assembly so prompt-version drift is loud; a contract test that every engine round-trips a fixed message correctly when pointed at `TestAi`; Windows e2e coverage of the per-file sequential strategy (currently bash-only setup); a single integration test that boots the full CLI in a temp git repo and asserts on the `out/cli.cjs` bundle (catches build regressions that unit tests miss).

### Pass 6 — LLM integration
Cover `src/generateCommitMessageFromGitDiff.ts`, `src/engine/*.ts`, `src/prompts.ts`, `src/prompts/benchmark.ts`, `src/utils/benchmarkRunner.ts`:
- **Missing `max_tokens` / `temperature` / retry-with-backoff:** verify every engine path passes a max tokens cap; flag engines that ignore `OCO_TEMPERATURE` (`azure.ts`, `mistral.ts`, `aimlapi.ts`, `flowise.ts` are suspected)
- **Token-bomb risk:** untrusted diff content interpolated into prompts without bounds — verify `MAX_REQUEST_TOKENS` guards every engine path including the chunked and docstring-fallback branches; check that `enrichDiffWithPythonDocstrings` re-checks budget before appending
- **No prompt-version logging:** debug logs include the prompt but there's no schema/version tag — if the system prompt evolves, old debug logs become hard to interpret
- **Hardcoded model IDs:** scan for `'gpt-4o-mini'` / `'claude-...'` / `'openai/gpt-4o-mini'` literals outside `MODEL_LIST`, `RECOMMENDED_MODELS`, `DEFAULT_BENCHMARK_CONFIG`. Anything in code paths (not config) is a smell.
- **Cache strategy:** `commitCache` keys by diff hash but does NOT include prompt-version. If the system prompt changes (e.g. someone tweaks `prompts.ts`), stale cache entries with outdated formatting will be returned. Suggest a cache version key.
- **`<think>` stripping consistency:** every engine should call `removeContentTags(content, 'think')` before returning. Currently `aimlapi.ts:38` does not — flag any others.
- **Provider whitelist drift:** `OPENAI_COMPATIBLE_EVALUATOR_PROVIDERS` in `benchmarkRunner.ts:53` only allows `openai` and `openrouter`. Flag if other OpenAI-compatible providers (`groq`, `deepseek`, `aimlapi`) should be added or if the whitelist should be data-driven.
- **Improvement lens:** capability upgrades made possible by newer SDK features — Anthropic prompt caching for the system prompt + few-shot example (would dramatically cut per-call cost on `claude-*` providers); OpenAI structured outputs / `response_format: { type: 'json_schema' }` to make the benchmark evaluator JSON parse robust without regex extraction; streaming responses with progressive UI for long-running models; **parallel candidate execution in `benchmarkRunner` (currently sequential `for…of` even though candidates are independent — easy parallelisation win)**; a smart model-router that picks cheap vs. expensive based on diff stats; first-class support for OpenRouter `:free` discovery so users find them without grep.

## Output format

Outputs are written to `xdocs/reviews/<YYYY-MM-DD>/`, where `<YYYY-MM-DD>` is today's ISO date (`date +%F` or the conversation's `currentDate`). If that directory already exists for today, suffix with `-rerun` (e.g. `2026-05-01-rerun/`) — never overwrite a prior review's files.

### Per-pass files (subagents)

Each pass subagent writes one Markdown file:

| File | Pass |
| --- | --- |
| `01-architecture.md` | Pass 1 — Architecture map |
| `02-correctness.md` | Pass 2 — Correctness & bugs |
| `03-security.md` | Pass 3 — Security |
| `04-quality.md` | Pass 4 — Code quality & maintainability |
| `05-tests.md` | Pass 5 — Tests |
| `06-llm.md` | Pass 6 — LLM integration |

Inside each pass file, group by severity, then by module:

```
## CRITICAL (security or data-loss)

### <module/file>
- **<short title>** — `path/to/file.ts:LINE`
  <2–4 line description: what's wrong, why it matters, suggested fix direction>

## HIGH (likely bugs / production risk)
...

## MEDIUM (latent issues / design concerns)
...

## LOW (code quality / maintainability)
...

## Improvements (non-bug, opportunity-driven)

- **<short title>** — `path/to/file.ts:LINE` (or `(cross-cutting)` for non-file-specific items)
  <description of the opportunity, the concrete change, and an effort/impact gloss like `S effort × M impact`>

## Architectural observations
<bullet list of cross-cutting concerns that don't fit a single file>
```

Each finding must include:
1. A specific `file.ts:LINE` reference (or `(cross-cutting)` for genuinely non-local items)
2. A concrete suggestion (not just "consider refactoring")
3. Severity rationale if not obvious — and for `## Improvements` entries, an effort/impact gloss (`S/M/L effort × S/M/L impact`) so the user can triage

### Orchestrator file (`SUMMARY.md`)

You (the orchestrator) read all six pass files and write `xdocs/reviews/<YYYY-MM-DD>/SUMMARY.md`. It must:

1. **Link to each pass file** with a 1–2 sentence preview ("See [02-correctness.md](02-correctness.md) — 3 HIGH, 7 MEDIUM, mostly around fallback-model retry").
2. **Surface the highest-severity findings inline** (full Critical and HIGH text; abbreviate the rest).
3. **Call out themes that span passes** — e.g. "untyped engine constructors appear in Pass 2 (correctness) and Pass 4 (quality); a single fix resolves both."
4. **Open with a delta section** comparing against the most recent prior `xdocs/reviews/*/SUMMARY.md` if one exists: items resolved since last review, items still open, items that have regressed, items newly discovered.
5. **End with the Final summary block** (see below).

Keep `SUMMARY.md` under ~300 lines — it's a navigation aid, not a re-statement of every pass file.

## Guardrails

- **Do not modify any code** during the review — this is a read-only audit. The only files this command writes are under `xdocs/reviews/<YYYY-MM-DD>/`.
- **Do not propose changes to fixtures or golden files** without first understanding the test intent. Failing fixtures often signal real behaviour changes.
- **Do not suggest dependency changes as fixes** — those are handled separately. The Improvement lens *may* propose a library swap, but only as a suggestion with rationale, never as a "do this" instruction.
- **Do not flag pure style nits** — Prettier and ESLint handle those.
- **Do not echo `CLAUDE.md` or `xdocs/REVIEW.md` back** — apply them, don't restate them.
- **Cite file:line for every finding.** Findings without a precise location are not actionable.
- **Prefer fewer high-quality findings over an exhaustive list of nits.** Aim for ~15–40 substantive findings across all passes, not 200 trivial ones.
- **Treat `xdocs/REVIEW.md` §9 and §10 as historical, not authoritative.** That ledger ages out as items get fixed; verify each item against current code before flagging or quoting it.
- **Acknowledge the previous review when present.** If `xdocs/reviews/<earlier>/SUMMARY.md` exists, the new `SUMMARY.md` must include a delta section. Don't silently re-flag resolved issues.

## Final summary (last block of `SUMMARY.md`)

End with:
- **Top 3 issues** to fix first (the user's actionable shortlist — bug/risk-driven)
- **Top 3 improvements** worth pursuing (non-bug, ROI-ranked from the `## Improvements` sections across passes)
- **Modules in best shape** (so the user knows where not to spend triage time)
- **Delta from previous review** (one-line bullets for resolved / still-open / regressed / new) — only if a prior review exists
- **Recommended follow-up commands** (e.g. `/security-check`, `/add-tests <module>`) if any
