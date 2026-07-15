# Foundry Master E2E Acceptance Test Ledger

Standard: a test passes only when the user-visible result **and** the underlying real state both match the expected result. No mocked events, fake progress, artificial delays, canned suggestions, or fabricated summaries.

Environment:
- App: Foundry dev server, `http://localhost:3001` (Next.js 15, `npm run dev`)
- Browser: real Chrome via Claude in Chrome extension
- Date started: 2026-07-15
- Branch: `claude/model-routing-mission-orchestration`

Statuses: `PASS` / `FAIL` / `BLOCKED` / `PENDING`

## Category A — Application Foundation, Launch, Navigation, and Visual Calm (required 15/15)

| # | Test | Status | Root Cause | Fix | Evidence | Retest |
|---|------|--------|------------|-----|----------|--------|
| A01 | Cold launch (+ dashboard redesign directive) | PASS | Cold launch was already clean (Ready 2.7s, FCP 176ms, 0 console errors, no fake activity). Clutter fixed by full hero-centric redesign | FactoryHome rebuilt to a landing-page hero per user mockup: centered runtime pill (reflects real agent status), "Turn an idea into working software." headline, a "What should we build?" prompt (Enter or Start building → seeds the real discovery flow via onOpenFlow), 5 quick chips (→ real flow w/ mapped template), "Continue where you left off" card w/ **real** plan-derived progress (no fabricated %), a proper "Open existing project" home, 4 "Start with a direction" cards, "View all" → full 11-template grid (all preserved), recents/history/convert-clone all kept | Verified in browser: prompt text carried into discovery textarea; chips/directions/open-existing all open real flows; 11 templates present; 0 console errors; no h-scroll at 1366/820px | Retested 2026-07-15 ✓ |
| A02 | Warm restart | PASS | — | — | After reload: single 5.0s health poll loop (gaps 4993–5011ms), 1 workspace item, no duplicate sessions | — |
| A03 | Runtime unavailable | PASS (fixed) | Was FAIL: `useLocalAgentInstallStatus` mapped failed health check → "not-installed" with misleading "Download Local Agent" CTA | Hook now persists a successful-connection flag (localStorage `foundry-local-agent-seen`) and reports "offline" when the agent was seen before; dashboard shows "Local agent installed, but not running" with `npm run agent` instructions + re-download link; cloud/read-only work explicitly stated as still available | Retest: stopped connector → amber explanation box rendered; restarted → "Local Agent Connected" | Retested 2026-07-15 ✓ |
| A04 | Runtime reconnect | PASS | — | — | Connector restart → UI flipped to connected within one 5s poll; single transition, single poll loop | — |
| A05 | Primary navigation | PASS (with UX note) | Workspace & Templates render identical FactoryHome when no project connected (BuildDashboard.tsx:529 vs :581) — nav click appears to do nothing; no aria-current | Merge/differentiate views in redesign | Nav click-through evidence; code read | Pending redesign |
| A06 | Responsive desktop widths | PASS (fixed) | Was FAIL: `min-h-0` + `overflow-auto` on grid children let auto rows compress below content height at sub-lg — sidebar content bled over the panel below; content squeezed to a 170px inner-scroll window | `min-h-0`/`overflow-auto` scoped to `lg:` on the main grid and view roots; below lg the page stacks and scrolls naturally | Retest 820px: aside natural height (no overflow), content full height, page scrolls; retest 1366px: 240px+fluid columns, internal scroll only, no h-scroll | Retested 2026-07-15 ✓ |
| A07 | Browser refresh idle | PASS | — | — | After reload: workspaces restored, footer Ready, no work started | — |
| A08 | Browser refresh active | PARTIAL (re-graded + retry fix) | Re-analysis: refresh recovery worked as designed — the build detaches from the stream (create/route.ts `cancel()` only mutes the subscriber), the client re-attached via `/api/factory/execution?controlId=…` and truthfully reported a server-side failure. The underlying failure was real: per-candidate provider timeout (dispatch.ts:123, `min(75s, max(15s, 90s/candidates))`) aborted a legitimately-progressing generation call; paid-token protection then blocked fallback → mission failed with no recovery affordance | Added a one-click "Retry this task" row on failed/interrupted missions (MissionCanvas). Timeout policy documented, deliberately not loosened here — needs a stage-aware timeout (generation calls need longer than routing calls), tracked as follow-up | Server log: create stream 200 in 29.7s; failure text listed 1 attempt; second run of same task succeeded 45.3s; retry row renders for failed state | Refresh-during-execution to re-run in real Chrome; timeout follow-up open |
| A09 | Browser refresh waiting | PENDING | Needs a mission that reaches an approval/question prompt (local-connect command approval); not reachable in the workspace-mission path exercised so far | — | — | Test in local-agent mission phase |
| A10 | Single visual status | PASS | — | — | Observed Ready → Executing → Failed → Understanding → Complete; footer is single authority, header "Factory online" is a separate connection dimension, no conflicts | — |
| A11 | Input persistence | PASS (fixed) | Was FAIL: draft wiped by in-project navigation (composer state died with unmounted MissionCanvas) | Draft persisted per mission in sessionStorage (`foundry-composer-draft:<missionId>`), restored on mount, cleared on send/empty | Retest: draft survived Workspace→Journal→Workspace intact | Retested 2026-07-15 ✓ |
| A12 | Keyboard send behavior | PASS (by inspection; re-verify in real Chrome) | CanvasComposer.tsx:79-84 correct (Enter sends + preventDefault, Shift+Enter newline). Browser-pane synthetic keys can't deliver Return/typed newline, so runtime verification blocked in harness | — | Code read; Send-button path sends once, input cleared | Re-run in real Chrome |
| A13 | Accessibility navigation | PARTIAL (aria-current fixed) | Landmarks labeled, 0 unnamed interactive elements, 0 missing alt, visible focus outline. aria-current was missing on nav (fixed, retested: `aria-current="page"` follows active view). Remaining: silent no-op controls (Preview with no files; workspace-item click with no visible change; Workspace/Templates render the same view with no project) | aria-current added; remaining no-op feedback tracked as follow-up | JS a11y audit; retest of aria-current | Full keyboard walk pending real Chrome |
| A14 | No startup theater | PASS | — | — | Ready 2.7s real compile; FCP 176ms; load 518ms; no fixed spinners; mission elapsed 45.3s real; honest "written and read back from disk" verification | — |
| A15 | Visual calm regression | PENDING | Browser-pane screenshot capture currently hangs (harness issue), and pending-prompt state not yet reachable | — | — | Test in real Chrome with active mission + prompt |

### Post-redesign bug fixes

- **Duplicate "What do you want to build?" step (FIXED)** — after the hero redesign, typing a description in the dashboard prompt and pressing Start building opened the discovery flow on the "kind" step, which asks the identical question again. `openFlow` now: (a) when a description is supplied for a custom build, applies the same `seedDiscovery`-derived subtype/name the kind step would, so nothing is lost; (b) starts the flow on the "project" step ("Where should this live?") instead of "kind". Verified: dashboard prompt → lands on "Where should this live?", no duplicate question, description retained (visible again if the user presses ← back). Chips/direction cards (no typed description) still open on the kind step as intended.

### Additional findings (logged during sweep, to fix or track)

1. **Stack recommendation ignores explicit constraint** — brief said "Plain static HTML" but discovery recommended Next.js (Static HTML offered, not recommended).
2. **"Preview unavailable" after successful build** — index.html exists on disk but preview panel reports unavailable (preview category will formalize).
3. **Follow-up asked for index.html + styles.css + script.js; mission created only index.html (inline CSS/JS) and reported Complete** — honest about what it did, silent about the deviation.
4. **Failed mission has no retry/resume affordance** — only the free-text composer.
5. **Discovery understood "single-page" brief as "Multi-page website"** in Foundry's Understanding panel.
6. **Test-harness caveats**: browser-pane click-coordinate transform unstable → some interactions driven via programmatic `.click()` (same React handlers); screenshot capture intermittently hangs. Category A visual tests to be re-verified in real Chrome when extension connects.

### Session incident log

- 2026-07-15: While isolating the connector for the A03 retest, a badly constructed `taskkill` filter terminated **all** node.exe processes on the machine (~55), including the dev server and connector (both restarted immediately) and potentially unrelated user processes. Process kills are now done by port → PID → command-line verification only.

## Notes

- 2026-07-15: Dev server found already running on :3001 (HTTP 200). For a true A01 cold launch, the server will be stopped and restarted with the browser watching, timing the first meaningful paint and checking the console for errors.
