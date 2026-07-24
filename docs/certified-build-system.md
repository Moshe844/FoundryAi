# Foundry Certified Build System

This implementation replaces model-authored framework selection with a deterministic certification gate. AI discovery may interpret a request, but `ProductProfile` extraction, stack eligibility, support level, environment readiness, and the final recommendation are machine-readable policy.

## Current audit and migration

The former flow combined starter-specific hardcoded arrays, LLM-authored `stack_options`, generic fallbacks, and client-side string matching. That let an attractive architecture outrank actual Foundry capability and made the user choose among unrelated technologies. Mission Canvas itself consumes a project brief and structured discovery object, so it remains intact; the new system changes the authority feeding that contract.

The migration adds:

- `ProjectTaxonomyRegistry`: `taxonomy.ts`, with 11 families and more than 150 subtypes.
- `ProductProfileExtractor`: `product-profile.ts`.
- `StackCapabilityRegistry` and manifests: `manifests.ts`.
- `StackEligibilityFilter`, `StackRecommendationEngine`, and override validation: `recommendation-engine.ts`.
- `EnvironmentCapabilityDetector`: `environment.ts`.
- `ProjectArchitectureComposer`: `architecture.ts`.
- versioned certification scenarios and registry helpers: `certification.ts`.

The default UI now displays one recommendation and an advanced review. It no longer displays a primary framework grid or an unvalidated free-form stack field. The execution brief contains the profile, certified stack ID, and concise decision evidence. Creation returns `NO_ELIGIBLE_CERTIFIED_STACK` instead of executing a generic or unsupported build.

## Support and known limitations

Only manifest Level 4 stacks are automatically eligible. Stack implementation completeness is independent from current-machine readiness. The curated catalog covers static web, React/Vite, Next.js/PostgreSQL, Node.js APIs, FastAPI, .NET APIs, native Android, native iOS, Flutter, WPF, Electron, Tauri, Phaser, Godot, and Unity. Each has a runtime, artifact, recovery, packaging, and export contract. Environment readiness is reported separately as `ready_local`, `installable_by_foundry`, `requires_user_license`, `requires_remote_builder`, `export_ready`, or `unavailable`. Native iOS final execution uses a connected Mac or Foundry macOS builder and is never reported as locally passed on Windows.

This deliberately favors reliable delivery over catalogue breadth. Existing projects remain governed by detected-stack capability and are not converted by this new-project gate.
