# OpenCommitX

A fork of [opencommit](https://github.com/di-sukharev/opencommit) with extensions for smarter diff routing, pre-commit result caching, per-provider API keys, and an enhanced configuration experience.

---

## What's Different from Upstream

| Feature | opencommit | opencommitx |
|---|---|---|
| CLI aliases | `oco`, `opencommit` | `ocox`, `opencommitx` (plus upstream aliases) |
| Pre-commit cache | None | Caches LLM result by diff hash; survives pre-commit hook failures |
| Diff routing | Always aggregate | Smart per-file routing based on `git diff --numstat` |
| Per-file commit loop | Not supported | Optional per-file messages with Accept/Skip/Accept All |
| Python large files | Full diff always sent | Docstring-only extraction for large `.py` files |
| Per-provider API keys | Single `OCO_API_KEY` | `OCO_OPENAI_KEY`, `OCO_ANTHROPIC_KEY`, etc. |
| OpenRouter engine | axios | OpenAI SDK (OpenAI-compatible endpoint) |
| `config describe` | Shows default only | Shows current value from `~/.opencommit` |
| `setup full` | Not available | Full walkthrough of all config keys |
| `models add/remove` | Not available | Add custom models per-provider |
| `--dry-run` flag | Not available | Generates mock message without committing |
| `OCO_WHY` prompt | Config key exists but unused | Injects "Why:" instruction into system prompt |
| Token limit bug | Config read at module load | Config read inside each function call |

---

## Installation

```bash
npm install -g opencommitx
```

This installs both `ocox` and `opencommitx` CLI aliases.

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
ocox config describe            # all keys with current values
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

### Other

```bash
ocox hook set        # install prepare-commit-msg git hook
ocox hook unset      # remove the hook
ocox commitlint      # configure @commitlint integration
```

---

## Configuration Reference

All settings are stored in `~/.opencommit` (INI format). Environment variables and a local `.env` file take precedence.

### Core Settings

| Key | Default | Description |
|---|---|---|
| `OCO_AI_PROVIDER` | `openai` | Provider: `openai`, `anthropic`, `openrouter`, `gemini`, `groq`, `mistral`, `deepseek`, `aimlapi`, `azure`, `ollama`, `mlx`, `flowise`, `test` |
| `OCO_MODEL` | `gpt-4o-mini` | Model name for the selected provider |
| `OCO_API_KEY` | — | Generic API key (fallback if provider-specific key not set) |
| `OCO_TOKENS_MAX_INPUT` | `4096` | Maximum input tokens |
| `OCO_TOKENS_MAX_OUTPUT` | `500` | Maximum output tokens |
| `OCO_API_URL` | — | Custom base URL (proxy, Azure endpoint, etc.) |

### Per-Provider API Keys (New in opencommitx)

Provider-specific keys take precedence over `OCO_API_KEY`.

| Key | Provider |
|---|---|
| `OCO_OPENAI_KEY` | OpenAI |
| `OCO_ANTHROPIC_KEY` | Anthropic |
| `OCO_OPENROUTER_KEY` | OpenRouter |
| `OCO_GEMINI_KEY` | Google Gemini |
| `OCO_GROQ_KEY` | Groq |
| `OCO_MISTRAL_KEY` | Mistral AI |
| `OCO_DEEPSEEK_KEY` | DeepSeek |
| `OCO_AIMLAPI_KEY` | AI/ML API |
| `OCO_AZURE_KEY` | Azure OpenAI |

### Commit Format

| Key | Default | Description |
|---|---|---|
| `OCO_PROMPT_MODULE` | `conventional-commit` | `conventional-commit` or `@commitlint` |
| `OCO_EMOJI` | `false` | Prefix with GitMoji emoji |
| `OCO_ONE_LINE_COMMIT` | `false` | Force single-line commit message |
| `OCO_DESCRIPTION` | `false` | Add ~3 sentence body explaining WHY |
| `OCO_WHY` | `false` | Add explicit "Why:" section after message |
| `OCO_OMIT_SCOPE` | `false` | Drop `(<scope>)` from conventional commit format |
| `OCO_LANGUAGE` | `en` | Output language for commit messages |

### Cache (New in opencommitx)

| Key | Default | Description |
|---|---|---|
| `OCO_CACHE_ENABLED` | `true` | Cache LLM results by diff hash |
| `OCO_CACHE_TTL_SECONDS` | `3600` | Cache TTL in seconds (1 hour) |

Cache is stored at `~/.opencommit-cache.json`. Solves the pre-commit hook failure loop — if your hooks cancel the commit, the cached message is offered on the next `ocox` run without re-calling the LLM.

### Smart Diff Routing (New in opencommitx)

| Key | Default | Description |
|---|---|---|
| `OCO_PER_FILE_COMMIT_MODE` | `auto` | `auto`, `always`, `never` |
| `OCO_PER_FILE_THRESHOLD_LINES` | `300` | Lines changed above which a file gets its own message |
| `OCO_MULTI_COMMIT_STRATEGY` | `single` | `single` (join messages) or `sequential` (one commit each) |
| `OCO_PYTHON_DOCSTRING_MODE` | `auto` | `auto`, `always`, `never` |
| `OCO_PYTHON_DOCSTRING_THRESHOLD` | `500` | Lines above which Python files use docstring extraction |

### Developer / Testing

| Key | Default | Description |
|---|---|---|
| `OCO_TEST_MOCK_TYPE` | `commit-message` | Mock type for `--dry-run` and test provider |
| `OCO_HOOK_AUTO_UNCOMMENT` | `false` | Auto-uncomment message in prepare-commit-msg hook |
| `OCO_GITPUSH` | `true` | Prompt to push after committing (deprecated) |

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

The cache feature was designed specifically for pre-commit hook workflows:

1. You run `ocox` — LLM generates a message, cached
2. `git commit` runs pre-commit hooks (ruff, gitleaks, etc.)
3. Hooks fix/fail the commit
4. You run `ocox` again — cache hit detected, offers the same message
5. No LLM call needed, same message used

Configure cache TTL: `ocox config set OCO_CACHE_TTL_SECONDS=7200` (2 hours)

---

## Prompt Modes

See [PROMPT_ANALYSIS.md](PROMPT_ANALYSIS.md) for a full breakdown of each prompt configuration, pros/cons, and situational recommendations.

---

## Upstream Relationship

This fork aims to stay reasonably compatible with upstream `opencommit`. The existing `oco` and `opencommit` bin aliases are preserved. Changes are focused on additive features and bug fixes rather than structural rewrites.
