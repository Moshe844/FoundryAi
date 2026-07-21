# Foundry Master E2E Acceptance Test Ledger

**Standard:** a test passes only when the user-visible result **and** the underlying real state both match. No mocked events, fake progress, or fabricated summaries.

Environment: Foundry dev server `http://localhost:3001` · local agent on `:3917` · real Chromium · real filesystem.

Statuses: `PASS` / `FAIL` / `BLOCKED` / `PENDING`

---

## Category B — Questions, advice, explanation (non-build)

Re-verified **2026-07-20** after the acceptance-gate, dependency, preview-readiness, and summary-dedup fixes.

Project under test: `projects/static-single-page-personal-finance-tool` (Svelte 4 + Vite, 9 source files).
Control for all four: `find src -newermt '-12 minutes'` returned **empty** → **zero files modified** by any question.

| # | Test | Status | Root cause | Fix | Evidence (cross-checked against disk) | Retest |
|---|------|--------|-----------|-----|----------------------------------------|--------|
| B02 | Project-specific question | **PASS** | — | — | "What framework is this project using and why?" → inspected only `package.json` + `svelte.config.js`. Claims exact: `"svelte": "^4.2.15"`; `vitePreprocess` imported from `@sveltejs/vite-plugin-svelte`; scripts `dev: vite`, `build: vite build`. Labeled "Read-only inspection — I inspected relevant evidence without changing files or packages." 18s. | 2026-07-20 ✓ |
| B03 | How-to guidance | **PASS** | — | — | "How would I add a new expense category? steps only, don't change it" → named `SpendingCategory` (types.ts:1), `CATEGORIES` (types.ts:39), `CATEGORY_COLORS` (types.ts:52) — all confirmed present. Gave ordered steps; executed nothing. 24s. | 2026-07-20 ✓ |
| B04 | Explain selected code | **PASS** | — | — | `addExpense` in `src/store.ts` → quoted the real signature `Omit<ExpenseEntry,'id'>` (store.ts:25) and body `expenses.update((list) => [{ ...entry, id: uuidv4() }, ...list])` (store.ts:26). Covered inputs, output (void), side effects, risks; traced persistence through the real `persist('cs_expenses', expenses)` (store.ts:23) to `localStorage`. 18s. | 2026-07-20 ✓ |
| B05 | Architecture explanation | **PASS** | — | — | Project-specific, not a generic Svelte description: `main.ts` mounts into `#app` rendering `App.svelte` (verified verbatim); the four real components in `src/components`; tab state `activeSection` (App.svelte:24). Correctly identified frontend-only SPA with no backend. | 2026-07-20 ✓ |

**Note on status text:** read-only answers finish as "Complete (unverified)". That is correct, not a defect — a question produces no build/preview artifact to verify against.

### B05a — same test, natural phrasing (generalization check)

The four tests above were re-run **against the exact acceptance wording**. Re-testing with casual phrasing on a *different stack* (`projects/single-page-personal-expense-tracker`, Next.js + React) exposed a defect the scripted wording hid.

| # | Test | Status | Root cause | Fix | Evidence | Retest |
|---|------|--------|-----------|-----|----------|--------|
| B05a | "whats this thing built with" | **PASS** | — | — | Correct ("Next.js + React web app"), read-only, 6s. | 2026-07-20 ✓ |
| B05b | "how does the data actually move around in here" | **PASS** (was FAIL) | Both the deterministic guard and the read-only veto matched change verbs as bare keywords. The word **"move"** in "move around" scored as a mutation, so the question was routed to an `edit` mission and **wrote a visible "How data moves in this app" section into `src/app/page.tsx`** — twice, reproducibly. Same bug class as the B09 "would it be better to *move* this logic" failure. | Replaced keyword matching with **sentence-form** analysis in [`looksLikeReadOnlyQuestionForm`](../lib/mission/classifyFollowUp.ts): an all-interrogative message with no imperative clause is a question regardless of which verbs it contains. Applied in three places — `deterministicMutationIntent`, `standaloneMutationIntent`, and (critically) `explicitReadOnlyProjectIntent`, so a question can now **veto** a mutating verdict from the online classifier instead of merely abstaining. | Live retest: 45s of md5 polling on `page.tsx` — **hash never moved, zero files touched**. Answer labeled "Read-only inspection…" and every claim cross-checked against disk (storage key `expense-tracker-v1`, `loadExpenses`/`saveExpenses`, the `useMemo` derivation chain, and a genuine closure/stale-update caveat at `page.tsx:39`). | 2026-07-20 ✓ |
| B05c | Counter-test: "can you move the total spend number so it shows above the filter bar?" | **PASS** | — | — | The hardest case — interrogative-looking, contains "move", but genuinely an edit. Still routed to `edit` and applied the change correctly (91s). Proves the veto did not break editing. Reverted afterward from the journal's `beforeContent`. | 2026-07-20 ✓ |

Guarded by [`scripts/eval-question-vs-edit-intent.cjs`](../scripts/eval-question-vs-edit-intent.cjs) — **89 assertions**, covering questions that must not mutate, commands that must still mutate, the veto in both directions, and defect reports that must keep their debug reading.

**Lesson for the remaining categories:** passing the ledger's own wording proves nothing about the wording a user would actually type. Every remaining test should be run once as written and once phrased naturally.

---

## Fixes landed this cycle (root causes, not special cases)

| Area | Root cause | Fix |
|---|---|---|
| Missing dependencies | Recovery only parsed build-error output, learning missing packages a few per failed build until the budget died | Scan every source import and reconcile against `package.json` + `node_modules` **before** the build; install all in one pass ([runtime.ts](../lib/factory/runtime.ts)) |
| Repair loop oscillation | `compilerFailureFingerprint` hashed full diagnostic text, so one defect reported with different type strings read as forward progress | Added structural `compilerFailureSignature` that erases concrete type text ([compiler-evidence.ts](../lib/verification/compiler-evidence.ts)); loop stops after one real escalation |
| Preview false-failure | Readiness allowed only ~3s; Vite blocks first requests during dep pre-bundling. Also assumed the framework honored our port | Generous dev-server budget, grace re-check, process-death exit, and **port discovered from the server's own log** (Angular binds 4200 regardless) |
| Canvas charts | Gate judged/screenshotted before Chart.js finished animating → blank canvas reported as a product defect | Wait for canvas pixels to paint before observing or capturing |
| Contradictory timeline | Every summary got a random id; repair sub-timelines merged with plain `push` | Stable `mission-summary` id + `mergeExecutionTimeline` upsert ([event-contract.ts](../lib/factory/event-contract.ts)) |
| **Acceptance gate false-failure** | When neither probe applied (`named.applicable=false`, `observable.applicable=false`), `acceptanceVerified` read the un-run probe's `false` — "couldn't determine" became "failed" | Only an **applicable** probe may return a negative verdict; browser gate supersedes an executor step that could not run browser checks, gated on every command exiting 0 |
| Wrong app in preview | Grace check accepted any HTTP 200 on the port — could adopt a previous project's still-running server | Grace sweep only trusts a responding port while **our** spawned process is alive |
| Cost ceiling | A legacy flat guard (4 calls / $0.25) undercut the tier-aware budgets | Derived from the Fast-tier floor (12 / $0.50); Builder/Architect keep 24/$2 and 32/$4 |

---

## Open / not yet verified

- **Speculative edits on retry.** During B05c the first edit pass "did not apply the requested change", and the retry wrote CSS against four selectors (`.page-shell`, `.total-spend`, `[data-total-spend]`, `[data-filter-bar]`) that **do not exist anywhere in the project** — verified 0 occurrences in `src/**/*.tsx`. The change still landed via a second pass, but the retry path is guessing at markup instead of reading it. Dead code shipped into a user project is a real defect.
- **"Mission blocked" shown mid-run on a mission that then succeeded** (B05c) — the contradictory-status class of bug is reduced but not gone.
- **The acceptance-gate fix is unit-verified, not yet re-run live** against the original "add a dark/light switch" request.
- Discovery sometimes misreads project type (an expense tracker proposed Electron/Tauri/WPF desktop stacks).
- iOS preview is impossible on Windows (Simulator is macOS/Xcode only). Android emulator works — JDK 21 resolved from Android Studio's bundled JBR.
- Remaining Category B items (B01, B06–B15) and Categories C onward are not covered by this re-verification pass.
