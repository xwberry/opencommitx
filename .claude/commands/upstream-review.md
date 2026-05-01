Review upstream `di-sukharev/opencommit` releases and merged changes since this fork's last upstream review (or a user-supplied anchor) and recommend which upstream changes to **port**, **adapt**, **skip**, or **watch**.

This is a fork that does **not** auto-sync from upstream. Many fork features have intentionally diverged — config file location (`~/.opencommitx-data/`), per-provider API keys, smart diff routing, multi-commit strategies, benchmark harness, fallback model, OpenRouter-via-OpenAI-SDK, the typed-error hierarchy in `utils/errors.ts`, etc. Don't recommend porting changes that conflict with those decisions; **do** recommend porting genuine bug fixes, security patches, and capability additions that are still relevant.

Read `CLAUDE.md` and `xdocs/REVIEW.md` §1–8 first so you understand what the fork has intentionally changed before deciding whether an upstream patch is additive, redundant, or in conflict.

## Arguments

`/upstream-review [<from-ref>]`

- `<from-ref>` (optional) — a tag, version, or commit SHA in the upstream repo to use as the anchor (e.g. `/upstream-review v3.2.4` or `/upstream-review abc1234`).
- If omitted, anchor resolves via the precedence in **Anchor resolution** below.

## Anchor resolution

Use this precedence and stop at the first match:

1. **User-supplied `<from-ref>`** from the command argument.
2. **The most recent prior review's "Reviewed up to" SHA** — read the latest `xdocs/upstream-reviews/<YYYY-MM-DD>/SUMMARY.md` (sorted by directory name) and extract its `**Reviewed up to:** <sha>` line. That SHA becomes the new anchor.
3. **Fork-point fallback** — if no prior review exists and no argument is given, **stop and ask the user** for the upstream version/commit they originally forked from (`v3.0.x` is plausible based on the README). Don't guess; the answer affects every downstream recommendation.

Whatever resolves becomes `$ANCHOR` for the rest of the review.

## Scope

- **Upstream repo:** `di-sukharev/opencommit`
- **Sources to consult**, in priority order:
  - GitHub releases between `$ANCHOR` and `HEAD`: `gh api 'repos/di-sukharev/opencommit/releases?per_page=100'`
  - Commit log + diff: `gh api 'repos/di-sukharev/opencommit/compare/<ANCHOR>...HEAD'` (gives ahead-by, files-changed, commit list, totals)
  - Pull requests merged in the range: `gh pr list -R di-sukharev/opencommit --state merged --search 'merged:>YYYY-MM-DD' --json number,title,mergedAt,labels,url --limit 200`
  - Specific file diffs for fork-relevant paths via `gh api repos/.../contents/<path>?ref=<sha>` (raw content) or `gh api repos/.../commits/<sha>` for per-commit detail
  - Upstream `README.md` and any `CHANGELOG*` files at HEAD

- **Fork-relevant paths to compare against:**
  - `src/cli.ts`, `src/commands/*.ts`, `src/engine/*.ts`, `src/utils/*.ts`, `src/prompts.ts`, `src/migrations/*.ts`, `src/generateCommitMessageFromGitDiff.ts`, `src/github-action.ts`
  - `package.json` (deps + scripts), `action.yml`, `.github/workflows/*`
  - `scripts/extract_docstrings.py` (no upstream equivalent — fork-only)

Skip:
- `out/`, `dist/`, `node_modules/`, lockfiles
- Upstream-only infra (their own README marketing, branding assets, npm scripts the fork has renamed)
- Any path the fork has deliberately removed or replaced

## Approach

1. **Resolve `$ANCHOR`** per the precedence above. Record the upstream HEAD SHA at the time of this review — that becomes `$REVIEWED_UP_TO` and is the anchor for the next review.

2. **Enumerate changes.** Produce three lists from `$ANCHOR..HEAD`:
   - Releases (with release notes)
   - Merged PRs (title + labels + brief)
   - Commits not associated with a PR (often direct-to-main fixes)
   If the range is large (>50 PRs or >200 commits), summarise rather than enumerate, and surface the cap so the user knows you abbreviated.

3. **For each notable change**, locate the affected fork-side path(s) and read the corresponding fork code. Then categorise into exactly one of:

   | Verdict | Meaning |
   | --- | --- |
   | **PORT (verbatim)** | Fork hasn't touched this area. Upstream patch should apply with minimal translation. |
   | **PORT (adapted)** | Area has diverged. Describe how the upstream *intent* translates to the fork's structure (e.g. "upstream adds `OCO_FOO` env var → in the fork this becomes a `CONFIG_KEYS.OCO_FOO` entry with validator + `getConfigKeyDetails` case + `THEMATIC_KEY_ORDER` placement, per CLAUDE.md"). |
   | **SKIP — already handled** | Fork already implements this, often more thoroughly. Cite the fork's equivalent file:line. |
   | **SKIP — incompatible** | Fork has an intentional opposite decision. Cite the divergence and why porting would regress the fork. |
   | **SKIP — irrelevant** | Change targets upstream-only infra (their CI, branding, npm script aliases the fork doesn't share). |
   | **WATCH** | Upstream is mid-development on this; revisit at the next review. Explain the signal you're tracking. |

4. **For PORT verdicts**, attach an effort/impact gloss (`S/M/L effort × S/M/L impact`) and, where useful, a concrete fork-side patch sketch (file paths + a one-paragraph description, not actual code edits — this is read-only).

5. **Synthesise a `SUMMARY.md`** that links to the per-section detail file(s) and surfaces the highest-value PORT recommendations.

### When to spawn subagents

For ranges with many changes touching multiple modules, spawn Explore subagents in parallel:
- One per affected fork module group (engine/, commands/, utils/, prompts/, migrations/, build & CI)
- Each subagent reviews its slice of upstream changes against the corresponding fork code and writes a per-area file
- Orchestrator (you) synthesises `SUMMARY.md`

For small ranges (a single release, <10 PRs), a single linear pass is fine — write one `changes.md` plus `SUMMARY.md`.

## Output format

Outputs are written to `xdocs/upstream-reviews/<YYYY-MM-DD>/`, where `<YYYY-MM-DD>` is today's ISO date. If the directory exists for today, suffix with `-rerun` — never overwrite.

### Per-area files (when subagents are used)

| File | Scope |
| --- | --- |
| `SUMMARY.md` | Top-level synthesis (orchestrator writes this) |
| `engines.md` | Upstream changes affecting `src/engine/*` |
| `commands.md` | Upstream changes affecting `src/commands/*` and `src/cli.ts` |
| `utils-prompts.md` | Upstream changes affecting `src/utils/*` and `src/prompts*` |
| `build-ci.md` | `package.json`, `esbuild.config.js`, `.github/workflows/*`, `action.yml` |
| `migrations-config.md` | `src/migrations/*` and config schema changes |

For a single-pass review, write one `changes.md` instead.

### Per-area file structure

```
## Releases in range

- **vX.Y.Z** (YYYY-MM-DD) — <one-line summary>
  Notable changes: ...

## PORT (verbatim)
- **<short title>** — upstream commit `abc1234` / PR `#NNN`
  Affected fork path: `src/.../foo.ts`
  Effort × impact: `S × M`
  <2–4 line rationale>

## PORT (adapted)
- **<short title>** — upstream `abc1234`
  Affected fork path: `src/.../bar.ts`
  Effort × impact: `M × L`
  <description of upstream intent + how to translate to fork's structure>

## SKIP — already handled
- **<short title>** — upstream `abc1234`
  Fork equivalent: `src/utils/commitCache.ts:104` — fork's hashing already covers this
  <1–2 line rationale>

## SKIP — incompatible
- **<short title>** — upstream `abc1234`
  Fork divergence: per-provider keys vs upstream's single OCO_API_KEY
  <1–2 line rationale referencing CLAUDE.md or REVIEW.md>

## SKIP — irrelevant
- **<short title>** — upstream `abc1234`
  <1 line: why the change doesn't apply to fork>

## WATCH
- **<short title>** — upstream `abc1234`
  Signal to track: <what to look for next review>
```

### `SUMMARY.md` structure

Open with the metadata block exactly:

```
# Upstream Review — <YYYY-MM-DD>

**Upstream:** di-sukharev/opencommit
**Anchor (start):** <tag-or-sha-from-anchor-resolution>
**Reviewed up to:** <upstream-HEAD-sha-at-time-of-review>
**Range:** <ANCHOR>..<HEAD>  (N commits, M PRs, R releases)
**Previous review:** xdocs/upstream-reviews/<earlier>/SUMMARY.md (or "none — first review")
```

The `**Reviewed up to:**` line is **load-bearing** — it's what the next review reads to set its anchor. Make sure it's a real commit SHA, not a tag (tags can move).

Then sections:
1. **Delta from previous review** (if one exists): which earlier-WATCH items have resolved, which earlier-PORT recommendations got applied (look for them in fork's `git log`), which got rejected.
2. **Top PORT recommendations** (3–5 bullets, ROI-ranked, with effort × impact).
3. **Top SKIP — incompatible** (so this divergence is documented and doesn't get re-asked next review).
4. **Categorised counts** — table of `PORT (verbatim) | PORT (adapted) | SKIP — already | SKIP — incompatible | SKIP — irrelevant | WATCH` totals so the user sees the shape of the work.
5. **Architectural drift notes** — directional changes upstream that don't translate to a single PR but are worth knowing (e.g. "upstream is moving toward a plugin architecture for engines; the fork's `getEngine()` switch is the equivalent surface").
6. **Links to per-area files** with one-line previews.
7. **Final summary block** (see below).

Keep `SUMMARY.md` under ~300 lines.

## Guardrails

- **Read-only against the fork** — do not modify any code, config, or fixture. The only files written are under `xdocs/upstream-reviews/<YYYY-MM-DD>/`.
- **Don't hit upstream APIs unbounded.** If the diff range exceeds 50 PRs / 200 commits, abbreviate and surface the cap. Don't paginate forever.
- **Don't recommend reverting deliberate fork features.** Per-provider keys, `~/.opencommitx-data/` config dir, multi-commit strategies, benchmark harness, fallback model, smart diff routing, Python docstring extraction, the typed-error hierarchy — all intentional. If upstream lacks them or removed them, that is **not** a reason to remove them from the fork.
- **Trust the divergence direction set in `CLAUDE.md` and `xdocs/REVIEW.md`.** If the fork has a stronger pattern (e.g. typed errors via `engineErrorHandler`), don't port a less rigorous upstream version.
- **Don't conflate "upstream removed X" with "fork should remove X".** Upstream pruning of features the fork relies on means PORT nothing — *and* note it as a divergence to be aware of.
- **Flag large ports as plans, not patches.** If a recommendation requires >200 lines of code or touches >5 files, surface it as a candidate for a `xdocs/plans/<feature>.plan.md` document rather than as a one-shot PORT.
- **Cite upstream commits/PRs by SHA or `#NNN`** so the user can verify.
- **Don't echo `CLAUDE.md` or `xdocs/REVIEW.md` back.** Apply them.

## Final summary (last block of `SUMMARY.md`)

End with:
- **Top 3 ports** to schedule next (with effort × impact and a one-line scope)
- **Top 3 explicit non-ports** (with one-line rationale — these become the "don't re-ask" memo for the next review)
- **WATCH list** — items that need a follow-up review when upstream stabilises
- **Anchor for next review:** `**Reviewed up to:** <sha>` (repeat the SHA so it's findable as the literal anchor for `/upstream-review` on next run)
- **Recommended follow-up commands** — e.g. `/deep-review` if the ports trigger meaningful changes, `/security-check` if a security advisory was found, `/add-tests <module>` if a port lands in an under-tested area
