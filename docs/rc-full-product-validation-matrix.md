# Foundry Full Product Validation Matrix

This is the release-candidate evidence ledger for the July 2026 full-product walkthrough. A row is only `PASS` when it has direct browser, runtime, command, or filesystem evidence. Opening a screen is not evidence that its build works.

Status values: `NOT RUN`, `RUNNING`, `PASS`, `FAIL`, `BLOCKED`, `NOT SUPPORTED`.

## Dashboard and entry flows

| Requirement | Status | Evidence / defect |
| --- | --- | --- |
| Create New Project | NOT RUN | |
| Open Existing Project | NOT RUN | |
| Continue Project | FAIL | Persisted inventory mission resumes as Blocked after a successful dependency command. |
| Runtime connection | PASS | Live UI at `http://localhost:3001/` reports Factory online and exposes the persisted workspace. |
| Every control, transition, animation, and responsive layout | RUNNING | Supplied 1560px screenshot shows clipped right-hand cards and content hidden at the bottom. |

## Pre-added starter cards

| Card | Discovery | Real build | Verification | Real preview/artifact | Interactive use | Final |
| --- | --- | --- | --- | --- | --- | --- |
| Inventory System | PASS | PASS | PASS | PASS | PASS | PASS |
| E-commerce Store | PASS | PASS | PASS | PASS | PASS | PASS |
| POS App | PASS | PASS | PASS | PASS | PASS | PASS |
| Dashboard | PASS | PASS | PASS | PASS | PASS | PASS |
| Website | PASS | PASS | PASS | PASS | PASS | PASS |
| Mobile App | PASS | FAIL | PASS | PASS | PASS | FAIL |
| Game | PASS | FAIL | PASS | PASS | PASS | FAIL |
| API | PASS | PASS | PASS | PASS | PASS | PASS |
| AI Application | PASS | FAIL | PASS | PASS | PASS | FAIL |
| Desktop Application | PASS | FAIL | PASS | PASS | PASS | FAIL |
| Custom Build | PASS | FAIL | PASS | PASS | PASS | FAIL |

## Discovery matrix

| Requirement | Status | Evidence / defect |
| --- | --- | --- |
| Every starter and subtype | NOT RUN | |
| Every stack recommendation and language | NOT RUN | |
| Custom project | NOT RUN | |
| Existing folder | NOT RUN | |
| Upload folder / files | NOT RUN | |
| Foundry workspace | NOT RUN | |

## Mission and execution behavior

| Requirement | Status | Evidence / defect |
| --- | --- | --- |
| Tiny, small, medium, large, huge missions | NOT RUN | |
| Architecture and debugging | NOT RUN | |
| Follow-up spam, interruption, cancellation, resume, direction change | NOT RUN | |
| Undo, retry, history, suggestions | NOT RUN | |
| Approve, deny, refresh, reconnect, switch project | NOT RUN | |
| Current work visible; prior work collapses | NOT RUN | |
| No duplicate prompts/events | NOT RUN | |
| No fake progress, queue, or contradictory state | FAIL | Successful `npm install` is followed by a provider-limit blocker. |
| No generic summaries/suggestions | NOT RUN | |
| No broken follow-ups, scrolling, or lost context | NOT RUN | |

## Preview and artifact truthfulness

| Requirement | Status | Evidence / defect |
| --- | --- | --- |
| Web live site and desktop/tablet/mobile responsive modes | NOT RUN | |
| Dock without covering/breaking workspace | PASS | Desktop dock measured 449px beside a 549px mission canvas inside the 1004px row; it did not overlay the canvas. |
| Resize, collapse, expand, full-screen, close, immediate width restore | PASS | Desktop collapse removed the 449px dock and 6px separator and immediately expanded the mission canvas from 549px to 1004px. Keyboard resize changed the dock from 45% to 49%. Full-screen entered with an explicit Exit control, and exiting restored the dock separator. |
| Refresh/open/error inspection and recovery | NOT RUN | |
| Desktop streamed/screenshot preview and verified platform packages | PASS | Real self-contained Windows x64 executable built, launched visibly, and remained responsive. |
| Desktop download metadata and separate installers | PASS | Server-derived card now requires an on-disk file and reports app, platform, version, type, size, creation time, verified state, and a real download URL. |
| Mobile emulator/device preview and Android/iOS sizes | NOT RUN | |
| APK/AAB/IPA metadata, readiness, QR/deploy actions | NOT RUN | Current result type has no structured mobile artifact metadata. |
| Game keyboard/mouse/touch/controller/audio/pause/restart/full-screen | PASS | Keyboard-accessible start, pause/resume, mute persistence, pointer/touch drag, restart, HUD, responsive scaling, and explicit full-screen-unavailable recovery were live-tested. Controller hardware and real audio output were not available; no unsupported claim is made. |
| API service state, endpoints, ports, logs, health, tests, request tool | PASS | Real Express service is running on port 3117. Health, filtered list, create/update/delete, validation 400, missing/unknown 404s, OpenAPI 3.0.3, structured request logs, CORS, request IDs, 6/6 automated tests, production TypeScript build, and the Foundry API request playground were verified. |
| Browser extension preview/artifact | NOT RUN | Current preview platform union has no browser-extension type. |
| Documents/reports/generated files with real metadata | NOT RUN | Current result type has no structured downloadable-artifact metadata. |
| Installers and packaged builds | NOT RUN | |
| Statuses Building/Starting/Running/Stopped/Failed/Outdated/Verified | FAIL | Current preview state only models unavailable/starting/ready/error. |
| Never show Ready/Running/Download/Verified without confirmation | NOT RUN | |
| Preserve mission context across preview/file/device switching | NOT RUN | |

## Generated-project matrix

Inventory, POS, website, landing page, React, Next.js, desktop, Android, Flutter, API, CLI, library, game, dashboard, blog, and e-commerce must each have a real output and use test. Inventory, E-commerce, POS, Dashboard, Website, Mobile, Game, API, AI, Desktop, and a representative custom Astro content site now have verified real outputs and interactive or operational use tests. Mobile, Game, AI, Desktop, and Custom Build remain final `FAIL` where autonomous execution needed deterministic repair; the remaining custom types are still `NOT RUN`.

## API evidence

- The repaired API discovery was re-run live. REST API produced Node/Express/TypeScript, FastAPI/Python, Go/Gin, and Java/Spring alternatives; Node/Express/TypeScript was visibly recommended and synchronized in the established-project sidebar. The prior static-deployment contradiction is absent, so Discovery is now `PASS`.
- Autonomous execution created a real Express/TypeScript service and repeatedly passed its production build and six endpoint tests, but incorrectly blocked because backend work was forced through browser-visual verification. Backend-only missions now require real build and API tests and skip only genuinely inapplicable visual checklist items.
- Direct release verification passed: TypeScript production build, 6/6 Vitest tests, and zero dependency vulnerabilities after upgrading the generated test toolchain and excluding compiled tests from discovery.
- The live service on port 3117 passed health, pagination/filtering, create/update/delete, invalid-input 400, missing-resource 404, unknown-route 404, request IDs, CORS, structured logs, graceful-shutdown wiring, and OpenAPI 3.0.3 checks. The in-memory repository is labeled honestly; no database is claimed.

## AI Application evidence

- The repaired Document Q&A/RAG discovery was re-run live. It produced five credible alternatives with reasons: Next.js + FastAPI + pgvector, Remix + NestJS, Django + HTMX, Rails + Sidekiq, and ASP.NET + React/Azure AI Search. The recommended stack synchronized in the sidebar. Selecting Enterprise/SaaS now updates the decision rationale itself, and the redundant domain/platform/data questions disappear for the known starter. Discovery is now `PASS` (latency remains a separate performance concern).
- Autonomous execution took more than eight minutes, reached the 16-call ceiling, entered continuation, and was cancelled by a page reload. It left duplicate app roots, no package manifest, no runnable page, and no tests. Autonomous Real build is `FAIL`.
- The repaired project now has one coherent Next.js entry, responsive Enterprise/SaaS workspace navigation, ingestion/document/collection/chat/evaluation/settings views, deterministic local retrieval with passage citations, and an explicit provider-not-configured state. It never presents local retrieval as a live model answer or collects browser-side API keys.
- Release checks pass: TypeScript, 4/4 retrieval tests, optimized production build, and zero dependency vulnerabilities. The production server is live on port 3118 with no browser console errors.
- Live interaction passed for a local retrieval question, visible demo labeling, cited source passages, provider-not-configured recovery guidance, document state distinctions, and a disabled indexing action when no embedding provider exists. At 390×844 the root width remains within the viewport and navigation becomes horizontally scrollable without document-level overflow.

## Mobile evidence

- The pre-added Mobile card preserved `Field operations app` and returned four credible cross-platform choices: React Native/Expo, Flutter, Kotlin Multiplatform, and Ionic/Capacitor. React Native/Expo was selected and carried correctly into the mission brief.
- Stack discovery took about 11 seconds. The result was accurate and used the Fast model, but the latency remains above the desired near-immediate experience.
- Clicking Build moved from the Templates dashboard into the live mission workspace in about 2.3 seconds; execution was visible while files were written.
- The autonomous mission generated partial Expo source, hit the 16-call limit, attempted one recovery turn, and blocked without a package manifest or runnable entry. A manual continuation added routes but stopped after `npm install` without a production build. Autonomous real-build status is therefore `FAIL`.
- Shared greenfield continuation was added to the initial creation path so future starter/custom builds automatically continue across up to three fresh bounded batches instead of stopping after the first call ledger.
- Direct repair added a real Expo manifest/configuration, compatible dependencies, fixed the generated Babel configuration, selected client-side web export, repaired the root route, added accessible capture controls and visible save feedback, and replaced broken tab glyphs with real Ionicons.
- `npm.cmd run typecheck` passes. `expo export --platform web` passes and produces a real 1.52 MB web bundle plus `dist/index.html` and metadata.
- The exported app is live at `http://localhost:3115/`. Dashboard, Tasks, Capture, and Settings render; a `WO-1200` offline record was entered, marked done, saved, cleared from the form, and confirmed with the accessible message `WO-1200 was saved locally and queued for sync.`
- No APK, AAB, IPA, emulator, or connected-device build was produced, so none is claimed. The tested artifact is the real Expo web export only.

## Game evidence

- The pre-added Game card preserved `2D arcade game` and returned appropriate language/engine alternatives: Phaser/TypeScript, Godot/GDScript, Unity/C#, and PixiJS/TypeScript. Phaser was selected for a real browser-playable build.
- Clicking Build moved into the live mission workspace in about 2.4 seconds. The first executor batch hit its cost ceiling, and the newly added greenfield continuation path visibly and automatically ran all three continuation batches without returning to Templates.
- Autonomous creation still failed after 58 model turns because every continuation described the need for `npm run build` but never issued it, then incorrectly claimed browser interaction was unavailable. The project also contained `.keep.ts`/`.touch.ts` marker files and an edited temporary README. Autonomous Real build remains `FAIL`.
- The shared runtime now runs a declared Node production build deterministically when the executor omits it, records the real exit code, and can expose a real preview while interactive verification remains honestly blocked. New-project marker/document rejection now covers both write and edit operations.
- Direct repair removed marker files, upgraded vulnerable Vite 5 to Vite 8.1.4, eliminated all audit vulnerabilities, isolated the nested project from Foundry's parent PostCSS/Tailwind configuration, imported the generated CSS, and added accessible HTML controls/status alongside the Phaser canvas.
- The real Vite production build passes. The production preview returns HTTP 200 and is live at `http://localhost:3116/`. Browser console warnings/errors: 0.
- Live interaction passed for start, restart, pause, resume, mute/unmute with persisted audio state, pointer/touch drag signaling, wave/HUD state, and accessible live status. The full-screen API is unavailable in the in-app browser surface; the game now reports that truthfully and tells the user to open a standard browser window rather than silently pretending full-screen succeeded.
- At 390×844 the repaired canvas measures 390.4×219.6 CSS pixels, the document remains 390 pixels wide, and the complete four-button control bar fits from x=42.3 to x=348.1. The pre-repair canvas remained 910 pixels wide and was clipped despite hidden overflow.

## Website evidence

- A fresh post-fix Website starter produced `projects/marketing-site-3` with 29 real files. Foundry's canonical `npm run build` passed, the owned managed preview started at `http://127.0.0.1:3107`, and the final deterministic browser gate rendered 31,380 text characters, five semantic regions, and 12 interactive controls while exercising two same-origin navigation targets with no console, page, local-request, or navigation errors. This fresh autonomous run supersedes the earlier pre-fix autonomous build failure for the Website starter row.
- The stricter browser gate initially failed because an earlier verification attempted a preview without discovering the existing destination routes. A live autonomous follow-up inspected the project, found the real Work and Journal destinations, rebuilt it, and passed the final gate without any direct/manual edit to the generated project's source files.
- The live Project Files panel listed all 29 files and returned the real on-disk `package.json` content, proving that durable file access no longer short-circuits with the older-record placeholder for this persisted project.
- The terminal mission card displayed exact command durations, two failed preliminary preview commands, the final owned preview URL, final browser evidence, and total elapsed time (`11m 38s`). The preliminary tool-level success label is now distinct from the final rendered-project verification state so the canvas cannot simultaneously imply both passed and failed final verification.

- Live discovery preserved the exact custom subtype, `Independent architecture studio website with project case studies, services, process, team, and consultation inquiry`, rather than collapsing it to a generic website.
- The AI produced five credible, current stack choices: Next.js, Astro, Nuxt, SvelteKit, and Laravel. Astro was selected, followed by an Editorial visual direction.
- Foundry correctly transitioned to the mission workspace when execution started, but the mission stopped after 16 model turns with only 15 files, no package manifest, no routes, and no runnable entry. This is recorded as a real-build failure, not a successful autonomous build.
- The interrupted project was repaired into a coherent Astro site with Home, Projects, five generated case-study routes, Services, Process, Team, and Contact. The real production build generated 11 routes and completed successfully.
- The verified production preview returns HTTP 200 at `http://localhost:3114` and is open in the visible in-app browser.
- Live checks passed for a five-project index, sector filtering (`Residential` reduced the result to exactly Sandow Residences), case-study navigation and outcomes, required-field validation, valid inquiry submission, success feedback, and form reset.
- Generated dependency audit reports zero vulnerabilities. Foundry's typecheck, project-discovery evaluation, and execution-regression evaluation pass after the generic discovery/planning/continuation changes.

## Dashboard evidence

- Live discovery preserved real AI selection and returned four suitable language/stack choices: Next.js/TypeScript, Django/Python, Laravel/PHP, and ASP.NET/C#, with a project-specific recommendation.
- The original autonomous build exposed bounded-batch, exhausted-ledger, missing-entry, marker-file, and placeholder-entry recovery defects. Those were repaired generically; continuation now crosses bounded batches visibly instead of returning to Templates or claiming a stub is complete.
- Generated dependencies were restored and vulnerable Next.js 14.2.5 was upgraded to patched 15.5.19.
- The real production build passed and the production server returned HTTP 200 at `http://localhost:3113`.
- Live checks passed for saved views, channel/date filters, KPI recomputation, accessible trend summary, threshold alert, revenue sorting, search, empty-state recovery, order drill-down, CSV export, and browser print/PDF.
- A fresh production build after the responsive repair passes compile, lint/type validation, static generation, and build tracing for all routes.
- Direct live interaction at `http://127.0.0.1:3107` verified channel/date/search filters, KPI and threshold-alert recomputation, CSV data, revenue sorting, and a real order-detail panel.
- Manual filter changes now change the Saved View selector to `Custom filters`; previously the control misleadingly remained on `Morning Ops` after its state no longer matched that saved view.
- The Local Agent previously reported 390×844 while rendering Playwright's 1280px default because it used `viewportSize` instead of `viewport`. The runner now measures the browser's real `window.innerWidth/innerHeight`, fails mismatches, and its regression test asserts 390×844.
- Responsive verification now passes with a real measured 390×844 browser, no console errors or failed requests, a single-column mobile filter/KPI layout, and the wide orders table contained in its own horizontal scroll panel instead of widening the document.

## Custom Build evidence

- A freeform North River Astronomy Club request completed real AI discovery with Astro + TypeScript recommended over Next.js, Vite/React, and static HTML alternatives. Explicit event-calendar, observing-guide, membership-form, accessibility, no-auth, and no-database constraints persisted into the brief.
- The original autonomous run produced 36 reported files but reached its model-call limit and did not actually create the package manifest it claimed to edit. Autonomous Real build remains `FAIL`.
- Generic Astro scaffold provisioning now creates a real manifest, strict TypeScript configuration, and nested-project PostCSS isolation before execution. Astro/Vite-family previews receive the managed host and port explicitly instead of ignoring Foundry's `PORT` environment variable.
- The repaired project production build passes and generates nine real routes. The preview is live at `http://127.0.0.1:3106`.
- Live interaction verified homepage content, calendar navigation and four events, membership form required-field behavior, real form values/consent state, and desktop/tablet/mobile preview controls.
- Foundry's own browser runner validated the membership page at real 1440×900 and 390×844 viewports and ended `Complete` from two recorded runtime passes without source edits.

## E-commerce evidence

- Discovery completed from the pre-added E-commerce card with a clothing-store domain, recommended Next.js stack, premium style direction, and a local-first acceptance brief.
- Foundry generated the real project at `projects/direct-to-consumer-clothing-e-commerce-web-store`; production `npm.cmd run build` passes for 10 App Router routes.
- Live runtime returned HTTP 200 at `http://localhost:3110` and was opened in the visible in-app browser.
- Interactively verified seeded catalog, product detail, size/color variant selection, disabled out-of-stock purchase, persistent cart across full navigation, simulated checkout, order confirmation, account order history, and admin order table.
- Fixed a cart hydration race that erased localStorage on navigation; the repaired project was rebuilt successfully.

## Release blockers discovered so far

1. A successful dependency command can still end in a model-call-limit blocker.
2. The supplied dashboard screenshot shows clipped cards and lost content at a common desktop viewport.
3. Preview states cannot represent stopped, outdated, or verified.
4. Packaged/downloadable artifacts do not have a structured truth model for filename, type, size, platform, version, creation time, or verification state.
5. Browser extensions have no dedicated preview/artifact platform.
6. Inventory generation required repeated manual continuations before automatic batching was repaired.
7. Generated configuration contained malformed JSON, a missing path alias, and an obsolete Next.js version incompatible with the actual Node 24 runtime.
8. Generated Inventory UI initially inverted positive cycle-count deltas.
9. Execution history exposes routing/model internals, giant repeated saved-brief text, misleading elapsed durations, and raw file/read activity; it is not yet a polished engineering narrative.
10. The POS starter was misclassified as an ambiguous generic tool during the rough discovery fallback; a first-class POS discovery profile was added, but the original run proves starter context was not authoritative.
11. Broad dynamic-field keyword matching polluted the POS plan with unrelated upload-field tasks because “transaction” and “remove” appeared anywhere in the brief; matching is now limited to explicit field/schema configuration language.
12. POS generation stopped after writing the receipt component, leaving `/` redirecting to a nonexistent `/register`; its declared dependencies were not installed and its generated Next.js version was obsolete and vulnerable.
13. The in-app browser controller returned an invalid stale tab after the previous handoff, blocking the live interaction gate even though the repaired POS runtime returns HTTP 200.
14. The Website mission began with the pre-fix 50-item planning path, consumed 16 turns creating one or a few files per turn, then stopped without invoking a continuation batch. The resulting site had no package manifest, routes, or runnable entry and required direct repair; a fresh post-fix starter run is still required to prove automatic continuation end to end.
15. The Mobile starter proved automatic continuation was absent from the initial greenfield creation path: it stopped after 17 turns with partial source and no package manifest. Its manual continuation then treated a successful `npm install` as sufficient progress and stopped without running the required Expo export. The shared creation path now continues bounded batches, but a fresh starter run is required to prove this fix end to end.
16. The Game starter proved the greenfield continuation fix works, but also exposed a second boundary failure: three automatic batches repeatedly narrated that the production build should run without issuing it, consuming 58 turns and $2.37 estimated before blocking. A deterministic declared-build gate was added to the shared creation runtime.
17. Generated nested Vite projects inherited Foundry's parent PostCSS/Tailwind configuration, producing unrelated warnings, and the generated stylesheet was not imported. The repaired Game project now isolates PostCSS and imports its CSS; a generic scaffold-level isolation regression is still required.
18. The original Game preview silently failed full-screen in the in-app browser and its canvas remained 910 pixels wide at a 390-pixel viewport. It now exposes a truthful unavailable/recovery message and has measured responsive canvas/control sizing.
19. The AI starter exposed severe execution latency and inefficient one-file-per-model-call behavior: more than eight minutes and 16 calls still produced no runnable project. The shared deterministic build gate cannot repair a missing manifest; creation still needs a stronger bounded scaffold contract.
20. Reloading Foundry explicitly called the Stop API, aborted the server execution, and marked the mission cancelled. Server executions now retain a control snapshot, stream disconnect no longer means Stop, and the client reconnects by polling events/results; a fresh live reload test is required before this continuity fix can be marked proven.
21. The AI run wrote conflicting root and `src/` app trees and edited package/config paths outside the generated project. The direct repair consolidated one entry and excluded obsolete duplicate roots; generic project-boundary regression coverage remains required.
22. The Desktop recommendation panel correctly chose WPF while the discovery sidebar retained its seeded Next.js value. Discovery results now atomically synchronize the recommended option, selected stack, memo, and build brief; typecheck and project-discovery regressions pass.
23. The Desktop mission spent nearly twelve minutes and four bounded batches writing/re-reading overlapping implementations without issuing a build command. It claimed the missing `.csproj` had been edited and produced conflicting root/nested applications. Autonomous real-build status is `FAIL`; deterministic direct repair was required.
24. After a reload, the visible Stop button submitted `stop` as a new mission because the recovered server execution had no local fetch controller. Busy-state detection now includes persisted understanding/planning/executing/verifying/reconnecting states; the live retest stopped the recovered execution and ended in `Cancelled`.
25. Desktop preview initially exposed only a launch action and prose. Artifact metadata is now computed server-side only after a real file is found on disk, and the download route constrains the requested path to the project root.
26. Existing-project inspection labeled nested WPF projects `Unknown` because only the shallow upload-style detector supplied the UI stack. Inspection now uses the same nested manifest-aware stack profile as execution; the live API reports `.NET WPF`.
27. A newer Desktop workspace disappeared after reload because the loader always preferred an older IndexedDB snapshot over the fresher local mirror. Persistence now compares mission/execution timestamps and restores the freshest snapshot. The live reload restored the connected Desktop workspace, Preview control, and verified download card.
28. Read-only validation inherited the failed generated build's saved brief and implementation checklist, then required an unrelated production build. Operation-only missions now bypass carry-forward implementation scope, receive one operation objective, and are judged by the requested runtime evidence.
29. Explicit `validate_browser` requests were downgraded to prose-only inspection or wasted calls searching source for the tool name. Deterministic routing now forces the real browser tool as the first action.
30. Successful browser operations exhausted the six-call budget while the model narrated and marked evidence. Foundry now completes deterministically after the requested number of real browser passes; the live two-viewport run ended `Complete`.
31. The Local Agent accepted screenshot placeholder names with unsupported extensions and waited for `networkidle`. It now normalizes artifacts to a supported image extension and uses `domcontentloaded` plus a visible-body readiness check.
32. The Local Agent claimed responsive viewport dimensions it had not applied (`viewportSize` is not Playwright's context option). It now uses `viewport`, measures the real browser viewport, and fails any requested/actual mismatch.
33. A per-batch model-call ceiling was still able to become a terminal blocker when a greenfield batch used its allowance on project understanding but made no durable write. Greenfield call ceilings are now continuation boundaries even before the first write; existing-project read-only failures still require real progress before automatic continuation to avoid loops.
34. A model-requested browser step and the stricter final generated-project browser gate both used pass/fail language, producing an apparently contradictory canvas. The preliminary event is now labelled `Requested browser step passed`; only the deterministic final gate can label the rendered project verified.

## Desktop Application evidence

- The repaired Desktop discovery was re-run live. The AI produced five credible language choices: WPF/C#/SQLite, Avalonia/C#, Tauri/Rust/TypeScript, Qt/C++, and Electron/TypeScript. WPF was visibly marked recommended and the established-project sidebar simultaneously showed `.NET (C#) WPF + MVVM + SQLite`; Discovery is now `PASS`.
- Clicking Build left the dashboard and entered the visible mission workspace. A live page reload preserved execution and new events continued as the real file count increased from 2 to 4 and onward; reload continuity is therefore proven.
- Autonomous execution consumed four batches, repeatedly rewrote overlapping files, created conflicting root/nested WPF applications, never ran `dotnet build`, and did not actually create the `.csproj` it reported editing. Autonomous real build remains `FAIL`.
- Direct repair consolidated the authoritative nested DeskFlow app, removed obsolete duplicate models/views/services, added the real WPF project, corrected resources and settings wiring, and replaced unnecessary JSON/CSV dependencies with validated platform-library implementations.
- The executable verification harness passes 7/7 checks: SQLite CRUD persistence, search/tag/completed filtering, JSON/CSV round trips, invalid import rejection, recovery restore, undo/redo, and settings persistence.
- `dotnet publish` produced a self-contained single-file Windows x64 artifact at `artifacts/win-x64/DeskFlow.exe`. The file is 164,117,674 bytes, version 1.0.0, and Windows reported its visible `DeskFlow` main window responsive after launch.
- The live in-product artifact card showed DeskFlow.exe, win-x64, version 1.0.0, Windows executable type, 156.5 MB, verified-on-disk state, creation time, Launch desktop app, and Download for Windows. Launch created a responsive process with the visible `DeskFlow` window. The download endpoint returned HTTP 200, `Content-Length: 164117674`, `Content-Disposition: attachment; filename="DeskFlow.exe"`, and `application/octet-stream`.

## POS evidence

- Discovery was re-run live after the known-starter fixes. Retail POS produced five credible full-stack language choices (Next.js/TypeScript, Remix/TypeScript, Nuxt/Vue/TypeScript, Angular/NestJS, and ASP.NET/Blazor). Next.js/TypeScript/Prisma/SQLite was visibly recommended and synchronized in the established-project sidebar; no ambiguity warning appeared. Discovery is now `PASS`.
- Generation failure: the autonomous mission stopped with only `/`, shared state/seed modules, shell, and receipt component. `/` redirected to missing `/register`, so the initial green build was correctly rejected.
- Repair: added real Register, Transactions, Products, Users, and Settings routes using the generated seeded store; implemented search/barcode lookup, stock states, cart quantity/removal, discounts, tax, cash/card tender, change due, held-cart restore, receipt printing, transaction history, and full refunds with inventory restoration.
- Verification: `npm.cmd run typecheck` passes and the production build generates seven application routes plus the not-found route.
- Runtime: `http://localhost:3112/register` returns HTTP 200 and was exercised in the visible in-app browser.
- Interaction: exact barcode lookup isolated Water 16.9oz; cart quantity/removal controls, 10% discount, taxable/non-taxable totals, held-cart clearing/restoration, $10 cash tender, $3.76 change, inventory decrement, full receipt rendering, transaction history, full refund, duplicate-refund blocking, and inventory restoration were verified.
- Responsive: at 390×844 the desktop sidebar became a working menu drawer and the full register remained reachable without covering the workspace; the viewport was restored after testing.
- Discovery remains a recorded defect for the original run, but the resulting application’s build, runtime, and product behavior now pass.

## Discovery fast-path evidence

- Known starter cards now seed discovery from the authoritative catalog category plus the selected subtype, then use the Fast AI reasoning tier to produce multiple suitable language/stack choices; custom/freeform requests retain the selected reasoning tier.
- The known-starter analysis has a short 80 ms minimum UI beat but still waits for the real AI result rather than substituting a hardcoded choice.
- Live Inventory retest selected `Retail inventory` and advanced directly to a single accurate `Inventory management system` domain and its Next.js stack without the duplicated `Retail inventory Inventory management system` label shown in the reported screenshot.
- The earlier Dashboard retest exposed an incorrect single-choice shortcut. That shortcut has been removed; the next live retest must verify multiple AI-selected stack/language choices before Dashboard can pass.
- `typecheck`, `eval:execution-regressions`, and `eval:project-discovery` pass after the change.

## Inventory evidence

- Production build: Next.js 15.5.19 compiled, type-checked, generated all routes, and completed tracing.
- Runtime: `http://localhost:3111` returned HTTP 200 and rendered the real generated application.
- Interaction: Dashboard, Stock Ops, Audit Log, role selector, cycle-count submission, two-location transfer, purchase-order lifecycle/receiving, CSV validation, and CSV commit exercised in the visible browser.
- Correctness retest: `+5` cycle count appears as `+5` in audit history after repair.
- Transfer retest: moving 5 units changed Main Warehouse from 52 to 47 and Front Store from 9 to 14 while preserving total stock; the audit records both endpoints.
- Purchase-order retest: created PO-0001 for 12 units, advanced draft to sent, received it into Main Warehouse, and observed 12/12 plus disabled duplicate receiving.
- CSV retest: duplicate SKU produced an inline validation error and disabled commit; a valid Safety Glasses row committed and increased the catalog from 3 to 4 products.
- Permission retest: Staff role disables `Transfer (Manager)`.
