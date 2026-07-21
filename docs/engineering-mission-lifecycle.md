# Engineering Mission Lifecycle

Foundry completes engineering missions through one evidence-backed lifecycle, regardless of language,
framework, project source, or runtime surface. The lifecycle is a reporting contract over real execution;
it does not force irrelevant web steps onto APIs, native applications, CLIs, libraries, or data projects.

## Canonical phases

1. Understand
2. Plan
3. Analyze
4. Implement
5. Verify
6. Build, when detected
7. Run tests, when detected
8. Launch an application or artifact, when available
9. Validate in a live browser, when applicable
10. Repair and re-test, when evidence exposes a failure
11. Publish, when requested and approved
12. Monitor, when requested or required after publication
13. Produce an engineering report

Every phase is reconstructed from durable timeline events, files, commands, verification records,
previews, and artifacts. A phase can be completed, failed, blocked, or explicitly skipped with a reason.
Skipped is never presented as successful.

## Universal extension boundary

Project detection and verification remain adapter-driven. Ecosystem adapters select commands from real
manifests and checked-in tooling; the lifecycle consumes their normalized evidence and does not branch on
project names or templates. New ecosystems extend detection and verification without changing the mission
or report contracts.

Registry-wide adapter tests and real-toolchain lifecycle tests are reported separately. The former proves
detection and capability contracts for every registered adapter; the latter counts only commands actually
executed with locally available toolchains. Foundry never turns adapter registration into a claimed build.

Publishing and monitoring use the same command permission boundary as other protected work. Foundry can
record a publication as verified only after a real publication command succeeds. Production readiness
additionally requires successful mission verification and monitoring evidence. A generated artifact, a
ready local preview, or a successful build alone cannot satisfy that milestone.

## Completion milestones

The engineering report distinguishes these cumulative evidence levels:

- Saved
- Built
- Tested
- Verified
- Browser validated
- Production ready

The highest reported milestone is calculated from evidence; it is never inferred from optimistic prose.
A ready preview without behavioral browser evidence remains unverified. Any failed required check prevents
Verified and Production ready.

## Terminal engineering report

Every top-level create, existing-project, and rebuild result includes:

- the accepted request and outcome;
- issue and recorded root cause, when applicable;
- actions, changed files, and commands;
- verification and browser evidence;
- publication and monitoring status;
- remaining issues and actionable recommendations;
- the highest evidence-backed completion milestone.

Mission Canvas persists this report with the mission and exposes it in a compact expandable handoff. This
advances the product constitution by making execution auditable, reusable across follow-ups, and truthful
without turning the primary experience into a raw log or another chat transcript.
