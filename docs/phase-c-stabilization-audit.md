# Phase C Stabilization Audit

_Updated 2026-07-13. This is a product-flow audit, not a feature inventory._

## Canonical flow

Discovery → Mission → Execution → Verification → Preview → Handoff → Suggestions → Follow-up → History → Next Mission

The Mission Canvas is the only user-facing owner of this flow. Supporting modules may produce evidence, but they must not create parallel status, approval, summary, or history experiences.

## Canonical ownership

| Concern | Canonical owner | Stabilization decision |
|---|---|---|
| Persisted product state | `WorkspaceState` in `components/WorkspaceShell.tsx` | Remains the only live store. The unused context/reducer store was removed. |
| Mission contract | `lib/mission/model.ts` | Types and pure display selectors only; it does not pretend to be a second store. |
| Active mission/status | `lib/mission/status.ts` | All visible status surfaces resolve the same active mission and label. |
| Final executor mapping | `executionMissionFromResult` in `WorkspaceShell.tsx` | One mapping from a settled factory result to durable mission state. |
| Live phase mapping | `stateForLiveEvent` in `WorkspaceShell.tsx` | Streaming events advance the same durable mission; checklist updates cannot regress its phase. |
| Approval interaction | `ApprovalGate` in `components/execution/ApprovalPrompt.tsx` | One blocking action surface. Settled summaries no longer repeat it. |
| Execution evidence | `ExecutionTimeline` | Live and detailed evidence only; it is not a second summary. |
| Completion | `MissionSummary` in `BuildDashboard.tsx` | Calm engineering handoff by default; deep evidence is progressively disclosed. |
| Preview | `components/execution/PreviewPanel.tsx` | One adaptive preview family for docked, inline, and completion contexts. |
| Follow-up | Mission composer + intent route | Continues the active project thread; synthetic approval replies are not rendered as new user missions. |
| History | Previous `ExecutionMission` records | One chronological mission history with targeted undo. |

## Duplication audit

| Area | Finding | Current state |
|---|---|---|
| Concepts/state | An unused `MissionProvider` and reducer described a store that the app never rendered. | Removed. The model now describes the live architecture truthfully. |
| Mission status | Busy states and human labels were independently defined in `status.ts` and the old reducer. | Consolidated in `mission/model.ts`; all status displays use it. |
| Execution rendering | A legacy unused run summary competed with the active mission handoff. | Removed. Timeline, handoff, and history now have distinct jobs. |
| Approval rendering | Approval could appear in the blocking gate and again in the mission summary. | The gate is canonical; summary duplication removed. |
| Completion rendering | Medium/large missions produced a permanently expanded report with repeated request, outcome, files, commands, limitations, verification, and metrics. | Replaced with outcome + trust strip + expandable evidence. |
| Suggestions | Mock-review and post-build suggestions share the same recommendation cards and execution action. | Cohesive at the UI layer; persistence across refresh remains a release gate. |
| Preview | Preview has multiple layouts but one implementation family and one runtime result. | No competing state found. Keep variants context-specific. |
| Follow-up | Read-only answers, approvals, clarifications, and mutations previously created ghost mission entries in some paths. | Existing continuity fixes are covered by mission-canvas and execution regression scenarios; broader long-run UI testing remains open. |
| Command approval policy | The app and installable local connector must enforce the same policy but run in different processes. | Behavior is regression-tested across safe probes, exact grants, categories, denial, and destructive commands. Eliminating the packaging duplication remains architectural work. |

## Product impact

This pass advances the constitution in three ways:

- Trust: one visible status and one approval gate prevent contradictory or repeated control surfaces.
- Professional reasoning: completion reads as an engineer's handoff, while full evidence remains inspectable without becoming the default experience.
- Continuity: one persisted workspace and one chronological mission history make follow-up work continue naturally instead of restarting in a parallel store.

## Stabilization scenario: static catalogue

The repeated live journey exposed and fixed failures that synthetic checks did not catch:

1. Baseline: eight model turns repeatedly rewrote `index.html`, then failed with all objectives incomplete and no browser verification.
2. A one-turn optimization initially accepted a document truncated at `const styles = [`. Static HTML now requires structural closing tags, and incomplete writes are rejected before touching disk.
3. The same verbose brief sometimes inflated into an autonomous premium-model mission. Static HTML creation now stays a bounded small project regardless of discovery-memo length, with one builder escalation only when the fast model cannot produce the required write action.
4. Generic rendering exposed broken remote images. Foundry now captures the exact broken image sources, replaces them with reliable self-contained fallbacks, and repeats browser validation before considering model repair.
5. The final live run completed in 33.3 seconds with one fast implementation turn, a verified file read-back, a real preview, and a passing Chromium render check.
6. A second mobile interaction journey verified five rendered products, search narrowing to one exact product, a working favorite action, no console errors, and no failed local requests.

This is the constitution in executable form: bounded planning, real files, automatic diagnosis and repair, visible verification, and a preview the user can trust.

## Remaining release gates

Phase C is not complete until these journeys pass repeatedly against real projects, not only seeded browser state:

1. Tiny local edit → automatic verification → preview when relevant → targeted undo → refresh recovery.
2. Real bug reproduction → hypothesis → fix → regression check → follow-up “why?” answered from mission memory.
3. New project discovery → first coherent build → preview feedback → continue same mission → project-aware suggestion.
4. Approval allow-once / project / exact / deny → refresh while paused → resume without duplicate prompt or command.
5. Long mission with interruption, queued follow-up, context compaction, and no status regression.
6. Non-web stack with honest capability boundaries and stack-appropriate verification.
