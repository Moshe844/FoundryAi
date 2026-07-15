# Mission Canvas — UX Design Specification

**Status:** Implementation-ready. No code in this document; every rule is exact enough to build without guessing.
**Immutable philosophy:** *The Room, With Nothing Faked.* Nothing on screen may be simulated. Every word, motion, refresh, status, approval, summary, and suggestion must originate from a real engineering event. Where a visual rule below conflicts with this law, the law wins.

---

## 0. Vocabulary

| Term | Meaning |
|---|---|
| **Canvas** | The single scrolling surface containing all missions for the open project. |
| **Mission** | One unit of work: user message → work → terminal state (complete / failed / cancelled). |
| **Voice line** | A sentence Foundry says, caused by a real event (decision, finding, report). |
| **Work event** | A real engineering action: file read/write, command run, test result, server start. |
| **Phase** | A named stage of a large mission (real plan step, not decorative). |
| **Blocking card** | The one surface that stops the mission: a question or an approval. |
| **Composer** | The always-present input at the bottom of the Canvas. |
| **Digest** | A collapsed, factual summary line replacing a group of completed work events. |
| **Live edge** | The bottom of the timeline where new events append. |

---

## 1. Global Layout

### 1.1 Desktop (≥ 1280px viewport)

Three fixed horizontal bands, one optional right dock:

```
┌──────────────────────────────────────────────────────────────┐
│ Project Bar (48px, sticky)                                    │
├───────────────────────────────┬──────────────────────────────┤
│                               │                              │
│  Timeline column              │  Preview dock (optional)     │
│  (scrolls; centered when      │  (independent scroll;        │
│   dock closed)                │   real app surface)          │
│                               │                              │
├───────────────────────────────┴──────────────────────────────┤
│ Status Strip (conditional, sticky) + Composer (sticky)       │
└──────────────────────────────────────────────────────────────┘
```

**Widths and hierarchy:**

- **Timeline column:** content max-width **760px**. With dock closed, centered with min **48px** side gutters. With dock open, left-aligned with **40px** left gutter; column may compress to min **480px** before the dock is forced narrower.
- **Preview dock:** default **45%** of viewport width; user-resizable via 6px drag handle between **30%** and **60%**; persisted per project. Below 480px remaining for the timeline, dock loses first.
- **Project Bar:** full width, **48px** tall. Contains, left to right: project name (click = project switcher), branch name, the **single global status dot** (see §7), spacer, Stop control (only while a mission is running), preview toggle (only when a real preview surface exists).
- **Composer:** full timeline-column width, sticky bottom, min height **52px**, grows to max **200px** (then inner scroll). **16px** bottom margin from viewport edge.
- **Status Strip:** 32px band directly above the composer. Exists **only** when a mission is active AND its live edge is scrolled out of view, or a blocking card is off-screen. Never present otherwise. See §6.3.

**There is no left sidebar.** History is the timeline itself (§5). Removing the sidebar removes the #1 source of duplicate status.

### 1.2 Responsive

- **1024–1279px:** dock and timeline cannot coexist. Preview becomes a full-width overlay layer toggled from the Project Bar; timeline keeps its state underneath. Toggle is instant swap, 200ms cross-fade.
- **768–1023px:** timeline column becomes fluid width with 24px gutters. Composer full-width. Everything else identical.
- **< 768px:** single column, 16px gutters. Work-event indentation reduces from 20px to 12px. Blocking card becomes full-width sheet pinned above composer. Preview opens as full-screen layer with a persistent "Back to mission" bar (40px, top).
- Breakpoints are the only layout forks. No feature exists in one width and not another; only arrangement changes.

### 1.3 Vertical structure of the timeline (top → bottom)

1. Collapsed prior missions (one row each, oldest first) — §5.
2. The active (or most recent) mission, expanded.
3. Terminal block of that mission (summary, suggestions) when finished.
4. **Live edge** — 24px of breathing space above the composer.

New follow-ups append at the bottom. The page never inserts content above the viewport (see §6.2 anti-shift rule).

---

## 2. Anatomy of a Mission (in-timeline)

Order inside one expanded mission, top → bottom:

1. **User message.** Full column width. No bubble, no avatar. 16px / 600 weight / primary text color, with a **3px accent-colored left border** and 12px left padding. This is the only element in the timeline with the accent border — it is how the eye finds "what I asked."
2. **Voice lines.** Foundry's sentences. 15px / 400 / primary color, line-height 1.6, max ~70ch. Paragraph spacing 16px. No prefix, no icon, no "Foundry:" label — position and style are the label.
3. **Work events**, grouped under the voice line that caused them. 13px monospace, secondary color, indented **20px**, 6px vertical spacing within a group. Each row = verb + object + real outcome (`ran pnpm test → 41 passed, 2 failed · 8.2s`). A row appears **only when the event has actually happened**; there are no "pending" rows.
4. **Phase headers** (large missions only): 13px / 600 / uppercase-tracking 0.06em / secondary color, 24px top margin, e.g. `2 · API LAYER`. A phase header exists only if a real plan produced it.
5. **Blocking card** (when present): §4.
6. **Terminal block** (when finished): §9–§10.

**Spacing rhythm (8px base unit):**

- Between missions: **48px** plus a 1px hairline divider at 25% opacity.
- User message → first voice line: **20px**.
- Voice line → its work events: **8px**.
- Between event groups: **16px**.
- Phase boundary: **24px** above header, **12px** below.

**Typography scale (complete — nothing else may be introduced):**

| Role | Size / weight / family | Color token |
|---|---|---|
| User message | 16 / 600 / UI sans | text-primary |
| Voice line | 15 / 400 / UI sans | text-primary |
| Summary heading ("Done", "Failed") | 15 / 600 / UI sans | text-primary |
| Work event | 13 / 400 / mono | text-secondary |
| Phase header | 13 / 600 / UI sans, tracked | text-secondary |
| Digest line | 13 / 400 / UI sans | text-secondary |
| Collapsed mission row | 14 / 400 / UI sans | text-secondary (outcome word in status color) |
| Timestamp / meta | 12 / 400 / UI sans | text-tertiary |
| Suggestion | 14 / 400 / UI sans | text-secondary |

Timestamps are hidden by default and appear on row hover (150ms fade) at the right edge of the row. They are never permanently visible — they are the largest source of visual noise and carry no in-the-moment value.

---

## 3. Mission Size Tiers

Tier is determined by the **real plan**, not by heuristics on message length. A mission may upgrade tiers mid-flight if the real work grows; it never fakes a larger ceremony than the work warrants.

| Tier | Trigger (real) | Visual form |
|---|---|---|
| **Tiny** | Single-file or trivially scoped change, no plan generated | User message → 0–1 voice line → 1–3 event rows → one-line completion. Total vertical footprint under ~160px. No phases, no digest, no summary block — the completion line *is* the summary. |
| **Medium** | Multi-file change or investigation; plan is a flat list | Voice lines carry the reasoning trail; event groups per voice line; single summary block at end. No phase headers. |
| **Large** | Real plan with ≥ 3 named steps | Phase headers appear. Each phase **auto-collapses to a digest** when it completes (§3.1). Live phase is the only expanded one. |
| **Huge / autonomous** | Projected long-running (user granted autonomy or plan spans hours) | Digest-first: the timeline shows one digest row per completed phase plus an **elapsed-time meta line** under the user message (`running 2h 14m · phase 4 of 9`, updated only on real events, not on a timer tick). Expanding any digest reveals its full event log. |

### 3.1 Digest rule (collapse-on-completion)

When a phase (or, in medium missions, an event group older than the two most recent groups) completes, it collapses after **600ms** to a single digest row:

```
✓ 1 · Data model — 6 files changed · 2 commands · 38s
```

- Digest content is computed from real recorded events only (counts, durations, failures).
- Collapse animates height over **200ms**; if the user is scrolled into that region, collapse is **deferred** until the region leaves the viewport (never yank content out from under the reading eye).
- Click anywhere on a digest row toggles expansion (200ms). Expanded state persists until manually re-collapsed or mission ends.
- A digest row for a phase containing failures shows the failure count in the failure color and does **not** use the ✓ glyph.

---

## 4. Blocking Cards (questions and approvals)

Both share one placement rule: **rendered in-flow at the live edge, and simultaneously pinned** — if the user scrolls the card off-screen, a condensed 40px version of it docks into the Status Strip above the composer. There is never a moment when a blocked mission is invisible.

### 4.1 Question card

- Width: full timeline column. Background: raised surface (one elevation step above canvas). Border-radius 8px. Padding 20px. **No color-coded border** — questions are not alarms.
- Contents: the question as a voice line (15/400), then 2–4 option rows (14/500, full-width click targets, 44px tall), then a free-text affordance ("or tell me something else") which focuses the composer.
- A question card may exist **only** because the work reached a real fork. It must name the fork's consequence in each option (e.g. "Postgres — matches your existing docker-compose" not just "Postgres").
- While a question is open, the mission is visibly paused: the status dot goes to `waiting` (§7), and **no new work events may appear** (nothing real is happening — the law forbids pretending otherwise).

### 4.2 Approval card

- Same geometry as question card, plus a **1px border in the caution color** and a caution glyph beside the heading. This is the only bordered card in the product.
- Contents, in order: one sentence stating the exact pending action ("About to run a migration that drops the `sessions` table on your local DB"), an expandable exact-payload row (the real command / diff / request, collapsed by default, mono 13), consequence line ("If declined: I'll keep the table and adjust the plan"), then two buttons: **Approve** (solid, caution color) and **Decline** (ghost). No third option.
- An approval card may exist only when a real, consequential, hard-to-reverse action is genuinely queued. It must never appear as ceremony.
- Approve/Decline are single-click, no confirm-the-confirm. On decision, the card collapses to a permanent one-line record in the timeline: `Approved: drop sessions table · 14:32` (12/tertiary) — the audit trail stays real and visible.

### 4.3 Keyboard & focus

- When a blocking card appears while the user's focus is in the composer, focus is **not stolen**; instead the card receives `aria-live="assertive"` announcement and the composer shows a subtle hint row ("↑ Foundry is waiting on a decision — Tab to answer").
- If focus is anywhere else, focus moves to the card's first option.
- `Esc` never dismisses a blocking card (there is no dismiss — the fork is real).

---

## 5. History & Prior Missions

- Every finished mission collapses to **one row**, 40px tall: status glyph (✓ / ✕ / ⊘) in its status color, first user message truncated to one line, an em-dash, the real outcome phrase (from the actual summary, e.g. "fixed the timezone offset in exports"), and a relative timestamp on hover.
- Collapse of the just-finished mission happens **only when the next mission starts** (the finished mission's summary and suggestions stay expanded until then — §9, §10). Older missions are always collapsed.
- Click a collapsed row → it expands **in place** (300ms height animation) to its full recorded timeline: every voice line, event, digest, approval record, exactly as it happened. Nothing is re-rendered from a prettied summary; it is the original trace.
- Only **one** prior mission may be expanded at a time; expanding another collapses the first (200ms).
- Projects with > 30 finished missions: rows older than the most recent 30 load on upward scroll in pages of 30 (loading indicator appears only during the real fetch).
- **Follow-up vs. new mission:** the user never chooses. Every composer send enters the timeline at the bottom as a new user message. If it continues the prior mission's work (the engine's real determination), it renders inside the same mission block with a 24px gap and no divider; if it's new work, the prior mission collapses (§5 bullet 2) and a divider + 48px gap precede it. The visual grouping always reflects the engine's real relationship, never a guess made by the UI layer.

---

## 6. Scrolling, Auto-Follow, Stickiness

### 6.1 Auto-follow

- When the user is at the live edge (within **120px** of bottom), new content appending keeps the view pinned to bottom (smooth scroll, 200ms, but instant if events arrive faster than 1/200ms — never queue an animation backlog).
- Any upward scroll of ≥ **80px** breaks follow immediately. No new content moves the viewport while follow is broken.
- While follow is broken and real events are arriving, a pill appears bottom-right above the composer: `● 3 new events ↓` — the count is real, updates on real events only. Click or `End` key: return to live edge (300ms) and re-arm follow. The pill never pulses on a timer; it changes only when its number changes.

### 6.2 Anti-shift rule (absolute)

Content already on screen never moves except by user action (scroll, expand/collapse click) or the ≤200ms collapse of a region that has already left the viewport. Nothing above the viewport ever changes height while the user reads. This rule outranks every animation below it.

### 6.3 Sticky inventory (complete list — nothing else may stick)

1. Project Bar (always).
2. Composer (always).
3. Status Strip (only under its §1.1 conditions).
4. Condensed blocking card inside the Status Strip (only while a blocking card exists off-screen).
5. Current phase header for large/huge missions: while its phase's events fill the viewport, the header sticks under the Project Bar (standard sticky-header behavior), so the user always knows *which* real phase they're looking at.

---

## 7. The Single-Status Law (clutter prevention)

**Exactly one element on screen may claim live status at any moment.** Precedence:

1. Blocking card (or its condensed strip form) — outranks everything.
2. The live activity row (§7.1) at the live edge.
3. The status dot in the Project Bar — the *only* indicator when the timeline's live parts are off-screen.

Enforcement rules:

- No spinners anywhere, ever. A spinner is a promise of progress with no evidence behind it — banned by the law.
- The **status dot** has exactly four states: `idle` (hollow), `working` (solid accent), `waiting` (solid caution), `failed` (solid failure). It changes only on real state transitions. It does not animate continuously.
- **7.1 Live activity row:** at the live edge of a working mission, one 13px mono row shows the most recent real event verbatim (`writing lib/export/tz.ts`). It updates only when a new real event arrives. If **12 seconds** pass with no event, the row appends elapsed silence honestly: `writing lib/export/tz.ts · 14s`, counting up. If **60s** pass with no event and no heartbeat from the engine, the row converts to a stall notice: `no activity for 1m — investigating connection` and the status dot goes hollow. **The screen is allowed to feel a stall.** This is the load-bearing honesty of the entire product.
- Two missions can never be live at once (product invariant); the UI therefore never needs to reconcile competing statuses.
- Digest rows, collapsed missions, and summaries use past-tense verbs and status colors only — they may never use the live activity style. Live style (mono row + dot linkage) is reserved for the actual live edge.

---

## 8. Preview Dock

- The dock may open **only** when a real runnable surface exists — a server that actually started, a page that actually loads. Its appearance is itself a work event ("dev server up on :3210 → opening preview").
- **Auto-open:** first time a preview surface becomes real in a mission, the dock opens automatically (see motion, §12). Subsequent opens/closes are user-controlled via the Project Bar toggle; the user's last choice wins for the rest of the mission.
- **Dock header (36px):** the real URL (click = copy), a refreshed-timestamp ("refreshed 4s ago" — the time of the last *real* reload), a manual reload button, open-in-browser, close.
- **Refresh honesty:** the preview reloads only when the underlying artifact really changed (real rebuild/HMR event). During a rebuild the previous frame stays visible with a 1px accent progress bar at the dock's top edge that tracks the real rebuild lifecycle (indeterminate is forbidden; if the toolchain provides no progress, the bar is a static 1px accent line that appears at rebuild start and disappears at completion — presence, not motion, signals the real state). If the app is currently broken, the dock shows the real error output — never a stale healthy frame presented as current.
- **Close →** timeline column re-centers, width animates 760px-max centered over **320ms**. Text does not reflow mid-animation: the column translates first, then reflows once at the final width (translate + single reflow, not continuous reflow).
- The dock never screenshots or freezes content to fake liveness. If the server dies, the dock says so (real event) and offers reopen-when-back (which triggers on the real restart event).

---

## 9. Summaries (terminal block, medium+ missions)

Rendered in-flow at the end of the mission:

1. Heading: `Done` / `Failed` / `Stopped` (15/600, status color), plus real elapsed time (12/tertiary).
2. **What changed:** ≤ 5 lines, each a real claim linked to its evidence — clicking a line scrolls to (and flash-highlights, 600ms fade) the actual events that back it.
3. **Verified:** only things actually exercised (`ran the export with 3 timezones — all correct`). If nothing was verified, the line reads `not verified — I wrote it but didn't run it`, in the caution color. The word "working" is banned unless a verification event exists.
4. **Watch for:** present only if real uncertainty exists; otherwise the section is absent (no boilerplate caution).

The summary is plain timeline content — no card, no border. 20px top margin after the last event.

---

## 10. Suggestions

- Appear **only** below a completed mission's summary, only if real opportunities were noticed during the actual work. Zero is a valid and common count. Max **3**.
- Form: single lines, 14/400/secondary, prefixed `↳`, full-row click target. No pills, no buttons.
- Click → the suggestion's text is inserted into the composer **and sent** as a real user message (one click = one send; the user sees their message appear in the timeline exactly like a typed one). All suggestion rows disappear at that instant (120ms fade) — they are proposals for *a* next step, mooted the moment any next step begins, including a typed follow-up.
- Suggestions never reappear after dismissal-by-action. They remain visible in an expanded prior mission's trace as struck-through records (they are part of what really happened).

---

## 11. Motion System (complete)

| Token | Duration | Easing | Used for |
|---|---|---|---|
| `micro` | 120ms | ease-out | hovers, timestamp fades, suggestion fade |
| `region` | 200ms | cubic-bezier(0.2, 0, 0, 1) | collapse/expand, pill, cross-fades |
| `layout` | 320ms | cubic-bezier(0.2, 0, 0, 1) | dock open/close, column re-center, mission expand |

Rules:

- **No animation without a real cause.** Every transition maps 1:1 to a real event or a user action. Idle screens are perfectly still.
- No looping/infinite animations anywhere. No skeleton screens (a skeleton is a simulated document — banned; the real content appears when it really exists, and load time is honest).
- Maximum one `layout` animation at a time; queued ones coalesce to the final state.
- `prefers-reduced-motion`: all three tokens become 0ms opacity swaps; auto-follow becomes instant jumps; the flash-highlight becomes a 2px static outline for 2s.

---

## 12. Accessibility (global)

- Voice lines announce via `aria-live="polite"`; blocking cards via `aria-live="assertive"`; work events are **not** announced individually (digests are announced on phase completion).
- Full keyboard path: `Tab` order is composer → blocking card (if any) → Project Bar. `PageUp/PageDown` scroll timeline; `End` = jump to live; `Ctrl+.` = Stop (with §14 semantics).
- Every collapse toggle is a real button with `aria-expanded`; digests expose their full text, not just counts, to screen readers.
- All text ≥ 4.5:1 contrast; status colors are never the sole carrier of meaning (glyph + word always accompany).
- Status dot exposes a text equivalent (`aria-label="working"` etc.).

---

## 13. State Specifications

Each state: **1** Screen structure · **2** Visual hierarchy · **3** User-visible content · **4** Changed from previous · **5** Must disappear · **6** Persistent · **7** Interaction · **8** Motion · **9** Accessibility · **10** Acceptance criteria.

---

### 13.1 Idle project (nothing running)

1. Project Bar · collapsed mission rows (if history exists) · last mission expanded with its summary/suggestions (if session-recent) · composer. For a brand-new empty project: Project Bar, one voice line stating what Foundry actually found on connect (real inspection output), composer. Nothing else — no feature tour, no sample prompts pretending to be personalized.
2. Composer is the strongest element (focused, cursor blinking — the only motion on screen, and it's the OS caret, not ours). Everything above is secondary/tertiary tones.
3. History rows; real connect-inspection sentence for new projects.
4. From complete: nothing changes on a timer. Idle is reached by user inaction only.
5. Status Strip, live activity row, stop control.
6. Project Bar (dot: hollow `idle`), composer, history.
7. Typing and sending; expanding history rows; opening preview only if a previously real surface is still actually up (verified by a real health check on toggle press — if dead, the toggle shows the real result).
8. None. The idle screen is completely still. Stillness = honesty about nothing happening.
9. Composer focused on load; page title = project name.
10. ✓ Zero animated elements at rest ✓ dot is hollow ✓ no Status Strip ✓ new-project voice line quotes ≥ 1 verifiable fact from the real inspection ✓ composer reachable in 0 keystrokes.

---

### 13.2 Tiny edit in progress

1. Prior content unchanged above; at bottom: user message (accent border), then 0–1 voice line, then event rows appearing as they really happen, then live activity row.
2. The live activity row and the user's own message dominate; everything else recedes (history stays in secondary tones).
3. E.g.: `fix the typo in the pricing header` → `editing components/PricingHeader.tsx` → `✓ done — "Anual" → "Annual" · 3s`.
4. Composer cleared; dot → `working`; Stop appears in Project Bar.
5. Any prior mission's suggestions (fade 120ms — a new step began).
6. Bar, composer, history rows.
7. User may keep typing (composer never locks). Send during work = queued follow-up, rendered immediately in the timeline as their message with meta line `queued — will pick this up next` (real engine state).
8. Each event row fades/slides in 8px, `region` token, only on real arrival.
9. Voice line announced politely; completion line announced.
10. ✓ No plan, phase, or summary block ✓ total footprint < 160px ✓ completion within one screen of the ask ✓ no spinner at any point ✓ if the edit truly takes long, elapsed-silence counter appears per §7.1 (the tininess of the *ask* never fakes tininess of the *work*).

---

### 13.3 Debugging mission (medium)

1. User message → alternating voice lines (hypotheses, findings) and evidence event groups → live activity row at the edge.
2. Voice lines carry the narrative; evidence is indented mono beneath each. The *most recent* hypothesis is at the live edge — hierarchy is recency.
3. The real hunt, dead ends included: `timezone conversion looks right — checking the serializer instead` followed by the actual command outputs that justified the pivot. Dead ends are never edited out.
4. From tiny tier: reasoning trail is present; event groups older than the last two auto-digest (§3.1).
5. Nothing forcibly; older evidence self-digests.
6. Bar, composer, Stop.
7. Expanding digested evidence; the user can reply mid-hunt ("check the DST case") — appears instantly as a queued/incorporated message per the engine's real handling, labeled with whichever really happened.
8. Standard event arrival; digest collapse per §3.1.
9. Each new hypothesis voice line announced politely.
10. ✓ Every "found it" claim has a clickable evidence link ✓ dead-end lines remain in the trace ✓ no phase headers ✓ at most 2 expanded evidence groups at once without user action.

---

### 13.4 Large multi-phase build

1. User message → 1–3 voice lines stating the real plan → phase 1 header → its events → … → live phase expanded at the edge; completed phases as ✓ digests.
2. Phase headers structure the scan; the expanded live phase dominates; digests compress the past.
3. Plan statement names the real phases; each digest carries real counts/durations.
4. From medium: phase headers exist; sticky current-phase header active (§6.3.5).
5. Completed phases' event logs (into digests, §3.1 timing).
6. Bar, composer, Stop, sticky phase header.
7. Digest expand/collapse; mid-build replies; clicking the plan voice line scrolls to the corresponding phase.
8. Phase completion: events collapse (200ms) then the ✓ digest and next phase header appear on their real events.
9. Phase completion announced with its digest text; sticky header is `aria-hidden` (duplicate of in-flow header).
10. ✓ Exactly one expanded phase without user action ✓ mission's on-screen height stays roughly constant across phases (digesting ≈ offsets growth) ✓ phase count on screen equals real plan length ✓ upgrade from medium tier mid-flight inserts headers *below* already-rendered content only (anti-shift, §6.2).

---

### 13.5 Waiting for one user decision (question)

1. Timeline as-was, work events halted; question card at the live edge; Status Strip with condensed question if scrolled away.
2. The card outranks everything (§7 precedence 1). Live activity row is gone — nothing is live.
3. The real fork, options with real consequences (§4.1).
4. Live activity row removed (nothing is happening — showing motion would be a lie); dot → `waiting`; card appears.
5. Live activity row. Any elapsed-silence counter.
6. Bar, composer, everything scrolled above.
7. Click an option (single click decides, card collapses to one-line record like §4.2's), or type in composer (a typed answer is a real answer; the engine treats it as the decision, card records `answered in chat`).
8. Card enters with `region` fade/slide; on decision, collapses to record line (200ms) and work events resume appearing on real resumption.
9. Assertive announcement; focus per §4.3; options are radio-group semantics.
10. ✓ Zero work events render while the card is open ✓ dot is `waiting` ✓ card unreachable-off-screen never occurs (strip form) ✓ decision recorded permanently in trace ✓ Esc does nothing.

---

### 13.6 Waiting for approval

Same as 13.5 except:

3. Exact pending action, expandable real payload, consequence-of-decline (§4.2). Caution border + glyph — the only bordered element in the product.
7. Approve/Decline only. Decline is a first-class path: mission resumes with a voice line stating the real replan.
10. ✓ Payload row contains the byte-exact command/diff ✓ approve executes exactly what was shown (any drift between shown and executed is a critical defect) ✓ record line persists with timestamp ✓ approvals never appear for actions the permission model already covers (no ceremony).

---

### 13.7 Adaptive preview open

1. Dock occupies right 45%; timeline compresses left (§1.1); dock header + live app.
2. During active work the live edge still leads; when the user interacts with the preview, the preview is the focus and the timeline recedes (no style change needed — attention follows the pointer; the UI does nothing).
3. The real app, at its real URL, in its real current state — broken states included; rebuild bar per §8.
4. Auto-open on first real surface: dock slides in 320ms, timeline translates left simultaneously (one `layout` animation, coalesced).
5. Nothing.
6. Everything; preview toggle in Bar now shows open state.
7. Interact with the real app; resize via handle; manual reload; close.
8. §8 rules; refresh flashes nothing — the new frame simply is the content (a real reload needs no announcement animation).
9. Dock is a labeled region ("Preview — localhost:3210"); reload button focusable; resize handle keyboard-operable (arrow keys, 32px steps).
10. ✓ Dock cannot open without a real reachable surface ✓ "refreshed Ns ago" always matches the last real reload ✓ broken app shows real error, never a stale frame ✓ user interactions in the preview hit the real app (same instance the engine tests against).

---

### 13.8 Preview closed

1. Timeline re-centers to max-760 centered.
4. Column translate + single end-state reflow, 320ms (§8).
5. Dock, its header, rebuild bar.
6. Preview toggle remains in Bar (surface still real); everything else.
7. Toggle re-opens instantly to the live current state (with a real health check if > 60s since last contact).
10. ✓ No mid-animation text reflow ✓ scroll position preserved relative to the live edge ✓ toggle hidden entirely if the surface is really gone (server stopped) — a toggle to nothing is a simulated affordance.

---

### 13.9 Mission completed

1. Last events → summary block (§9) → suggestions (§10) → composer. Mission stays fully expanded.
2. `Done` heading strongest in the terminal block; verified/watch-for lines next; suggestions quietest.
3. Real claims, real verification results, real caveats, 0–3 real suggestions.
4. Live activity row → removed; dot → hollow; Stop control removed; summary appears **only after the real final event** (never before verification finishes).
5. Live activity row, Stop, Status Strip.
6. Bar, composer, the full mission trace (until the next mission starts — §5).
7. Evidence-link clicks (scroll + flash); suggestion clicks (§10); expanding digests; typing follow-up.
8. Summary fades in as one block (`region`); no celebration animation (completion is a fact, not a performance).
9. Summary announced politely as a whole; suggestions listed as a group.
10. ✓ "working/verified" wording appears only with a verification event behind it ✓ unverified work is explicitly labeled ✓ every summary line has a working evidence link ✓ zero suggestions renders zero rows (no placeholder).

---

### 13.10 Project-aware suggestions (idle, no mission just finished)

Covered by 13.1 + §10 with one addition: on connect/reopen, if the real inspection surfaced concrete findings (failing CI, uncommitted changes, TODO density), Foundry may voice **one** sentence with up to 3 suggestion rows beneath it. If inspection found nothing worth saying, it says nothing — an empty idle screen is correct and common.

10. ✓ Each suggestion names its real evidence ("3 tests failing on main since Tuesday") ✓ absence of suggestions produces no "all clear!" filler line.

---

### 13.11 Follow-up after completion

1. User sends; message appears at bottom. Engine really determines relationship (§5): continuation renders inside the same mission block (24px gap, no divider); new work collapses the prior mission to its row first.
4. Suggestions vanish (120ms) the instant the message enters; dot → `working`; Stop returns.
5. Suggestions; the prior summary's *terminal* status as "current" (it remains in the trace but the live edge moves below it).
7. Identical to any mission start thereafter (tier per the real plan of the follow-up).
8. Prior-mission collapse (200ms) completes **before** the new message renders (sequenced, not simultaneous — anti-shift).
10. ✓ User never asked "follow-up or new?" ✓ grouping matches the engine's real linkage ✓ a follow-up to a mission from days ago expands that mission's row and appends inside it.

---

### 13.12 Previous mission expanded

1. Clicked row grows in place to the full original trace; all other prior missions stay rows; active/latest mission unaffected below.
2. The expanded trace adopts normal mission hierarchy but with all phases digested (fully past = fully compressed; user expands what they need).
3. The genuine recorded trace: voice, events, approval records, struck-through unsent suggestions, original summary.
4. One-at-a-time rule: previously expanded prior mission collapses (200ms) as this one opens (300ms) — sequenced.
5. Nothing else.
6. Everything sticky; scroll anchored to the clicked row's top edge (the row the user clicked never moves — expansion grows downward).
7. Collapse via the same row header (sticky within the expanded region so it's always reachable); evidence links work; digests expand.
8. `layout` token for the in-place growth.
9. Row is a button with `aria-expanded`; on expand, focus stays on the header.
10. ✓ Trace is the original record, not a regenerated summary ✓ clicked header never shifts ✓ exactly ≤ 1 prior mission expanded ✓ live edge of an active mission remains reachable via `End` regardless.

---

### 13.13 Stop / cancel

1. User presses Stop (Bar) or `Ctrl+.`. **One press = graceful stop request; the button converts to `Stop now` for hard-abort.** A voice line appears on the real acknowledgment: `stopping — finishing the file write so nothing is left half-saved`.
2. The stopping voice line is the focus at the live edge.
3. Real wind-down events (they are real work: reverting a half-edit, killing a process), then terminal block with heading `Stopped` (neutral color, not failure), a factual state-of-the-world summary: what was completed, what was rolled back, what is half-done and where.
4. Dot: `working` → hollow only when truly stopped (not at button press — the press is a request, the stop is an event).
5. Live activity row (after final wind-down event), Stop control.
6. The entire partial trace — cancelled work is never hidden; it happened.
7. `Stop now` during wind-down = immediate abort; summary then honestly reports possibly-inconsistent state. Follow-ups from a stopped mission behave per §5.
8. No special motion; wind-down events render like any events.
9. Stop is announced ("stopping — 2 cleanup steps"); `Stopped` summary announced.
10. ✓ Button press ≠ instant status change (status follows reality) ✓ summary enumerates half-done items with file paths ✓ nothing in the trace is deleted ✓ hard-abort is available within 500ms of graceful request at all times.

---

### 13.14 Failure and recovery

1. Work halts on a real failure; voice line states what actually failed with the real error inline (mono, expandable if long); then **either** (a) a voice line stating the recovery it's genuinely attempting (work continues — this is not a terminal state), or (b) if no credible recovery exists, terminal heading `Failed` (failure color) + summary: what was attempted, what's known about the cause, the exact state left behind, and what Foundry would try next as ≤ 2 suggestion rows.
2. In (a), the failure is just a loud event in an ongoing mission — dot stays `working`. In (b), `Failed` heading dominates; dot → `failed` and stays `failed` until the next user message.
3. Real stack traces/output, never paraphrased away; recovery attempts numbered as they really occur (`second approach: pinning the dependency instead`).
4. From working: (a) nothing structural changes — honesty about failure-then-recovery *is* the normal texture of real work; (b) live activity row removed, terminal block appears.
5. In (b): live activity row, Stop.
6. Everything else; the full failure trace persists forever in history (a failed mission's collapsed row uses ✕ + failure color).
7. In (b): suggestion rows send as messages (§10); the user can also just type. Retry is never automatic after terminal failure — a new attempt requires a real user message.
8. Failure voice line arrives like any event — **no shake, no flash, no red wash**; the failure color on the heading/glyph is the entire visual weight. Failure is information, not spectacle.
9. (b) heading announced assertively — the one non-blocking assertive announcement, justified because the user may be away.
10. ✓ Raw error text is preserved and expandable ✓ recovery attempts are visible as they happen, not summarized after ✓ `failed` dot persists until the user acts ✓ no automatic retries after terminal failure ✓ (a)-type recoveries require no user attention at all.

---

## 14. Clutter & Conflict Invariants (enforcement checklist)

These are cross-cutting acceptance criteria; any screen violating one is a defect:

1. **One live indicator** on screen, per §7 precedence. Grep test: at most one element in live style.
2. **One accent-bordered element per mission** (the user message). One caution-bordered element per screen maximum (an approval card).
3. **No spinners, no skeletons, no indeterminate progress, no looping animation, no timer-driven UI updates** (elapsed counters in §7.1 are the sole exception and must be labeled as silence, not progress).
4. **No text may claim more certainty than its backing event** ("done" needs a completion event; "working/verified" needs a verification event; "should work" is banned in summaries — replaced by the explicit unverified label).
5. **Anti-shift (§6.2) is absolute.**
6. **Every affordance is real:** no button, toggle, or link may exist whose target is currently impossible (preview toggle without a live surface, retry without a plan, etc.). Disabled-but-visible is not an alternative; impossible affordances are absent.
7. **Word count discipline:** voice lines ≤ 2 sentences except plan statements and summaries; no filler acknowledgments ("Sure!", "Great question") — Foundry's first token after a user message is already content.
8. **Density budget:** at default zoom on a 1440×900 desktop, a working screen shows at most: 1 user message, ~6 voice lines, ~12 event rows, 1 live activity row. Digesting (§3.1) exists to hold this budget; if a screen exceeds it, digest thresholds tighten — the budget wins.
