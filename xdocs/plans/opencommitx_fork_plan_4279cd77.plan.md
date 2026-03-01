---
name: opencommitx fork plan
overview: Fork `opencommit` as `opencommitx` with CLI alias `ocox`, adding pre-commit result caching, smart per-file diff routing, multi-message commit loops, per-provider API keys, enhanced configuration UX, dry-run support, model management, and Python docstring extraction for large files.
todos:
  - id: phase1-identity
    content: "Package identity: rename to opencommitx, add ocox/opencommitx bin entries, update repo URL, fix upstream references in engine files"
    status: completed
  - id: phase2-cache
    content: "Pre-commit result cache: new commitCache.ts utility, integrate into commit.ts with cache hit prompt"
    status: completed
  - id: phase3-config-bug
    content: Fix module-level config bug in generateCommitMessageFromGitDiff.ts (OCO_TOKENS_MAX_INPUT read at load time)
    status: completed
  - id: phase4-diff-router
    content: "Smart diff routing: add getStagedFilesStats() to git.ts, new diffRouter.ts with numstat-based per-file vs aggregate logic"
    status: completed
  - id: phase4b-python
    content: "Python docstring extraction: scripts/extract_docstrings.py + src/utils/pythonDocstringExtractor.ts via child_process"
    status: completed
  - id: phase5-multi-msg
    content: "Multi-message commit loop: extend generateCommitMessageByDiff to return file-grouped messages, update confirmation UX with Accept All option"
    status: completed
  - id: phase6-provider-keys
    content: "Per-provider API keys: add OCO_OPENAI_KEY, OCO_ANTHROPIC_KEY, etc., update getEngine() fallback, add migration 03"
    status: completed
  - id: phase7-openrouter
    content: "OpenRouter engine: switch from axios to openai SDK, update headers, pass max_tokens"
    status: completed
  - id: phase8-config-ux
    content: "Enhanced config UX: config describe shows current value, ocox setup full walks all keys interactively"
    status: completed
  - id: phase9-models
    content: "Model management: ocox models add/remove subcommands, custom models stored in ~/.opencommit-custom-models.json"
    status: completed
  - id: phase10-dryrun
    content: "Dry run: add --dry-run flag to CLI that sets test mock mode for the invocation only"
    status: completed
  - id: phase11-fork-hygiene
    content: "Fork hygiene: annotate github-action.ts upstream references, rename deploy scripts, document workflow files"
    status: completed
  - id: phase12-docs
    content: Create xdocs/README.md, xdocs/PROMPT_ANALYSIS.md, xdocs/DEPLOYMENT_INSTRUCTIONS.md, fix OCO_WHY prompt injection bug
    status: completed
  - id: phase13-tests
    content: "Extend test suite: unit tests for cache/router/keys, e2e tests for multi-file and dry-run flows"
    status: completed
isProject: false
---

# OpenCommitX Fork Plan

## Repository Overview

The upstream is a TypeScript/Node CLI tool (esbuild → `out/cli.cjs`) that:

- Collects staged git diff via `git diff --staged`
- Chunks large diffs by token budget using greedy bin-packing (`mergeDiffs`)
- Sends chunks to an LLM engine (12 providers), joins partial results with `\n\n`
- Presents one combined commit message with Yes/No/Edit confirmation

Key files to modify are in `src/` — all compiled via `esbuild.config.js` into `out/cli.cjs`.

---

## Phase 1 — Package Identity & Fork Hygiene

**Files:** `[package.json](opencommitx/package.json)`, `[src/engine/openrouter.ts](opencommitx/src/engine/openrouter.ts)`, `[src/github-action.ts](opencommitx/src/github-action.ts)`

- Rename `package.json`: `name` → `opencommitx`, `version` → `1.0.0`, update `repository.url` to fork URL
- Add bin entries: `"opencommitx": "out/cli.cjs"` and `"ocox": "out/cli.cjs"` alongside existing `oco`/`opencommit`
- Update `HTTP-Referer` header in `openrouter.ts` from upstream URL to fork URL
- Flag (do not delete): `.github/workflows/` — the `test.yml` is fine to keep; the `src/github-action.ts` references the upstream repo name in its push logic — add a comment warning
- The `build:push` and `deploy:build` scripts automatically commit/push to git — rename these to `deploy:npm` / `local:build-push` to make intent explicit

---

## Phase 2 — Pre-Commit Result Cache

**New file:** `src/utils/commitCache.ts`  
**Modified:** `src/commands/commit.ts`

The cache solves: pre-commit hooks cancel the commit, user re-runs `ocox`, LLM is called again for the same staged diff.

- Hash the staged diff content (SHA-256 via Node `crypto`) → cache key
- Store in `~/.opencommit-cache.json`: `{ [diffHash]: { message: string, timestamp: number } }`
- TTL: configurable via new key `OCO_CACHE_TTL_SECONDS` (default: 3600)
- New key `OCO_CACHE_ENABLED` (default: `true`)
- In `commit.ts`, before calling `generateCommitMessageByDiff()`, check cache and offer to reuse:

```
  ✔ Cached commit message found (generated 2 min ago):
  ——————
  fix(auth): correct token expiry handling
  ——————
  [Use cached] [Regenerate]
  

```

- Write to cache on successful generation (not on commit success — the cache is for the LLM output)

---

## Phase 3 — Fix Module-Level Config Bug

**Modified:** `[src/generateCommitMessageFromGitDiff.ts](opencommitx/src/generateCommitMessageFromGitDiff.ts)` lines 22-24

Current code reads `OCO_TOKENS_MAX_INPUT` / `OCO_TOKENS_MAX_OUTPUT` at module load time, so runtime config changes are ignored. Move `getConfig()` calls inside `generateCommitMessageByDiff()` to read fresh config on every call.

---

## Phase 4 — Smart Diff Routing

**New file:** `src/utils/diffRouter.ts`  
**Modified:** `src/utils/git.ts`, `src/commands/commit.ts`

### 4a — numstat analysis

Add to `git.ts`:

```typescript
getStagedFilesStats(): Promise<Array<{ added: number, deleted: number, file: string }>>
// runs: git diff --staged --numstat
```

### 4b — Routing logic in `diffRouter.ts`

New config keys:

- `OCO_PER_FILE_THRESHOLD_LINES` (default: `300`) — if a single file exceeds this, treat it individually
- `OCO_PER_FILE_COMMIT_MODE` — `auto` | `always` | `never` (default: `auto`)

Routing decisions:

- **aggregate** (current behavior): total lines < threshold OR `never` mode
- **per-file**: any file > threshold OR `always` mode
- **smart** (`auto`): runs numstat, groups files where per-file diff > threshold as individual, merges the rest

### 4c — Python docstring extraction

New file: `src/utils/pythonDocstringExtractor.ts` + `scripts/extract_docstrings.py`

For `.py` files where `added + deleted > OCO_PYTHON_DOCSTRING_THRESHOLD` (default: `500`):

- Use `child_process.spawnSync('python', ['scripts/extract_docstrings.py', filepath])` to extract module/class/function docstrings via Python's `ast` module
- Bundle `scripts/extract_docstrings.py` in the npm package (add to `"files"` in `package.json`)
- Fall back to full diff if Python is not available
- New config key: `OCO_PYTHON_DOCSTRING_MODE` — `auto` | `always` | `never` (default: `auto`)

---

## Phase 5 — Multi-Message Commit Loop

**Modified:** `src/commands/commit.ts`, `src/generateCommitMessageFromGitDiff.ts`

Currently `generateCommitMessageByDiff` returns a single `string`. Extend to return `Array<{ files: string[], message: string }>` when per-file mode is active.

Update `commit.ts` confirmation loop:

```
File group 1/3: src/auth/token.ts
——————
fix(auth): correct token expiry calculation
——————
[Accept] [Edit] [Skip] [Accept All Remaining]
```

- `Accept All Remaining` sets a flag to skip subsequent confirmations
- All accepted messages are committed in a single `git commit -m "msg1\n\nmsg2"` or sequentially (configurable)
- New config key: `OCO_MULTI_COMMIT_STRATEGY` — `single` (join all) | `sequential` (one commit per message, default: `single`)

---

## Phase 6 — Per-Provider API Keys

**Modified:** `src/commands/config.ts`, `src/utils/engine.ts`, `src/commands/setup.ts`  
**New file:** `src/migrations/03_per_provider_api_keys.ts`

New `CONFIG_KEYS`:

```
OCO_OPENAI_KEY
OCO_ANTHROPIC_KEY
OCO_OPENROUTER_KEY
OCO_GEMINI_KEY
OCO_GROQ_KEY
OCO_MISTRAL_KEY
OCO_DEEPSEEK_KEY
OCO_AIMLAPI_KEY
OCO_AZURE_KEY
```

`getEngine()` in `src/utils/engine.ts` picks the provider-specific key first, falls back to `OCO_API_KEY`.

Migration `03`: if `OCO_API_KEY` exists and `OCO_<PROVIDER>_KEY` for the current provider does not, copy the value.

Setup wizard updated to prompt for the correct key based on selected provider.

---

## Phase 7 — OpenRouter Enhancement

**Modified:** `src/engine/openrouter.ts`

- Switch from `axios` to the `openai` SDK (OpenRouter exposes an OpenAI-compatible API), consistent with how `groq` and `deepseek` engines are implemented
- Update `baseURL` to `https://openrouter.ai/api/v1`
- Update `HTTP-Referer` to fork repo URL, `X-Title` to `OpenCommitX`
- Pass `max_tokens`, respect `OCO_TOKENS_MAX_OUTPUT`
- Add OpenRouter free model list note in `MODEL_LIST.openrouter` (many free models available via `:free` suffix)

---

## Phase 8 — Enhanced Configuration

**Modified:** `src/commands/config.ts`, `src/commands/setup.ts`

### 8a — `ocox config describe [key]`

Current behavior: shows static description only, does not show current value. Fix to show:

```
Key:     OCO_MODEL
Default: gpt-4o-mini
Current: claude-3-5-haiku-20241022  (from ~/.opencommit)
Description: The LLM model to use for generating commit messages.
```

### 8b — `ocox setup full`

Add a `full` subcommand to `setup.ts` that walks through ALL config keys interactively (enter = use current/default), with type-aware prompts (boolean toggle, enum select, number input, string text).

---

## Phase 9 — Model Management

**Modified:** `src/commands/models.ts`

Add subcommands:

- `ocox models add <provider> <model-name>` — appends to `~/.opencommit-custom-models.json`
- `ocox models remove <provider> <model-name>` — removes from custom models file
- `ocox models list [provider]` — shows built-in + custom models

Custom models file merged with `MODEL_LIST` at runtime. For OpenRouter: `ocox models add openrouter google/gemma-3-27b-it:free`.

---

## Phase 10 — Dry Run Support

**Modified:** `src/cli.ts`, `src/commands/commit.ts`

Add `--dry-run` / `-d` flag to the top-level CLI. When set:

- Sets `OCO_TEST_MOCK_TYPE=commit-message` for the current invocation only (no global config change)
- Prints the generated mock commit message without committing
- Useful for testing prompt configs, OpenRouter free models, etc.

Current `OCO_TEST_MOCK_TYPE` is undocumented — add it to `config describe` with explanation.

---

## Phase 11 — Upstream Fork Protection

**Files:** `.github/workflows/`

- Keep `test.yml`, `dependency-review.yml`, `codeql.yml` — they are self-contained
- Add comment to `src/github-action.ts` noting the upstream repo reference in the force-push path
- The `package.json` `"release"` block references `semantic-release` branch `master` — this only fires when `npm publish` is run manually, so no upstream contact risk
- Do NOT delete any workflow files; document them in `xdocs/DEPLOYMENT_INSTRUCTIONS.md`

---

## Phase 12 — Documentation

**New files in `xdocs/`:**

### `xdocs/README.md` — differences from upstream, new commands, config reference

### `xdocs/PROMPT_ANALYSIS.md` — comprehensive prompt mode breakdown


| Mode                    | Config                          | Pros                                           | Cons                              | When to use                                 |
| ----------------------- | ------------------------------- | ---------------------------------------------- | --------------------------------- | ------------------------------------------- |
| **Conventional Commit** | default                         | Semantic-release compatible, widely understood | Mechanical                        | Shared repos, CI/CD pipelines               |
| **commitlint**          | `OCO_PROMPT_MODULE=@commitlint` | Matches project rules exactly                  | Requires setup, LLM pre-run       | Projects with strict commitlint enforcement |
| **GitMoji compact**     | `OCO_EMOJI=true`                | Visual scanning in git log                     | Subjective emoji selection        | Personal projects, visual teams             |
| **GitMoji full**        | `--fgm`                         | 60+ semantic emoji categories                  | Overload, inconsistent picks      | Rarely recommended                          |
| **With description**    | `OCO_DESCRIPTION=true`          | Body explains WHY                              | More tokens, noisier log          | Complex refactors, architectural changes    |
| **One-line**            | `OCO_ONE_LINE_COMMIT=true`      | Clean, compact log                             | Loses granularity for large diffs | Single-file fixes, hotpatches               |
| **Scope omitted**       | `OCO_OMIT_SCOPE=true`           | Simpler format                                 | Less traceable by module          | Small repos without scoped modules          |


The `OCO_WHY=true` key exists in the config enum but has no corresponding prompt injection in `prompts.ts` — this is a bug/incomplete feature to fix.

### `xdocs/DEPLOYMENT_INSTRUCTIONS.md` — build, local test, and npm publish steps

---

## Phase 13 — Test Suite Extension

**New/modified files in `test/`:**

- `test/unit/commitCache.test.ts` — cache hit/miss, TTL expiry, hash collision
- `test/unit/diffRouter.test.ts` — numstat parsing, routing decisions
- `test/unit/perProviderKeys.test.ts` — key resolution fallback chain
- `test/e2e/multiFileCommit.test.ts` — per-file mode end-to-end
- `test/e2e/dryRun.test.ts` — `--dry-run` flag
- Update `.github/workflows/test.yml` to run with `opencommitx`/`ocox` bin names after rename

---

## Dependency Changes

No new runtime dependencies required for phases 1-10. The `child_process` module is Node built-in. The `crypto` module (already a dependency) handles diff hashing.

---

## Deferred / Out of Scope for Initial Plan

- Smart model routing (estimating tokens to pick cheap vs. expensive model automatically) — foundation laid by Phase 4 token estimation but deferred
- Context window sharing strategy for multi-chunk requests — the existing greedy bin-packing is retained; configurable context mode deferred
- i18n for new CLI messages (new strings added in English only for now)

