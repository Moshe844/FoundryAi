# Phase C Independent Pre-fix Failure Ledger

_Recorded 2026-07-13 before the independent stabilization pass changed product code. Existing Phase C notes are treated as prior evidence, not as proof of the current worktree._

## Baseline evidence

| Check | Actual result |
|---|---|
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with 15 warnings (8 unused WorkspaceShell paths, 3 connector expression warnings, 4 script warnings). |
| `npm run eval:execution-regressions` | Failed: obsolete DOM-order assertion expects the retired `MissionFocus` implementation. |
| `npm run eval:mission-canvas-ui` | Failed on the same obsolete active-before-history expectation; the current source-of-truth spec places collapsed prior missions before the active mission. |
| Real app | `http://localhost:3001` returned 200. |
| Local agent | `http://localhost:3917/health` returned real browser/desktop capability data. |
| Screenshot | `tmp/phase-c-evidence/baseline-home.png` (1440x900). |

## Implemented architecture map

| Concern | Actual implementation before fixes | Audit finding |
|---|---|---|
| Persisted thread/mission state | `WorkspaceState` in `WorkspaceShell.tsx`, persisted to IndexedDB with localStorage fallback | Canonical durable store exists. |
| Active execution | `activeExecutionMissionId` plus `deriveMissionDisplayStatus` | Mostly canonical, but eager placeholders and continuation retraction create avoidable race windows. |
| Follow-up routing | `classifyProjectFollowUp`, `resolveProjectMessageIntent`, `classifyMessage/classifyFollowUp` in `mission-engine.ts`, plus unused `lib/mission/classifyFollowUp.ts` | Four competing paths; the file claiming to be canonical explicitly says it is not wired. |
| Busy follow-up queue | `queuedTasks` React state plus a post-request closure read | Not durable and the closure is stale; a visibly queued newest instruction can be ignored. |
| Reference resolution | Intent route returns intent/continuity/confidence/rationale | Required target, files, scope, destructive flag, reference confidence, and planned action are absent. Confidence is returned but not used as a safety gate. |
| Write scope | Executor receives parent mission context and broad project access | No runtime allow-list connects the resolved follow-up target to files actually written. |
| Undo | Runtime journal can undo the latest recorded edit; journal-panel rollback can rewind after a chosen entry | "Undo that" is not bound to the referenced prior action/diff and new-file creation cannot be undone. |
| Approval | Durable mission record plus separately persisted command grants | Barrier is real, but typed follow-ups while blocked create extra notes rather than a canonical control event. |
| Stop | Browser aborts fetch; connector abort kills child tree | UI reports stopping immediately and has no graceful-stop/`Stop now` state; queued work is only cleared in memory. |
| Visible execution | Real streamed timeline plus `liveWorkEvents` fallbacks and `pendingWork` interval | Synthetic "Understanding/Reading/Getting started" rows and timer-advanced answer steps violate the no-simulation rule. |
| Preview | Runtime result plus `MissionCanvas` dock | Toggle visibility accepts `starting`/`error`, reopening does not perform the required health check, and width/open preference is not persisted per project. |
| Suggestions | Model-backed recommendation hook keyed to the settled execution | Needs regression proof that any new typed message clears stale suggestions before routing/execution. |

## Pre-fix failure ledger

| ID | Severity | Failure | Root cause / evidence | Required repair |
|---|---:|---|---|---|
| IND-FU-1 | Critical | Latest busy follow-up can be shown as queued and never execute. | `executeProjectMission` awaits a long request, then reads `queuedTasks` from the render closure that existed before `setQueuedTasks`. | Move the pending turn into one canonical durable/controller-owned queue and consume the latest value atomically. |
| IND-FU-2 | Critical | Follow-up intent and continuity can contradict each other across call paths. | Three live classifiers plus one unused additive classifier. | One resolver contract and one dispatch path for every project follow-up. |
| IND-FU-3 | Critical | Ambiguous/destructive references can mutate despite insufficient reference confidence. | Intent API emits a generic confidence value; callers ignore it and the fallback defaults unknown messages to `edit`. | Persist the seven-field resolution record; clarify when a destructive/reference-bearing mutation is below threshold. |
| IND-FU-4 | Critical | A narrow follow-up can touch unrelated files. | Project access has no allow-list derived from the resolved target and no dependency-reason journal. | Enforce resolved scope at the write/delete boundary; record any dependency expansion before the action. |
| IND-FU-5 | High | "Undo that" is latest-edit undo, not referenced-action undo. | Runtime selects the most recent unreverted edit journal entry without a resolution target; creations are unsupported. | Resolve a concrete prior execution/journal action and revert only its actual file set, including safe deletion of files that action created. |
| IND-FU-6 | High | A new message can leave stale suggestions/queued labels visible. | Recommendation lifecycle and in-memory queue are separate from turn acceptance. | Clear recommendations and superseded queued state in the same canonical accept-turn transition. |
| IND-TRUTH-1 | Critical | Visible activity can be fabricated. | `pendingWork` advances scripted phrases every 950ms; project sends inject "Understanding request", "Reading the project", "Getting started", and similar rows before a streamed event occurs. | Render only persisted/streamed events; an honest empty/stalled state is allowed. |
| IND-STOP-1 | High | Stop status can get ahead of real cancellation and has no graceful/hard distinction. | One click aborts and appends "Stopping ... now" locally; no acknowledgement event from the executor owns the terminal transition. | Make cancellation acknowledgement and terminal state event-driven; add bounded graceful stop then hard abort. |
| IND-PREV-1 | High | Preview affordance can be stale or disconnected. | UI trusts stored `previewState`; toggle does not health-check before reopening. | Require a current reachable/verified artifact state and show real failure/log recovery. |
| IND-TEST-1 | High | The two release regression suites are red before functional assertions run. | They assert retired component names/order and mojibake labels instead of the current Mission Canvas contract. | Replace source-shape assertions with behavioral tests against the canonical controller/view model and bounded Playwright journeys. |

## Pre-fix recommendation

**NO-GO.** The current worktree has strong execution and verification pieces, but follow-up ordering and scope are not trustworthy enough for release, and visible fallback activity still violates the product's absolute truth rule.

## Post-repair disposition

| ID | Disposition | Evidence |
|---|---|---|
| IND-FU-1 | Repaired | Controller-owned latest-only queue, atomic `take`, latest `workspaceRef`; follow-up suite and execution regressions pass. Queue durability across refresh remains unproved. |
| IND-FU-2 | Repaired | One canonical follow-up control/resolution module is used by the workspace and intent API. Dead local classifiers were removed. |
| IND-FU-3 | Repaired | The seven-field resolution record is normalized server-side. A real-model `Remove that` request over two files was forced to `clarify` with an empty writable scope. |
| IND-FU-4 | Repaired for resolved carry-forward turns | Runtime write/delete access is constrained to resolved files. Dependency expansion must be a newly recorded resolution. Cross-stack E2E breadth remains incomplete. |
| IND-FU-5 | Repaired | Referenced undo filters journal entries by recorded files and execution time range. A real local edit/verify/undo fixture restored the original file and preserved unrelated files. |
| IND-FU-6 | Repaired in the live UI | Recommendations clear synchronously when a turn is accepted; the queue contains only the latest payload and no synthetic transcript entry. Refresh durability remains open. |
| IND-TRUTH-1 | Repaired in Mission Canvas | Timer-driven work and optimistic project narration were removed. Canvas activity reads only the execution timeline; factual working-set events replaced future-tense filler. |
| IND-STOP-1 | Repaired for long commands | Explicit per-mission server cancellation aborts the runtime signal before the client closes its response. The long-command E2E proved no delayed filesystem write. Stop during file editing remains unexercised. |
| IND-PREV-1 | Repaired for web preview reopening | Preview status now performs a real health check and stale processes are stopped. Browser acceptance uses a reachable preview server. Non-web artifact UX remains incomplete. |
| IND-TEST-1 | Repaired | Mission Canvas browser acceptance and execution regressions now assert the canonical canvas/controller behavior and pass. |

That intermediate post-repair decision was superseded by the final closure pass in `docs/phase-c-independent-audit.md` sections 11–16. Refresh recovery, file-write cancellation, sequential questions, iterative preview, large-plan digestion, real Node API delivery, and real starter/custom creation are now verified. The current release decision is **GO at 96/100** with 18/18 journeys passing. The original entries above remain preserved as the pre-fix failure record.

## Post-closure correction: project deletion approval

| ID | Severity | Failure | Reproduction | Disposition |
|---|---:|---|---|---|
| IND-APPROVAL-ROOT-1 | Critical | `can you delete this project?` was translated into per-file deletion approval and the browser continuation did not prove one exact root-level action. | Disposable non-empty local project returned `Permission needed: delete package.json`, one-file/group checklist work, and a misleading earlier E2E passed only because it fabricated the approval input. | Repaired and revalidated. A deterministic intent guard creates one exact absolute-path card; only one-time approval is accepted; direct and connector roots are atomically removed and verified absent; the browser journey passes without per-file rows or post-delete edit affordances. |

This correction is detailed in `docs/phase-c-independent-audit.md` section 17. It retracts the earlier insufficient deletion evidence while preserving the historical 70/100 baseline and the failure record.
