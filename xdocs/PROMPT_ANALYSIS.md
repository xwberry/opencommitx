# OpenCommitX Prompt Analysis

A guide to all prompt configuration options available in OpenCommitX, including how they work, their trade-offs, and when to use each.

---

## How Prompts Work

Every commit generation sends a 3-message chat array to the LLM:

1. **System message** — Built dynamically from config flags (identity, convention, format rules, language, user context)
2. **User message** — A hardcoded example diff (port→PORT rename) used as a few-shot example
3. **Assistant message** — A consistency example in the target language showing the expected response format

The combination of `OCO_PROMPT_MODULE` and various format flags determine the content of these messages.

---

## Prompt Modules

### 1. `conventional-commit` (default)

**Config:** `OCO_PROMPT_MODULE=conventional-commit` (or leave unset)

The default mode. Uses the Conventional Commit specification keywords: `fix`, `feat`, `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`.

**Output format:**
```
fix(auth): correct token expiry calculation
```

**Pros:**
- Industry standard, widely understood by developers and tooling
- Compatible with semantic-release, standard-version, and changelog generators
- Predictable structure that works well in CI/CD pipelines
- No project-specific setup required

**Cons:**
- Can feel mechanical for personal or exploratory projects
- Keyword selection (fix vs refactor vs style) can be ambiguous
- Does not enforce project-specific conventions beyond the 10 standard types

**Recommended for:** Shared repos, open source projects, teams using semantic versioning, any repo that feeds into a changelog generator.

---

### 2. `@commitlint`

**Config:** `OCO_PROMPT_MODULE=@commitlint`

Uses your project's existing `@commitlint` configuration to infer rules, then generates a JSON consistency blob that teaches the LLM to follow those exact rules. Requires a one-time setup step (`ocox commitlint`) that calls the LLM to analyze your commitlint config.

**Output format:** Matches whatever your `commitlint.config.js` defines.

**Setup:**
```bash
ocox commitlint       # one-time per project
ocox config set OCO_PROMPT_MODULE=@commitlint
```

**Pros:**
- Matches your project's exact conventions automatically
- Supports custom commit types, scopes, and rules
- Works even with non-standard commit formats

**Cons:**
- Requires a separate LLM call at setup time
- Cache file (`.opencommit-commitlint`) must be regenerated if commitlint config changes
- Can be brittle if commitlint rules are highly complex or use custom plugins

**Recommended for:** Projects with strict commitlint enforcement, monorepos with custom type conventions, teams with existing commitlint setups they want to preserve.

---

## Format Flags

These flags modify the output of either prompt module.

### GitMoji Compact (`OCO_EMOJI=true`)

**Config:** `ocox config set OCO_EMOJI=true`

Adds an emoji prefix from a subset of ~10 most common GitMoji:

| Emoji | Meaning |
|---|---|
| 🐛 | Fix a bug |
| ✨ | Introduce new features |
| 📝 | Documentation |
| 🚀 | Deploy |
| ✅ | Tests |
| ♻️ | Refactor |
| ⬆️ | Upgrade dependencies |
| 🔧 | Configuration |
| 🌐 | i18n |
| 💡 | Source code comments |

**Output format:**
```
✨ feat(auth): add OAuth2 login support
```

**Pros:** Visual scanning in git log, quick recognition of commit type  
**Cons:** Subjective emoji assignment, not all CI tools parse emoji well  
**Recommended for:** Personal projects, visual-oriented teams, repos where log readability matters more than tooling compatibility.

---

### GitMoji Full (`--fgm` flag)

**CLI usage:** `ocox --fgm`

Uses the full GitMoji specification (~60 emoji). Cannot be set permanently — must be passed as a flag each run.

**Pros:** Very expressive, covers edge cases like database changes, security fixes, and animations  
**Cons:** 60 choices leads to inconsistency; LLM often picks suboptimally from large sets  
**Recommended for:** Rarely. Use compact GitMoji (`OCO_EMOJI=true`) instead for day-to-day work.

---

### Description Body (`OCO_DESCRIPTION=true`)

**Config:** `ocox config set OCO_DESCRIPTION=true`

Adds a ~3 sentence body below the commit subject explaining WHY the changes were made (not what).

**Output format:**
```
fix(auth): correct token expiry calculation

Token expiry was calculated using server time instead of UTC, causing
intermittent authentication failures in non-UTC timezones. Updated the
calculation to always use UTC to ensure consistent behavior.
```

**Pros:** Rich git history, context preserved for future developers, explains motivation  
**Cons:** More tokens consumed (higher cost), noisier `git log --oneline`, not useful for trivial changes  
**Recommended for:** Complex refactors, architectural decisions, bug fixes with non-obvious root causes.

---

### Why Section (`OCO_WHY=true`)

**Config:** `ocox config set OCO_WHY=true`

Adds a brief "Why:" section after the commit message explaining the motivation (distinct from description — this is more explicit).

**Output format:**
```
fix(auth): correct token expiry calculation

Why: Server-side time was used instead of UTC, causing failures in non-UTC timezones.
```

**Pros:** Makes motivation explicit and searchable in git log  
**Cons:** Can overlap with `OCO_DESCRIPTION` if both are enabled; adds tokens  
**Recommended for:** Code review workflows where "why" is more important than "what".

---

### One-Line Commit (`OCO_ONE_LINE_COMMIT=true`)

**Config:** `ocox config set OCO_ONE_LINE_COMMIT=true`

Forces the commit message to be a single concise sentence summarizing all changes.

**Output format:**
```
fix(auth): correct token expiry and add UTC normalization for multi-timezone support
```

**Pros:** Cleaner `git log --oneline`, good for repos with many small commits  
**Cons:** Loses granularity for large diffs; the LLM has to compress everything into one thought  
**Recommended for:** Single-file patches, hotfixes, teams with high commit frequency and low per-commit significance.

---

### Omit Scope (`OCO_OMIT_SCOPE=true`)

**Config:** `ocox config set OCO_OMIT_SCOPE=true`

Drops the `(<scope>)` portion from conventional commit format.

**Output format:**
```
fix: correct token expiry calculation
```

**Pros:** Simpler messages, less overhead when scope isn't meaningful  
**Cons:** Harder to filter commits by module/subsystem in large repos  
**Recommended for:** Small projects without distinct modules, or when scope categorization adds no value.

---

## User Context (`--context` / `-c`)

**CLI usage:** `ocox -c "This refactor is part of the auth v2 migration"`

Injects user-supplied context into the system prompt via `<context>...</context>` tags. The LLM is instructed to incorporate this when appropriate.

**Recommended for:** Any situation where the diff alone doesn't capture the full picture (e.g., partial refactors, migration work, intentional technical debt).

---

## Situational Recommendations

| Scenario | Recommended Config |
|---|---|
| Shared repo with semantic versioning | `OCO_PROMPT_MODULE=conventional-commit` (defaults) |
| Project with strict commitlint rules | `OCO_PROMPT_MODULE=@commitlint` |
| Personal projects, visual git log | `OCO_EMOJI=true` |
| Complex refactors / architectural changes | `OCO_DESCRIPTION=true` + `OCO_WHY=true` |
| High-frequency small commits | `OCO_ONE_LINE_COMMIT=true` |
| Testing prompts and models | `ocox --dry-run` |
| Initial repo commit (many files) | `OCO_PER_FILE_COMMIT_MODE=always` or `auto` |
| Large Python file changes | `OCO_PYTHON_DOCSTRING_MODE=auto` (default) |

---

## OCO_TEST_MOCK_TYPE (Dry Run)

**Config key:** `OCO_TEST_MOCK_TYPE`  
**Values:** `commit-message`, `prompt-module-commitlint-config`

This key controls what the `test` provider returns when `OCO_AI_PROVIDER=test`. It is normally used only in automated testing, but is also activated by the `--dry-run` / `-d` flag:

```bash
ocox --dry-run        # generates a mock message, does not commit
ocox -d               # same
```

`commit-message` returns a canned commit message without calling any LLM.  
`prompt-module-commitlint-config` returns a mock commitlint configuration JSON.
