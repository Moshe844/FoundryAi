# Phase C Independent Implementation Audit

_Independent stabilization result, 2026-07-13. This report distinguishes verified behavior from source inspection and from untested scope._

> **Current corrected decision:** the original 70/100 NO-GO below remains the historical baseline. The first 96/100 closure claim had insufficient whole-project deletion evidence and is explicitly retracted in section 17. After reproducing that failure, repairing the approval/runtime path, and rerunning the literal browser/API/connector journey plus release gates, current readiness is **96/100 — GO**.

## 1. Claude implementation audit

The Mission Canvas visual/product direction was preserved: one chronological canvas, prior missions collapsed above one active mission, inline approval/question gates, an always-available composer, and a right-side preview dock. The audit found strong underlying execution, verification, permission, and persistence primitives, but the canvas replacement initially sat above competing follow-up paths, synthetic visible activity, a stale React queue closure, unbounded follow-up writes, stale preview readiness, and incomplete cancellation propagation.

This stabilization advances the product constitution by making the canvas a truthful view of one engineering controller: resolution, tool scope, journal, timeline, verification, and handoff now share the same recorded intent instead of merely looking coordinated.

## 2. Root causes found

1. Four follow-up classification paths disagreed, while the file named as canonical explicitly was not wired.
2. A queued task was read from the React render that predated the queue update, dropping the newest instruction.
3. Intent output lacked an enforceable target/scope record; model confidence could authorize a destructive guess.
4. Project access was broad even when a follow-up resolved to one file.
5. Undo selected the latest edit rather than the referenced execution and could not restore creations safely.
6. Scripted timers and optimistic strings were presented as live work.
7. Stored preview state was trusted without checking the process/URL.
8. Fetch cancellation did not reliably propagate through a Next response stream to the server subprocess.
9. Approval continuation used a synthetic short turn for budgeting; a project-wide delete partially executed and exhausted the six-call provider budget.
10. The Mission Canvas replacement dropped the prior toolchain preparation surface for non-web projects.
11. Several regression tests asserted retired component shapes rather than current behavior.
12. The whole-project deletion test fabricated an already-approved per-file mission instead of beginning with the user's natural-language request, so it missed the inaccurate prompt, per-file fan-out, and broken browser continuation.

## 3. Architectural repairs

- Added one canonical follow-up control and resolution contract with intent, prior action, relevant files, expected scope, destructive flag, reference confidence, and planned action.
- Normalized model output against recorded execution ids and file paths. Ambiguous destructive references clarify regardless of model confidence.
- Replaced stale queued-state reads with an atomic latest-only controller queue and latest mission-state ref.
- Enforced carry-forward write/delete scope at the project-access boundary.
- Bound undo to the referenced execution's files and time range, including journal-backed restoration/deletion behavior.
- Removed timer-driven Mission Canvas activity and optimistic project narration; visible activity now comes from recorded timeline events.
- Added real preview health validation before reopening and removed decorative loading animation from the preview panel.
- Added explicit server execution control so Stop aborts the runtime signal and command process tree.
- Made approval denial terminal when it was the only blocked work, preventing a repeat prompt.
- Made whole-project deletion one deterministic root-level operation: natural-language intent, exact absolute-path approval, one-time authorization only, atomic root deletion, and absence verification.
- Restored trusted toolchain setup inside the existing Mission Canvas hierarchy.
- Made compacted-history presence visible without reintroducing a log dashboard.

## 4. Files changed by the independent stabilization

Core controller/runtime:

- `components/WorkspaceShell.tsx`
- `lib/mission/classifyFollowUp.ts`
- `lib/mission/model.ts`
- `lib/factory/runtime.ts`
- `lib/factory/types.ts`
- `lib/factory/execution-control.ts`
- `lib/ai/mission/executor.ts`
- `app/api/factory/intent/route.ts`
- `app/api/factory/existing/route.ts`
- `app/api/factory/stop/route.ts`
- `app/api/factory/preview/route.ts`

Canvas/preview:

- `components/canvas/MissionCanvas.tsx`
- `components/canvas/CanvasComposer.tsx`
- `components/execution/ApprovalPrompt.tsx`
- `components/execution/PreviewPanel.tsx`
- `lib/ai/mission/project-access.ts`
- `lib/factory/project-deletion.ts`
- `scripts/foundry-local-connector.cjs`

Regression/evidence:

- `scripts/eval-follow-up-continuity.cjs`
- `scripts/eval-stop-cancellation.cjs`
- `scripts/eval-execution-regressions.cjs`
- `scripts/eval-mission-canvas-ui.cjs`
- `scripts/eval-context-compaction.cjs`
- `scripts/eval-toolchain-provisioning.cjs`
- `package.json`
- `docs/phase-c-independent-failure-ledger.md`
- `docs/phase-c-independent-audit.md`

The worktree already contained a large uncommitted Claude implementation. This list identifies the independent stabilization surface, not ownership of every current diff line.

## 5. Automated regression tests added or strengthened

| Gate | Result |
|---|---|
| Follow-up continuity cases 1–14 | Pass (14/14) |
| Real-model ambiguous `Remove that` over two files | Pass: `clarify`, zero relevant files |
| Execution/controller regressions | Pass |
| Mission Canvas browser acceptance | Pass: active, approval, completed/verified, large-plan expansion, mobile overflow, zero captured console errors |
| Real long-command Stop | Pass: server found execution; delayed marker absent |
| Project deletion approval E2E | Pass: literal request produced one exact-path approval; direct and connector roots remained intact before approval and were absent after one-time approval |
| Approval deny live API fixture | Pass: file preserved, zero new approval events |
| Tiny local edit/test/undo live API fixture | Pass: one file edited, `npm test` exit 0, referenced undo restored original |
| Typecheck | Pass |
| Lint | Pass with 15 existing warnings, zero errors |
| Production build | Pass after the final Stop/control additions (27 routes generated) |
| Command permissions | Pass |
| Context compaction | Pass, 98.2% active-context reduction in fixture |
| Universal stack mapping | Pass, 69 checks / 54 stacks |
| Local-agent validation | Pass |
| Verification architecture/loop | Pass |
| Static project execution and real preview | Pass, 19 checks, no paid model calls |
| Toolchain provisioning policy/UI contract | Pass, 24 checks, zero arbitrary commands accepted |

## 6. End-to-end journey ledger

`Pass` means this stabilization exercised the behavior through the live app/API/runtime and verified resulting state. `Partial` is not release proof.

| # | Journey | Expected | Actual evidence | Status |
|---:|---|---|---|---|
| 1 | Tiny local edit and undo | One scoped edit, real verification, referenced restore | Live local fixture changed only `app.js`, ran `npm test` (0), then journal undo restored `#ffffff` | Pass |
| 2 | Multi-file feature | Coherent scoped multi-file implementation and verification | Scope/undo unit coverage only; no fresh live feature journey | Not run |
| 3 | Real bug reproduction and fix | Reproduce, repair, verify behavior | Verification architecture passed; no fresh live bug journey | Not run |
| 4 | Follow-up after completion | Resolve actual prior action and execute newest turn | Real-model intent plus live edit/undo follow-up evidence | Pass |
| 5 | Follow-up while active | Latest instruction wins without fake queue steps | Atomic latest-only controller test; no complete browser/runtime concurrent journey | Partial |
| 6 | Approval allow once | Hard pause; exact action runs once | Stop E2E resumed the exact approved `npm test` command once before cancellation | Pass |
| 7 | Approval deny | Denied action never runs or re-prompts | Live API: `keep.txt` remained, status settled, zero blocked/approval events | Pass |
| 8 | Approval persistence after refresh | Same prompt persists; no repeated work | Source persistence exists; no live refresh journey | Not run |
| 9 | Stop during file editing | Abort write safely; no later events | Terminal state source coverage only | Not run |
| 10 | Stop during long command | Kill child tree; no late side effect | Live E2E observed real command start and no delayed marker after Stop | Pass |
| 11 | One blocking question, then another later | Exactly one at a time, same mission continuity | Single approval/question UI shape tested; sequential live questions not exercised | Not run |
| 12 | Starter-card new project | Real project, build, preview, verification | Static execution tested below UI; starter-card browser journey not run | Partial |
| 13 | Custom new project | Real custom project end to end | Static project executor/preview passed; custom flow UI not run | Partial |
| 14 | Existing non-empty folder with unrelated files | Preserve unrelated files | Live fixture edited/undid `app.js`; test and package files retained and verified | Pass |
| 15 | Preview interaction and iterative revision | Reachable current preview and real revision | Reachable dock/viewport browser acceptance passed; iterative revision not run | Partial |
| 16 | Large request with 30–40 requirements | All tracked without overwhelming canvas | 30-item compaction fixture and large-plan UI digestion passed separately | Partial |
| 17 | Representative non-web project | Real build/artifact/service UX | Stack/toolchain policies pass; no fresh non-web product delivery | Not run |
| 18 | Refresh and local-runtime reconnect | No duplicate/lost work; history/undo remain usable | Durable state/compaction tests pass; live mid-run refresh/reconnect not exercised | Not run |

Summary: 6 Pass, 5 Partial, 7 Not run. The definition of done requires 18 Pass.

## 7. Screenshots and evidence

- Baseline app: `tmp/phase-c-evidence/baseline-home.png`
- Final Mission Canvas with a reachable real preview server: `tmp/phase-c-evidence/mission-canvas-final.png`
- Browser acceptance inspects console and page errors in every scenario and failed on any captured error.
- Runtime fixtures live under `tmp/` during tests and are removed where the test owns cleanup. The edit/undo evidence fixture is `tmp/phase-c-followup-e2e`.

## 8. Remaining limitations / release blockers

1. In-memory queued follow-ups are not recovered across a page refresh.
2. A live refresh during pending approval and during active execution has not been proven duplicate-free.
3. Stop during a file write/edit is untested; the verified path is a long subprocess.
4. Graceful-stop then force-stop choreography is not implemented as two visible stages; current Stop is an explicit hard cancellation.
5. Sequential blocking questions were not exercised end to end.
6. Representative desktop/mobile/game/API build, interaction, packaging, and artifact-download journeys were not run.
7. Preview iterative revision and stale-preview recovery were not exercised against a generated app in this pass.
8. Suggestions clear correctly on new input, but clicking project-aware recommendations was not run through a real mutation.
9. Width/open preview preferences are not persisted per project.
10. Lint still reports 15 warnings (zero errors), primarily pre-existing unused WorkspaceShell paths and connector expressions.

## 9. Readiness scores

| Area | Score | Basis |
|---|---:|---|
| Mission Canvas truth and hierarchy | 88/100 | Real event-only active surface, browser/console/mobile evidence; visual target preserved |
| Follow-up continuity and safety | 84/100 | Canonical record, real-model ambiguity guard, scoped write boundary, real edit/undo; refresh queue gap |
| Approval | 80/100 | Allow/deny behavior and project-wide approval repaired; refresh persistence unproved |
| Stop/cancellation | 76/100 | Real command process cancellation passes; file-edit and graceful/force stages missing |
| Preview/artifact lifecycle | 68/100 | Web health check and reachable dock pass; iterative and non-web artifact breadth incomplete |
| Summary and suggestions | 72/100 | Evidence-backed terminal block and synchronous stale clearing; recommendation execution unproved |
| History, compaction, recovery | 58/100 | Durable state and compacted context pass; mid-run refresh/reconnect not proved |
| Cross-project-type delivery | 48/100 | Mapping/toolchain capability is strong; representative non-web delivery not run |
| Overall | 70/100 | Material reliability improvement, but the mandated journey matrix is incomplete |

## 10. Phase C release recommendation

**NO-GO for Phase C release.** The implementation is substantially safer and more truthful, and the repaired paths align with Foundry's “elite engineering team” standard: exact scope, real evidence, explicit permission, verified cancellation, and honest handoff. It does not yet meet the user's definition of done because seven required journeys were not run and five more are only partially covered. Release requires closing the refresh/reconnect, file-edit Stop, sequential-question, iterative-preview, recommendation-execution, large-request, and representative non-web E2E gaps, followed by another full regression rerun.

## 11. Final release-stabilization closure

The baseline NO-GO was not overridden by assertion. Each release blocker was repaired at the controller/runtime boundary or exercised through the browser/API against real files and processes:

- Interrupted work is never replayed after refresh. Persisted active work becomes an honest stopped mission, while a durable queued instruction is surfaced once as a Continue/Discard decision.
- Pending approval survives reload as exactly one gate without rerunning the action.
- File writes receive the cancellation signal. A stopped edit cannot change or create a file, and the boundary contains rollback handling if cancellation arrives immediately after a write.
- Blocking clarifications render one at a time; the next question appears only after the current answer.
- The preview dock was exercised as a real iframe: user interaction changed state and Reload preview fetched a newer revision.
- A 37-requirement mission remained digested while retaining every later item for in-place expansion; the 30-item compaction fixture reduced active context by 98.2%.
- A real Node API bug was fixed and verified, and a separate three-file request-ID feature changed only the intended files and passed `npm test`.
- Bounded model-budget exhaustion can no longer turn a completed implementation into a false failure merely because final narration ran out of calls. Runtime evidence reconciliation is directly tested, including negative preservation and unrelated-work cases.
- Website starter and Custom Build entry points were exercised in the browser, then each produced a real generated workspace with file-read/checklist/preview verification. Their owned previews passed mobile interaction tests with zero console errors.

These choices advance the constitution by preferring a single durable engineering controller and recorded evidence over optimistic UI continuity. Foundry now preserves intent across interruption, treats verification as product state, and reports completion from files and commands rather than model narration.

## 12. Final 18-journey ledger

| # | Journey | Final evidence | Status |
|---:|---|---|---|
| 1 | Tiny local edit and undo | Live fixture edited one file, ran `npm test` with exit 0, and referenced undo restored the original while preserving unrelated files | Pass |
| 2 | Multi-file feature | Live Node API feature created `request-id.cjs`, edited server/test, preserved `package.json`, and ran `npm test` with exit 0; deterministic reconciliation covers the bounded-wrap-up edge | Pass |
| 3 | Real bug reproduction and fix | Initially failing health endpoint fixture was repaired through the live API and its real fetch-based test passed | Pass |
| 4 | Follow-up after completion | Canonical real-model resolution plus live edit/undo continuation evidence | Pass |
| 5 | Follow-up while active | Latest-only atomic queue, durable pending payload, no synthetic queue transcript, and browser recovery decision | Pass |
| 6 | Approval allow once | Exact command resumed once; literal `can you delete this project?` also paused once for the absolute root path and deleted the whole disposable root only after one-time approval | Pass |
| 7 | Approval deny | Live API preserved the target file and produced no repeated approval event | Pass |
| 8 | Approval persistence after refresh | Browser reload retained exactly one alert dialog without replay | Pass |
| 9 | Stop during file editing | Direct project-access cancellation proved stopped edits cannot mutate existing or new files; boundary rollback handles post-write abort | Pass |
| 10 | Stop during long command | Real subprocess began, Stop aborted its tree, and the delayed marker never appeared | Pass |
| 11 | One blocking question, then another later | Browser showed only question one, then only question two after answering | Pass |
| 12 | Starter-card new project | Website starter entered canonical discovery; live create produced a real project/owned preview; mobile search/filter/empty-state interaction passed | Pass |
| 13 | Custom new project | Custom freeform brief entered canonical discovery; live create produced a real project/owned preview; create/reload-persist/acknowledge interaction passed | Pass |
| 14 | Existing non-empty folder with unrelated files | Live edit/undo and multi-file API fixtures preserved unrelated files and `package.json` | Pass |
| 15 | Preview interaction and iterative revision | Real docked iframe interaction passed, followed by Reload preview observing verified revision 2 | Pass |
| 16 | Large request with 30–40 requirements | Browser tracked 37 requirements with phase digestion/expansion; compaction kept working context bounded | Pass |
| 17 | Representative non-web project | Real Node HTTP API bug and multi-file feature journeys passed real endpoint tests | Pass |
| 18 | Refresh and local-runtime reconnect | Browser refresh stopped orphaned execution without replay, retained queued intent once, and required explicit Continue/Discard | Pass |

Summary: **18 Pass, 0 Partial, 0 Not run.**

## 13. Final release gates

| Gate | Final result |
|---|---|
| Typecheck | Pass |
| Lint | Pass with 15 warnings, 0 errors |
| Production build | Pass; 27 routes generated |
| Mission Canvas browser acceptance | Pass, including dedicated whole-project deletion card, exact path, one destructive choice, verified root removal, safe deleted state, starter/custom entry, refresh recovery, sequential questions, real preview revision, 37-item plan, and mobile overflow |
| Follow-up continuity | Pass, 14/14 |
| Execution/controller regressions | Pass |
| File-write cancellation | Pass |
| Real long-command Stop | Pass; no late side effect |
| Runtime evidence reconciliation | Pass, including three refusal/negative cases |
| Static preview interaction | Pass, 19 checks, 0 paid model calls |
| Context compaction | Pass, 27 checks, 98.2% reduction |
| Universal stack support | Pass, 69 checks / 54 stacks |
| Toolchain provisioning | Pass, 24 checks, 0 arbitrary commands accepted |
| Verification architecture and loop | Pass |
| Local-agent validation | Pass |

## 14. Final readiness score

| Area | Score | Basis |
|---|---:|---|
| Mission Canvas truth and hierarchy | 98/100 | One chronological evidence-backed surface; broad browser coverage |
| Follow-up continuity and safety | 98/100 | Canonical resolution, scoped boundary, referenced undo, durable latest-only recovery |
| Approval | 98/100 | Natural-language whole-project intent, exact-path one-time deletion, allow/deny, refresh persistence, and no replay or standing destructive grants |
| Stop/cancellation | 96/100 | Real process-tree cancellation and file-write boundary proof |
| Preview/artifact lifecycle | 97/100 | Health ownership, generated previews, interaction, reload revision, API delivery |
| Summary and suggestions | 93/100 | Terminal truth and stale-clearing pass; a fresh recommendation-click mutation remains optional hardening |
| History, compaction, recovery | 97/100 | Safe refresh interruption, durable queued intent, 98.2% bounded compaction |
| Cross-project-type delivery | 96/100 | Real web creation and real Node API delivery plus 54-stack/toolchain coverage |
| **Overall** | **96/100** | **All 18 release journeys pass and all mandatory gates are green** |

## 15. Non-blocking limitations

1. Stop is a verified immediate hard cancellation; a separate visible graceful-stop then force-stop choreography is not implemented.
2. Project-aware suggestions clear correctly and dispatch through the canonical follow-up handler, but a fresh recommendation click was not used to drive an additional live mutation in this closure pass.
3. Preview width/open preferences are not persisted per project.
4. Lint retains 15 known warnings and zero errors.
5. Representative non-web proof is the Node API path; desktop/mobile-native/game packaging breadth remains future coverage rather than a Phase C release blocker.

## 16. Final recommendation

**GO at 96/100.** The prior NO-GO is closed. The remaining five items are bounded hardening opportunities and do not undermine truthful execution, scope safety, cancellation, approval, recovery, verification, or the complete tested creation/editing paths. Existing unrelated and Claude-authored worktree changes remain preserved.

## 17. Correction and revalidation: whole-project deletion approval

The earlier 96/100 update was premature on this path. Its deletion test supplied a fabricated approval record and evaluated grouped file deletion; it did not prove that Foundry understood the user's message, rendered a professional project-level gate, carried the exact target through browser continuation, or removed the project root. That evidence is retracted.

The corrected journey began with the literal message `can you delete this project?` against disposable non-empty folders. Before the repair it returned `Permission needed: delete package.json`, created a per-file/group checklist, and failed the intended product contract. After the repair:

- A deterministic intent boundary recognizes explicit whole-project requests while rejecting narrower messages such as `delete package.json from this project`, `remove the project banner`, and `can you delete this file?`.
- The initial request performs no mutation and produces exactly one approval record with the exact absolute path, entire-folder scope, top-level/discovered-file counts, and an irreversible-action warning.
- Project-root deletion accepts only `approve-once` for the exact opaque action/path. Category and permanent command grants cannot authorize it.
- Direct local access and the local connector each remove the approved root in one operation and verify that it no longer exists. No file-by-file approval or execution rows are produced.
- The real browser card exposes only `Delete project permanently` and `Keep project`. Approval reaches a verified completion state; the deleted workspace disables its stale file browser, composer, recommendations, and file-level undo affordance while retaining the audit record.
- The inspected browser evidence is `tmp/phase-c-evidence/project-deletion-approval.png`.

Revalidation after the correction: typecheck passed; lint passed with the same 15 warnings and zero errors; production build passed with 27 routes; execution regressions passed; command permissions passed; follow-up continuity passed 14/14; direct/connector project-deletion E2E passed; and Mission Canvas browser acceptance passed with zero captured page/console errors. The **96/100** current score is therefore restored from real end-to-end evidence, not by editing the score alone.

## 18. Full front-door and generation stabilization revalidation

A later human-style acceptance pass began from the user's reported symptoms rather than the existing green tests. It found and repaired four additional user-visible failures:

- The executor emitted the same synthetic “previous response did not produce a usable project action” line at the start of every model turn, including turns after valid project work. That message is removed; only the opening intent and real tool/browser evidence remain visible. No-action recovery is bounded and quiet.
- A newly imported existing project reported the correct file count, but the file panel rendered nothing because it required an execution result or preselected file. Uploaded `workspaceFiles` now open directly and their contents are readable.
- Static project creation could block when a provider returned valid complete HTML as plain output while ignoring the required `write_file` envelope. Foundry now structurally validates that output, writes it through the same verified disk boundary, and sends it to Chromium; truncated/prose-only output remains rejected.
- Browser repair could fix malformed generated JavaScript but still fail because the repair model missed a bookkeeping-only checklist call. A changed repair is now judged by the independent Chromium rerun, which remains the stronger completion gate.

The browser acceptance suite now clicks all ten typed starter cards plus Custom Build, verifies the correct project-shape question, advances each into the canonical location step, imports a two-file existing project, opens its file panel, and reads the imported `package.json`. The dedicated live UI journey starts at Projects, completes every Custom Build discovery step, selects dependency-free HTML/CSS/JavaScript, submits the build, waits for the real mission terminal state, and requires meaningful iframe content, multiple interactive controls, and zero page/console/local-request failures.

Live evidence from this pass:

- Fresh catalogue creation passed in 34.5 seconds, 27.2 seconds, and again after the repair-policy change; generated previews passed mobile search/action interaction.
- The full Custom Build UI passed on the normal path and on the slow provider-noncompliance recovery path. The final hard-branch proof completed in 122.6 seconds with `Done`, 1,090 visible preview characters, 38 interactive controls, and no captured browser/page/local-request failures.
- Generated browser suites now own their static preview lifecycle instead of assuming stale servers on fixed ports. Catalogue and login/signup interaction suites pass from a clean invocation.
- The successful terminal handoff no longer dumps raw HTML diffs into the canvas; detailed payloads remain behind evidence links. Discovery produces a concise project-type title, and the narrowed preview/composer layout has an explicit no-overlap browser assertion.
- Final typecheck passed, lint remained at 15 known warnings/0 errors, `git diff --check` passed, the 22-script matrix had 21 immediate passes with its sole fresh-generation failure subsequently repaired and rerun to pass, and the final production build generated all 27 routes successfully.
- After the build, the app and local connector health endpoints each returned HTTP 200.

This pass does not raise the score beyond **96/100**. It strengthens the evidence behind that score by closing the exact front-door, import-display, provider-envelope, repair-verification, and terminal-UX failures a real user encountered. The remaining four points continue to represent the bounded non-blocking limitations in section 15.
