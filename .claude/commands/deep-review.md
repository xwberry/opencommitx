Perform a deep, end-to-end review of the **entire codebase** — not just the diff vs. main. The goal is to surface latent bugs, design weaknesses, security risks, and code-quality issues that already exist in shipped code. Be rigorous; assume nothing is "already reviewed."

Read `CLAUDE.md` first for project context, stack, and standards.

## Scope

Review **all** source under `doc_tools/doc_tools/` plus `tests/`. Do not limit yourself to recently changed files. Treat the working tree as the source of truth — `git log` / `git blame` are only useful for understanding *why* something exists, not for deciding what to review.

Skip:
- Dependency files (`pixi.toml`, `pixi.lock`)
- Generated artifacts and `.pixi/` envs
- `TODO.md` and other scratchpad docs

## Approach

Run this as a structured multi-pass audit. For a codebase the size of `doc_tools`, parallelize the passes by spawning Explore subagents (one per focus area) and synthesizing the findings yourself. Do not rely on a single linear read-through.

### Pass 1 — Architecture map
Build a mental model before judging code. Identify:
- Entry points (`run_app`, CLI, etc.)
- Module boundaries (`gui/`, `pdf/`, `email/`, `markdown/`, `redline/`, `utilities/`)
- Cross-cutting concerns (settings, logging, threading, async)
- External tool boundaries (Ghostscript, Tesseract, Pandoc, Poppler, Anthropic SDK)

Note any architectural smells: circular imports, layering violations (UI calling raw libraries instead of service modules), inconsistent patterns across views.

### Pass 2 — Correctness & bugs
For each module, hunt for:
- Resource leaks (unclosed file handles, `fitz.open` / `pikepdf.Pdf` / workbook handles, subprocess pipes)
- Race conditions and threading issues (shared mutable state, missing locks, `page.run_thread` interactions)
- Async/await mistakes (missing `await`, blocking calls in async funcs, `get_event_loop` misuse)
- Off-by-one, unicode, encoding, and path-handling bugs (Windows vs POSIX, CRLF, BOM, non-ASCII filenames)
- Error-handling gaps: bare `except`, swallowed exceptions, inconsistent error types across module boundaries
- Logic errors in branching, especially in dispatch tables / match statements (exhaustiveness, fallthrough)
- Silent data loss (truncating, dropping rows, ignoring stderr)

### Pass 3 — Security
Beyond the standard `/security-check` checklist, dig into:
- Path traversal in any code that takes untrusted filenames (email attachments, archive extraction, user-provided save paths)
- SSRF / local-file-disclosure in HTML→PDF rendering pipelines (WeasyPrint url_fetcher, Pandoc input)
- Subprocess invocation with user-controlled arguments — even when not shell=True, check for `--` separators and arg injection
- Pickle/yaml.load/eval/exec usage anywhere
- Logging of secrets (API keys, file contents) via `loguru`
- Pydantic models that accept arbitrary fields without validation

### Pass 4 — Code quality & maintainability
- Functions over ~30 lines or with high cyclomatic complexity
- Duplicated logic across views (extract helpers, share via `view_helpers` or components)
- Type-hint gaps on public signatures; `Any`, `cast`, or `# type: ignore` overuse
- Dead code: unused imports, unreferenced functions/classes, unreachable branches
- Inconsistent naming or patterns (e.g., some views using `_run_task`, others not)
- Inappropriate abstractions or premature generalization
- Pydantic v2 idioms (`model_validator`, `field_validator`, `model_copy`) used correctly

### Pass 5 — Tests
- Modules with no test coverage at all
- Tests that mock so heavily they verify nothing
- Golden tests without clear regeneration instructions
- Happy-path-only coverage on functions with non-trivial error paths
- Tests pinned to behavior that contradicts the documented contract (i.e., the test is wrong, not the code)

### Pass 6 — LLM integration (`pdf/ai_analyze.py` and any Anthropic call sites)
- Missing `max_tokens` / `temperature` / retry-with-backoff
- Prompt construction that interpolates untrusted PDF text without bounds (token-bomb risk)
- No prompt-version logging
- Hardcoded model IDs vs. settings-driven model selection
- Cache strategy for deterministic prompts

## Output format

Structure findings in a single report. Group by severity, then by module. Use this format:

```
## CRITICAL (security or data-loss)

### <module/file>
- **<short title>** — `path/to/file.py:LINE`
  <2–4 line description: what's wrong, why it matters, suggested fix direction>

## HIGH (likely bugs / production risk)
...

## MEDIUM (latent issues / design concerns)
...

## LOW (code quality / maintainability)
...

## Architectural observations
<bullet list of cross-cutting concerns that don't fit a single file>
```

Each finding must include:
1. A specific `file.py:LINE` reference (not just the file)
2. A concrete suggestion (not just "consider refactoring")
3. Severity rationale if not obvious

## Guardrails

- **Do not modify any code** during the review — this is a read-only audit. Output the report only.
- **Do not propose changes to fixtures or golden files** without first understanding the test intent. Failing fixtures often signal real behavior changes.
- **Do not suggest dependency changes** — Renovate handles that.
- **Do not flag pure style nits** — ruff and pre-commit handle those.
- **Do not echo CLAUDE.md back** — apply it, don't restate it.
- **Cite file:line for every finding.** Findings without a precise location are not actionable.
- **Prefer fewer high-quality findings over an exhaustive list of nits.** Aim for ~15–40 substantive findings, not 200 trivial ones.

## Final summary

After the report, end with:
- **Top 3 issues** to fix first (the user's actionable shortlist)
- **Modules in best shape** (so the user knows where not to spend triage time)
- **Recommended follow-up commands** (e.g., `/security-check`, `/add-tests <module>`) if any
