# OpenCommitX

A fork of [opencommit](https://github.com/di-sukharev/opencommit) with extensions for smarter diff routing, pre-commit result caching, per-provider API keys, fallback model support, and an enhanced configuration experience.

Repository: [github.com/xwberry/opencommitx](https://github.com/xwberry/opencommitx)

---

## What's Different from Upstream

| Feature                       | opencommit            | opencommitx                                                               |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------- |
| CLI aliases                   | `oco`, `opencommit`   | `ocox`, `opencommitx`                                                     |
| Config file                   | `~/.opencommit`       | `~/.opencommitx-data/config.ini`                                          |
| Pre-commit cache              | None                  | Per-group JSON files; survives hook failures; archives on commit          |
| Diff routing                  | Always aggregate      | Smart per-file routing + subdirectory-aware grouping                      |
| Per-file commit loop          | Not supported         | Optional per-file messages with Accept/Skip/Accept All                    |
| Multi-commit file association | Not supported         | `buildCommitPlan` correctly stages each file group before committing      |
| Python large files            | Full diff always sent | Docstring-only extraction when diff ≥ ratio of file                       |
| Per-provider API keys         | Single `OCO_API_KEY`  | `OCO_OPENAI_KEY`, `OCO_ANTHROPIC_KEY`, etc.                               |
| Fallback model                | Not supported         | `OCO_FALLBACK_MODEL` auto-retries on rate-limit/unavailability            |
| Temperature control           | Hardcoded 0           | `OCO_TEMPERATURE` (0.0–2.0)                                               |
| Verbosity control             | Not available         | `OCO_COMMIT_DETAIL` (concise/normal/detailed)                             |
| Staged-files table            | Not available         | Pre-generation table showing +/- lines, new file?, docstring mode, group# |
| Regeneration                  | Simple Y/N prompt     | Sub-menu with concise/detailed/feedback options                           |
| Benchmark                     | Not available         | `ocox benchmark` — test up to 10 models against a diff with AI grading    |
| `config describe`             | Shows default only    | Shows current value, thematic order                                       |
| `setup full`                  | Not available         | Full walkthrough of all config keys                                       |
| Generation timeout            | Hardcoded 90s         | `OCO_GENERATION_TIMEOUT_SECONDS`                                          |

---

## Installation

```bash
npm install -g opencommitx
```

This installs the `ocox` and `opencommitx` CLI commands. It does **not** register `oco` or `opencommit` aliases — install this alongside the original `opencommit` package without conflicts.

> **Note:** API keys are stored in plain text in `~/.opencommitx-data/config.ini`. Keep this file private and do not commit it to source control.

---

## Quick Start

```bash
ocox setup          # provider + model setup
git add .
ocox                # generate commit message
```

### Full Setup (all config keys)

```bash
ocox setup full
```

---

## Commands

### Commit

```bash
ocox                            # stage + generate + commit
ocox --yes / -y                 # skip confirmation
ocox --dry-run / -d             # preview message without committing
ocox --context "migration work" # add context to the prompt
ocox --fgm                      # use full GitMoji spec
```

### Config

```bash
ocox config set OCO_MODEL=claude-3-5-haiku-20241022
ocox config get OCO_MODEL
ocox config describe            # all keys with current values (thematic order)
ocox config describe OCO_MODEL  # specific key with current value
```

### Models

```bash
ocox models                     # list models for current provider
ocox models list openrouter     # list models for a specific provider
ocox models --refresh           # refresh model list from API
ocox models add openrouter google/gemma-3-27b-it:free
ocox models remove openrouter google/gemma-3-27b-it:free
```

### Setup

```bash
ocox setup           # quick provider/model wizard
ocox setup full      # walk through all config keys
```

### Benchmark

```bash
ocox benchmark         # run benchmark against current staged diff
ocox benchmark setup   # configure benchmark models and evaluator
```

### Other

```bash
ocox hook set        # install prepare-commit-msg git hook
ocox hook unset      # remove the hook
ocox commitlint      # configure @commitlint integration
```

---

## Configuration Reference

All settings are stored in `~/.opencommitx-data/config.ini` (INI format). Environment variables and a local `.env` file take precedence.

### Provider & Model

| Key               | Default       | Description                                                                                                                                    |
| ----------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `OCO_AI_PROVIDER` | `openai`      | Provider: `openai`, `anthropic`, `openrouter`, `gemini`, `groq`, `mistral`, `deepseek`, `aimlapi`, `azure`, `ollama`, `mlx`, `flowise`, `test` |
| `OCO_MODEL`       | `gpt-4o-mini` | Model name for the selected provider                                                                                                           |
| `OCO_API_KEY`     | —             | Generic API key (fallback if provider-specific key not set)                                                                                    |
| `OCO_API_URL`     | —             | Custom base URL (proxy, Azure endpoint, etc.)                                                                                                  |

### Fallback Model

| Key                     | Default | Description                                                                            |
| ----------------------- | ------- | -------------------------------------------------------------------------------------- |
| `OCO_FALLBACK_MODEL`    | —       | Model ID to retry on rate-limit/timeout errors                                         |
| `OCO_FALLBACK_PROVIDER` | —       | Provider for the fallback model (required when naming convention differs from primary) |

### Per-Provider API Keys

Provider-specific keys take precedence over `OCO_API_KEY`.

| Key                  | Provider      |
| -------------------- | ------------- |
| `OCO_OPENAI_KEY`     | OpenAI        |
| `OCO_ANTHROPIC_KEY`  | Anthropic     |
| `OCO_OPENROUTER_KEY` | OpenRouter    |
| `OCO_GEMINI_KEY`     | Google Gemini |
| `OCO_GROQ_KEY`       | Groq          |
| `OCO_MISTRAL_KEY`    | Mistral AI    |
| `OCO_DEEPSEEK_KEY`   | DeepSeek      |
| `OCO_AIMLAPI_KEY`    | AI/ML API     |
| `OCO_AZURE_KEY`      | Azure OpenAI  |

### Token Limits

| Key                     | Default | Description           |
| ----------------------- | ------- | --------------------- |
| `OCO_TOKENS_MAX_INPUT`  | `4096`  | Maximum input tokens  |
| `OCO_TOKENS_MAX_OUTPUT` | `500`   | Maximum output tokens |

### Generation

| Key                              | Default  | Description                                                               |
| -------------------------------- | -------- | ------------------------------------------------------------------------- |
| `OCO_TEMPERATURE`                | `0`      | Sampling temperature (0.0–2.0). 0 = deterministic                         |
| `OCO_COMMIT_DETAIL`              | `normal` | Verbosity: `concise` (one-liner), `normal`, `detailed` (full description) |
| `OCO_GENERATION_TIMEOUT_SECONDS` | `90`     | Per-group generation timeout; increase for slow models/networks           |

### Commit Format

| Key                   | Default               | Description                                      |
| --------------------- | --------------------- | ------------------------------------------------ |
| `OCO_PROMPT_MODULE`   | `conventional-commit` | `conventional-commit` or `@commitlint`           |
| `OCO_EMOJI`           | `false`               | Prefix with GitMoji emoji                        |
| `OCO_ONE_LINE_COMMIT` | `false`               | Force single-line commit message                 |
| `OCO_DESCRIPTION`     | `false`               | Add ~3 sentence body explaining WHY              |
| `OCO_WHY`             | `false`               | Add explicit "Why:" section after message        |
| `OCO_OMIT_SCOPE`      | `false`               | Drop `(<scope>)` from conventional commit format |
| `OCO_LANGUAGE`        | `en`                  | Output language for commit messages              |

### Smart Diff Routing

| Key                            | Default  | Description                                                                                       |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `OCO_PER_FILE_COMMIT_MODE`     | `auto`   | `auto` (threshold-based), `always` (per-file with boilerplate grouping), `never` (aggregate)      |
| `OCO_PER_FILE_THRESHOLD_LINES` | `300`    | Total changed lines (added+deleted) above which a file gets its own group                         |
| `OCO_MAX_FILES_PER_GROUP`      | `10`     | Max files per commit group in auto mode                                                           |
| `OCO_MAX_LINES_PER_GROUP`      | `1500`   | Max total changed lines per group in auto mode — prevents oversized groups                        |
| `OCO_MULTI_COMMIT_STRATEGY`    | `single` | `single` (combine all group messages into one commit) or `sequential` (one commit per file group) |

In `auto` mode, small-file groups are sorted by directory path before binning, so files in the same subdirectory naturally end up together. Lock files (`pixi.lock`, `package-lock.json`, etc.) are attached to the group containing their manifest.

### Python Docstring Extraction

| Key                                     | Default | Description                                                                          |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `OCO_PYTHON_DOCSTRING_MODE`             | `auto`  | `auto`, `always`, `never`                                                            |
| `OCO_PYTHON_DOCSTRING_THRESHOLD`        | `500`   | Min added lines before extraction is considered                                      |
| `OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO` | `0.9`   | `addedLines / totalLines` must be ≥ ratio — prevents extraction on partial refactors |

### Cache

| Key                     | Default | Description                    |
| ----------------------- | ------- | ------------------------------ |
| `OCO_CACHE_ENABLED`     | `true`  | Cache LLM results by diff hash |
| `OCO_CACHE_TTL_SECONDS` | `3600`  | Cache TTL in seconds (1 hour)  |

Cache is stored per-repo at `~/.opencommitx-data/<repo>/<diffhash>.json`. Each file group gets its own cache entry. On successful commit, entries are archived to `archived/` and pruned after the TTL. If the cached model differs from the current model, a warning is shown with an option to regenerate.

### Developer / Testing

| Key                       | Default          | Description                                                  |
| ------------------------- | ---------------- | ------------------------------------------------------------ |
| `OCO_DEBUG`               | `false`          | Write full prompts/responses to `~/.opencommitx-data/debug/` |
| `OCO_TEST_MOCK_TYPE`      | `commit-message` | Mock type for `--dry-run` and test provider                  |
| `OCO_HOOK_AUTO_UNCOMMENT` | `false`          | Auto-uncomment message in prepare-commit-msg hook            |
| `OCO_GITPUSH`             | `true`           | Prompt to push after committing (deprecated)                 |

---

## Using OpenRouter

OpenRouter gives access to many models including free tiers. Get your key at [openrouter.ai/keys](https://openrouter.ai/keys).

```bash
ocox config set OCO_AI_PROVIDER=openrouter
ocox config set OCO_OPENROUTER_KEY=sk-or-...
ocox models add openrouter google/gemma-3-27b-it:free
ocox config set OCO_MODEL=google/gemma-3-27b-it:free
ocox --dry-run   # test without committing
```

Free models on OpenRouter use the `:free` suffix.

---

## Pre-commit Hook Integration

The cache was designed for pre-commit hook workflows:

1. Run `ocox` — LLM generates a message, cached by diff hash per group
2. `git commit` runs pre-commit hooks (ruff, gitleaks, etc.)
3. Hooks fix/fail the commit
4. Run `ocox` again — cache hit detected, same message offered instantly
5. No LLM call needed; on successful commit the cache entry is archived

Configure cache TTL: `ocox config set OCO_CACHE_TTL_SECONDS=7200`

---

## Fallback Model

If your primary model is rate-limited or unavailable, opencommitx can automatically retry with a fallback:

```bash
ocox config set OCO_FALLBACK_MODEL=anthropic/claude-3-5-haiku
ocox config set OCO_FALLBACK_PROVIDER=openrouter
```

Different providers use different naming conventions. OpenRouter uses `provider/model` while Anthropic native uses `claude-3-5-haiku-20241022`. If the fallback fails due to a naming mismatch, opencommitx will prompt you to set the correct provider interactively.

---

## Python Docstring Extraction

For large Python files, opencommitx extracts docstrings instead of sending the full diff, saving tokens. Both conditions must be true:

1. `addedLines > OCO_PYTHON_DOCSTRING_THRESHOLD` (default 500)
2. `addedLines / totalFileLines >= OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO` (default 0.9)

The ratio prevents extraction on partial refactors — it only triggers for near-complete rewrites. Requires Python 3 in `PATH`.

---

## Benchmark (`ocox benchmark`)

Compare up to 10 models on a single diff and have an AI evaluator grade each result:

```bash
ocox benchmark setup   # configure candidate models and evaluator
ocox benchmark         # run against current staged diff
```

Configuration is stored in `~/.opencommitx-data/benchmark.json`. Results are written to `benchmark_results.md` with per-model commit messages, scores, latency, token counts, and cost. At the end you can select the winning model to set it as your default.

---

## Prompt Modes

See [PROMPT_ANALYSIS.md](PROMPT_ANALYSIS.md) for a full breakdown of each prompt configuration.

---

## CI / GitHub Actions

The included workflow (`.github/workflows/test.yml`) runs unit tests with Node.js and Python 3.11 (required for docstring extractor tests). E2E tests run on Linux (Ubuntu).

---

## Upstream Relationship

This fork adds features on top of `opencommit` without rewriting the core commit flow. The config file (`~/.opencommitx-data/config.ini`) and binary names (`ocox`, `opencommitx`) are distinct from the original so both packages can be globally installed simultaneously without conflict.
