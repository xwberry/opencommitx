---
name: OCO_DEBUG_ROUTING log
overview: Add boolean config `OCO_DEBUG_ROUTING` and a small append-only NDJSON logger under `~/.opencommitx-data/debug/` that records a monotonic run id, the same staged-files summary table as the terminal, routing metadata, per-group generation/payload notes, diff-invisible staged files (piggyback path), and paths filtered by `.opencommitignore`.
todos:
  - id: config-key
    content: Add OCO_DEBUG_ROUTING to CONFIG_KEYS, validator, ConfigType, DEFAULT_CONFIG, getEnvConfig, getConfigKeyDetails, THEMATIC_KEY_ORDER
    status: completed
  - id: git-ignore-audit
    content: Add getStagedFilesIgnoreAudit() in git.ts (staged vs .opencommitignore split)
    status: completed
  - id: routing-log-module
    content: "New routingDebugLog.ts: nextRoutingRunId + append NDJSON with 0o600"
    status: completed
  - id: table-extract
    content: Extract buildStagedFilesSummaryTable; use for note() and log field
    status: completed
  - id: commit-wire
    content: "commit.ts: capture routeDiff reason; optional ignore audit; assemble + append log"
    status: completed
  - id: per-file-meta
    content: "generatePerFileCommits: track payload_kind, llm_invoked, stagedNotInRoutedGroups, piggyback; return meta"
    status: completed
isProject: false
---

# OCO_DEBUG_ROUTING — append-only routing soak log

## Goals (what gets logged)

Each successful `commit()` run (see [src/commands/commit.ts](d:\projects\opencommitx\src\commands\commit.ts)) appends **one NDJSON line** when `OCO_DEBUG_ROUTING` is true:

| Field | Source |
|-------|--------|
| `execution_run_id` | Monotonic counter in a small sidecar file (e.g. `~/.opencommitx-data/debug/routing-debug.seq`) — read → increment → write; acceptable race for a local CLI soak test |
| `upfront_summary_table` | Exact same string as the `note(..., 'Staged files')` body today ([commit.ts ~903–989](d:\projects\opencommitx\src\commands\commit.ts)) — extract a pure helper so UI and log stay in sync |
| `opencommitignore_filtered` | Paths that are staged in git but removed by the ignore rules in [src/utils/git.ts](d:\projects\opencommitx\src\utils\git.ts) (`getOpenCommitIgnore` + `ig.ignores`) |
| Routing snapshot | `OCO_PER_FILE_COMMIT_MODE`, `usePerFileMode`, **`routing.reason`** from `routeDiff` (today only `usePerFile` / `fileGroups` are kept — start storing the full [RoutingResult](d:\projects\opencommitx\src\utils\diffRouter.ts) or at least `reason` + serializable `fileGroups` with `reason`/`type` per group) |
| Non-LLM / attachment semantics | From [generatePerFileCommits](d:\projects\opencommitx\src\commands\commit.ts): per group record `payload_kind`: `'docstring' \| 'diff'` (whether `group.docstringOverride` was used vs `getDiffForFiles`) and `llm_invoked`: `true` if `generateCommitMessageByDiff` ran for that group, `false` on cache-only short-circuit after user chooses “Use cached”. Optionally note that [getDiff](d:\projects\opencommitx\src\utils\git.ts) strips lock paths from the diff invocation — same paths may still appear in `group.files` but contribute little/no diff text (document in log schema comment or `notes` string, no need to parse diff) |
| Diff-invisible / piggyback files | same as today’s `omittedFiles` ([commit.ts 666–679](d:\projects\opencommitx\src\commands\commit.ts)): `stagedFiles` not in `commitPlan`’s file union **before** appending to the last group; log `piggyback: { files, target_group_index }` when sequential strategy applies the merge. For `OCO_MULTI_COMMIT_STRATEGY=single`, compute the same set (staged ∩ not in ∪ `fileGroups`) so soak tests still see “missing from routing” even though there is no piggyback step |

## Config plumbing (per [CLAUDE.md](d:\projects\opencommitx\CLAUDE.md))

Touch only [src/commands/config.ts](d:\projects\opencommitx\src\commands\config.ts):

1. Add `OCO_DEBUG_ROUTING` to `CONFIG_KEYS` (next to `OCO_DEBUG`).
2. `configValidators` — mirror `OCO_DEBUG` boolean validation (reject invalid; no silent coercion).
3. `ConfigType`, `DEFAULT_CONFIG` (`false`), `getEnvConfig` (`parseConfigVarValue(process.env.OCO_DEBUG_ROUTING)`).
4. `getConfigKeyDetails` — short description: append-only routing/grouping log path + what it contains.
5. `THEMATIC_KEY_ORDER` — place immediately after `OCO_DEBUG`.
6. **Setup wizard:** skip (advanced debug flag; keeps soak workflow config-only).

Call sites should use `Boolean(getConfig().OCO_DEBUG_ROUTING)` like existing `OCO_DEBUG` usage.

## Git: staged vs `.opencommitignore`

Add a single-purpose helper in [src/utils/git.ts](d:\projects\opencommitx\src\utils\git.ts), e.g. `getStagedFilesIgnoreAudit(): Promise<{ included: string[]; filteredByOpencommitignore: string[] }>`:

- One `git diff --name-only --cached --relative` (same as `getStagedFiles`).
- Reuse `getOpenCommitIgnore()`; `filtered` = paths where `ig.ignores(path)`; `included` = remainder sorted.

**Only call this when `OCO_DEBUG_ROUTING` is enabled** to avoid an extra ignore load on every commit.

## Logger module (new file)

Add [src/utils/routingDebugLog.ts](d:\projects\opencommitx\src\utils\routingDebugLog.ts) (no `getConfig` import — avoid cycles):

- `appendRoutingDebugRecord(record: Record<string, unknown>): void`
  - `mkdirSync(..., { recursive: true })`
  - Append `JSON.stringify(record) + '\n'` to e.g. `~/.opencommitx-data/debug/routing-debug.ndjson`
  - `appendFileSync`; on first create or via a tiny write helper, prefer **mode `0o600`** for new files under the data dir (align with sensitive logs per project rules)
  - `try/catch`; on failure `process.stderr.write` a short prefix — same spirit as [src/utils/debugLog.ts](d:\projects\opencommitx\src\utils\debugLog.ts)

- `nextRoutingRunId(): number` — counter file alongside NDJSON; implement as simple sync read/parse/increment/write.

## Refactor: shared table string

Extract the table construction from the `try` block (~905–989) into something like `buildStagedFilesSummaryTable({ stagedFiles, stats, statusEntries, fileGroups, usePerFileMode, perFileMode, shouldUseDocstringMode })` in a small module (e.g. `src/utils/stagedFilesSummaryTable.ts`) **or** a `function` at top of `commit.ts` if you want zero new files for the formatter only — preference: **dedicated util** so `commit.ts` does not grow. The existing `note(...)` call passes through the returned string unchanged.

## `generatePerFileCommits` return value

Change to return metadata (only consumed when logging):

```ts
type PerFileRoutingLogExtras = {
  groupDetails: Array<{
    groupIndex: number;
    files: string[];
    payloadKind: 'docstring' | 'diff';
    llmInvoked: boolean;
  }>;
  /** Staged paths not present in any fileGroup.files before sequential piggyback */
  stagedNotInRoutedGroups: string[];
  piggyback?: { files: string[]; appendedToGroupIndex: number }; // 0-based, only sequential
};
```

Implementation notes:

- Initialise a `groupDetails` array before the `for (const group of fileGroups)` loop; update inside the same branches that handle docstring, cache hit, regenerate, and `Promise.race` LLM call.
- After `buildCommitPlan`, compute `stagedNotInRoutedGroups = stagedFiles.filter(f => !new Set(fileGroups.flatMap(g => g.files)).has(f))` **before** the omitted-files push.
- When strategy is `sequential` and omitted files are merged into the last plan entry, set `piggyback` accordingly (files + `commitPlan.length - 1`).

Return `undefined` or empty object when `fileGroups.length === 0` to keep callers simple.

## `commit()` orchestration

1. When calling `routeDiff`, keep `routingReason` and optionally full `routing` for serialization; on catch, log `routing_error: true` and empty groups in the record.
2. Build `upfront_summary_table` via extracted helper.
3. If `OCO_DEBUG_ROUTING`: call `getStagedFilesIgnoreAudit()`.
4. After `generatePerFileCommits` resolves (per-file path), merge its returned meta; aggregate path fills a smaller `generation: { mode: 'aggregate' }` object and can omit group loops.
5. **Write the log once** at the end of `commit()` **only on the success path** before `process.exit(0)` (or wrap the tail in `try/finally` if you want failures recorded too — recommend **success-only** for v1 to avoid logging half-finished runs; call out as optional follow-up).

## Tests (light)

- Unit-test `buildStagedFilesSummaryTable` with tiny fixture inputs (stable header/rows).
- Optionally test `nextRoutingRunId` monotonicity with a temp dir injected via env or parameter if you want to avoid touching real home — otherwise skip and rely on manual soak.

## Files touched (expected)

- [src/commands/config.ts](d:\projects\opencommitx\src\commands\config.ts) — enum, validator, types, defaults, env, describe, thematic order
- [src/utils/git.ts](d:\projects\opencommitx\src\utils\git.ts) — `getStagedFilesIgnoreAudit`
- **New** `src/utils/routingDebugLog.ts` — counter + append
- **New** `src/utils/stagedFilesSummaryTable.ts` — table builder (or inline in commit if minimizing files)
- [src/commands/commit.ts](d:\projects\opencommitx\src\commands\commit.ts) — wire flag, routing reason, table helper, log assembly, `generatePerFileCommits` return handling

No migration: additive config key only.
