import { explicitPlatformFromPrompt, explicitStackFromPrompt, type ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { StackOption } from "@/lib/ai/project-discovery-llm";

export type ProjectPlatformFamily = "web" | "desktop" | "mobile" | "backend" | "game" | "cli" | "data" | "library" | "embedded" | "unconstrained";

const starterPlatformFamilies: Record<string, ProjectPlatformFamily> = {
  inventory: "web",
  commerce: "web",
  pos: "web",
  dashboard: "web",
  website: "web",
  desktop: "desktop",
  mobile: "mobile",
  api: "backend",
  game: "game",
};

const platformFallbacks: Record<Exclude<ProjectPlatformFamily, "unconstrained">, StackOption[]> = {
  web: [
    { name: "Next.js + TypeScript", why: "A complete typed web stack for interactive pages, server workflows, and production deployment.", recommended: true },
    { name: "Vite + React + TypeScript", why: "A fast client application stack when the product can use a separate API or local-first data.", recommended: false },
    { name: "SvelteKit + TypeScript", why: "A cohesive full-stack web framework with compact components and flexible rendering.", recommended: false },
    { name: "Astro + TypeScript", why: "A content-forward web option that keeps client JavaScript focused on genuinely interactive areas.", recommended: false },
  ],
  desktop: [
    { name: "Electron + React + TypeScript", why: "A cross-platform desktop shell with direct filesystem access and a mature TypeScript ecosystem.", recommended: true },
    { name: "Tauri + React + TypeScript", why: "A smaller native desktop package with a Rust core and a modern web-based interface.", recommended: false },
    { name: ".NET WPF", why: "A strong Windows-native option for rich desktop workflows and deep operating-system integration.", recommended: false },
    { name: "Python + PySide6", why: "A practical desktop choice for automation, local files, and data- or AI-heavy workflows.", recommended: false },
  ],
  mobile: [
    { name: "React Native + Expo", why: "One TypeScript codebase can deliver native iOS and Android experiences with fast device testing.", recommended: true },
    { name: "Flutter + Dart", why: "A cohesive cross-platform UI toolkit with strong control over mobile rendering and interaction.", recommended: false },
    { name: "SwiftUI", why: "The native choice when the product is specifically focused on Apple platforms.", recommended: false },
    { name: "Kotlin + Jetpack Compose", why: "The native choice for an Android-focused application and platform integrations.", recommended: false },
  ],
  backend: [
    { name: "Node.js + Express + TypeScript", why: "A direct, typed service stack with broad library support and simple local execution.", recommended: true },
    { name: "Python + FastAPI", why: "A concise typed API stack that fits data processing, automation, and AI integrations.", recommended: false },
    { name: "ASP.NET Core", why: "A robust service platform for strongly typed APIs, background work, and enterprise integrations.", recommended: false },
    { name: "Go + Chi", why: "A small, fast deployment footprint for focused APIs and concurrent backend workloads.", recommended: false },
  ],
  game: [
    { name: "Godot", why: "A focused open-source engine for shipping a complete 2D or 3D game without web-app scaffolding.", recommended: true },
    { name: "Unity", why: "A mature cross-platform engine with extensive tooling, asset support, and deployment targets.", recommended: false },
    { name: "Phaser + TypeScript", why: "A strong browser-game option with a lightweight TypeScript development loop.", recommended: false },
    { name: "Bevy + Rust", why: "A data-oriented native engine for teams that want Rust performance and control.", recommended: false },
  ],
  cli:[option("Node.js + TypeScript + Commander","A portable typed CLI with broad package integration and straightforward distribution.",true),option("Python + Typer","A concise CLI option for automation and data-heavy workflows."),option("Go + Cobra","A single-binary option with fast startup and easy cross-compilation."),option("Rust + Clap","A high-performance single-binary option with strong correctness guarantees.")],
  data:[option("Python + Polars + DuckDB + pytest","A locally reproducible data stack with fast dataframe operations, embedded analytics, and testable pipelines.",true),option("Python + Pandas + SQLAlchemy + PostgreSQL","A broadly supported alternative for relational ETL and scheduled data workflows."),option("dbt + DuckDB/PostgreSQL","A SQL-first transformation option with lineage, tests, and documentation."),option("Apache Spark + Python","A distributed alternative only when data volume genuinely requires a cluster.")],
  library:[option("TypeScript + tsup + Vitest","A typed package stack with dual-module builds, declarations, tests, and npm publishing.",true),option("Python + Hatch + pytest + mypy","A Python package alternative with isolated builds, typing, tests, and PyPI publishing."),option("Rust + Cargo","A native/WASM library alternative with reproducible builds, docs, tests, and crates.io publishing."),option("Go modules + standard testing","A compact library alternative with stable tooling and simple distribution.")],
  embedded:[option("Rust + embedded-hal + probe-rs","A memory-safe embedded stack with hardware abstraction, flashing, diagnostics, and host-side tests.",true),option("C++ + PlatformIO","The broadest microcontroller and vendor-SDK alternative with reproducible builds and serial monitoring."),option("Zephyr RTOS + C","An RTOS alternative for device trees, networking, scheduling, and supported boards."),option("MicroPython","A rapid-prototyping alternative for supported boards and lower-complexity firmware.")],
};

function discoveryPlatformEvidence(discovery: ProjectDiscoveryResult) {
  const platform = discovery.decisions?.find((decision) => decision.dimension === "platform")?.hypothesis ?? "";
  return `${discovery.prompt} ${discovery.projectType} ${platform} ${discovery.recommendedStack} ${discovery.architecture}`.toLowerCase();
}

type WorkloadSignals={simple:boolean;auth:boolean;email:boolean;database:boolean;payments:boolean;ai:boolean;realtime:boolean;offline:boolean;enterprise:boolean;windows:boolean;ios:boolean;android:boolean;hardware:boolean;browserGame:boolean;threeD:boolean};
function workloadSignals(discovery:ProjectDiscoveryResult):WorkloadSignals{
  // Recommended stacks and architecture prose are model output, not user requirements. Feeding
  // them back here made one hallucinated Auth.js choice self-confirming for every later website.
  const evidence=`${discovery.prompt} ${discovery.projectType} ${(discovery.mainFeatures||[]).join(" ")}`.toLowerCase();
  const targetEvidence=`${discovery.prompt} ${discovery.projectType} ${discovery.decisions?.find(item=>item.dimension==="platform")?.hypothesis||""}`.toLowerCase();
  const auth=/\bauth(?:entication)?|login|log in|sign[- ]?up|password|session|user account|member account|mfa|oauth|password reset\b/.test(evidence);
  const database=/\bdatabase|persist(?:ence|ent)?|inventory|order management|booking|records?|dashboard|multi-user|shared data|postgres|mysql|sqlite\b/.test(evidence);
  const dynamic=/\bapi|payment|checkout|realtime|real-time|ai|upload|admin|multi-user\b/.test(evidence);
  return{simple:!auth&&!database&&!dynamic,auth,email:/\bemail|password reset|verification|invite|notification\b/.test(evidence),database,payments:/\bpayment|checkout|stripe|paypal|subscription|billing\b/.test(evidence),ai:/\bai|llm|model|embedding|vector|inference|machine learning\b/.test(evidence),realtime:/\brealtime|real-time|websocket|chat|presence|live collaboration\b/.test(evidence),offline:/\boffline|local-first|sync\b/.test(evidence),enterprise:/\benterprise|sso|saml|compliance|audit|multi-tenant|rbac\b/.test(evidence),windows:/\bwindows|wpf|winui\b/.test(targetEvidence),ios:/\bios|iphone|ipad|apple\b/.test(targetEvidence),android:/\bandroid|jetpack\b/.test(targetEvidence),hardware:/\bpax|poslink|payment terminal|barcode scanner|licensed sdk|device sdk|usb|serial|bluetooth\b/.test(evidence),browserGame:/\bbrowser game|web game|html5 game\b/.test(evidence),threeD:/\b3d|console|vr|ar|photoreal\b/.test(evidence)};
}
function option(name:string,why:string,recommended=false):StackOption{return{name,why,recommended};}
function capabilityAwareOptions(family:Exclude<ProjectPlatformFamily,"unconstrained">,discovery:ProjectDiscoveryResult):StackOption[]{const s=workloadSignals(discovery);
 if(family==="web"){
  if(s.simple)return[option("HTML + CSS + TypeScript (Vite)","Best fit because this project has no server, account, or shared-data requirement; it stays locally runnable with the smallest reliable toolchain.",true),option("Astro + TypeScript","A content-first alternative with component islands when only a few sections need client interaction."),option("SvelteKit + TypeScript","A lightweight upgrade path if server rendering or form actions become necessary later.")];
  if(s.auth){const mail=s.email?" plus Resend/Postmark behind a mail adapter":"";return[option(`Next.js App Router + TypeScript + Auth.js + Prisma + SQLite→PostgreSQL${mail}`,`Covers the complete account lifecycle: secure cookie sessions, password hashing, migrations, protected routes, reset tokens${s.email?", transactional email":""}, validation, and Playwright tests while remaining zero-setup locally.`,true),option(`Django + PostgreSQL + built-in auth${s.email?" + Postmark/SES":""}`,"A batteries-included Python alternative with mature users, sessions, password reset, migrations, admin tooling, and security defaults."),option("ASP.NET Core + Identity + PostgreSQL","A strongly typed enterprise-ready alternative with Identity, cookie authentication, authorization policies, migrations, and first-class testing."),option("Ruby on Rails + PostgreSQL + Devise","A convention-heavy alternative that delivers registration, recovery, confirmation, sessions, mailers, and database migrations quickly.")];}
  const extras=[s.database?"PostgreSQL + Prisma":"typed server data",s.payments?"Stripe webhooks":"",s.realtime?"WebSockets":"",s.ai?"AI provider adapter":""].filter(Boolean).join(" + ");return[option(`Next.js App Router + TypeScript + ${extras}`,"Best overall fit for the requested web workflows, server operations, typed data boundary, and deployable frontend/backend in one project.",true),option("React + TypeScript + FastAPI + PostgreSQL","Separates a rich client from a Python API, especially useful when data processing or AI work is central."),option("ASP.NET Core + React + PostgreSQL","A strongly typed full-stack alternative for complex business workflows, authorization, and long-lived services."),option("Spring Boot + React + PostgreSQL","A JVM alternative for integration-heavy or enterprise web systems with explicit service boundaries.")];
 }
 if(family==="backend"){if(s.ai)return[option("Python + FastAPI + Pydantic + PostgreSQL","Best fit for AI/data workloads with typed request validation, async provider clients, migrations, background jobs, and OpenAPI.",true),option("Node.js + NestJS + TypeScript + PostgreSQL","A structured TypeScript service alternative with dependency injection, validation, queues, and OpenAPI."),option("Go + Chi + PostgreSQL","A small, efficient service alternative for concurrent APIs and predictable deployment."),option("ASP.NET Core + PostgreSQL","A strongly typed alternative for enterprise authentication, background services, and observability.")];if(s.enterprise)return[option("ASP.NET Core + PostgreSQL + OpenTelemetry","Best fit for enterprise APIs requiring policies, identity integration, background work, diagnostics, and long-term maintainability.",true),option("Java + Spring Boot + PostgreSQL","A mature JVM alternative for integration-heavy services, security policies, and transactional workflows."),option("Node.js + NestJS + TypeScript + PostgreSQL","A productive typed alternative with modular service boundaries and broad integration support."),option("Go + Chi + PostgreSQL","A compact alternative for high-throughput services with simple operational needs.")];return[option("Node.js + NestJS + TypeScript + PostgreSQL","Best general-purpose service stack with typed contracts, validation, migrations, structured modules, tests, and OpenAPI.",true),option("Python + FastAPI + PostgreSQL","A concise alternative for APIs with automation, data processing, or AI integrations."),option("Go + Chi + PostgreSQL","A small, fast alternative for concurrent services and low operational overhead."),option("ASP.NET Core + PostgreSQL","A strongly typed alternative for complex authorization and durable business services.")];}
 if(family==="desktop"){if(s.windows)return[option(".NET 8 + WPF + EF Core + SQLite","Best fit for a Windows-native application with OS integration, accessible controls, local persistence, packaging, and automated tests.",true),option("WinUI 3 + .NET 8 + SQLite","A modern Windows-native alternative for Fluent UI and current platform APIs."),option("Tauri + React + TypeScript + Rust + SQLite","A smaller cross-platform alternative with an explicit native security boundary.")];if(s.ai)return[option("Python + PySide6 + SQLite","Best fit for a local AI/data desktop tool with direct Python library access, native windows, persistence, and packaging.",true),option("Tauri + React + TypeScript + Rust + SQLite","A smaller packaged alternative with a secure native command boundary."),option("Electron + React + TypeScript + SQLite","A mature cross-platform alternative with the broadest desktop JavaScript ecosystem.")];return[option("Tauri + React + TypeScript + Rust + SQLite","Best balance of cross-platform UI, small installers, local persistence, filesystem access, and a constrained native boundary.",true),option("Electron + React + TypeScript + SQLite","The broadest ecosystem alternative when mature Node desktop libraries matter more than bundle size."),option(".NET 8 + Avalonia + SQLite","A strongly typed native alternative for cross-platform business applications."),option("Python + PySide6 + SQLite","A practical alternative for automation and data-centric desktop workflows.")];}
 if(family==="mobile"){if(s.android&&s.hardware)return[option("Kotlin + Jetpack Compose + Room + native vendor SDK","Best fit for an Android payment/scanning device because it preserves direct access to the licensed SDK, lifecycle, permissions, device services, offline persistence, and instrumentation tests without a cross-language bridge.",true),option("React Native + TypeScript + maintained native Android bridge","A viable alternative only when the native bridge is owned, versioned against the vendor SDK, and tested on the target device."),option("Flutter + Dart + Android platform channel","A cross-platform UI alternative that still requires a production-grade Kotlin platform channel and real-device validation.")];if(s.ios&&!s.android)return[option("Swift + SwiftUI + SwiftData","Best fit for an Apple-only product with native navigation, accessibility, persistence, testing, and platform APIs.",true),option("React Native + Expo + TypeScript","A cross-platform alternative if Android support is likely soon."),option("Flutter + Dart","A cross-platform alternative with consistent custom rendering.")];if(s.android&&!s.ios)return[option("Kotlin + Jetpack Compose + Room","Best fit for Android-only delivery with native lifecycle, persistence, background work, and platform integrations.",true),option("React Native + Expo + TypeScript","A cross-platform alternative if iOS support is likely soon."),option("Flutter + Dart","A cross-platform alternative with consistent custom rendering.")];return[option(`React Native + Expo + TypeScript${s.database?" + Expo SQLite/Supabase":""}`,`Best fit for shared iOS/Android delivery with native navigation, secure storage, device testing${s.offline?", offline persistence and sync boundaries":""}.`,true),option("Flutter + Dart + Drift","A cross-platform alternative with controlled rendering and strong offline persistence."),option("SwiftUI + Kotlin/Compose","The native two-codebase alternative when platform-specific polish outweighs shared implementation.")];}
 if(family==="cli"||family==="data"||family==="library"||family==="embedded")return platformFallbacks[family].map(item=>({...item}));
 if(s.browserGame)return[option("Phaser + TypeScript + Vite","Best fit for a browser game with fast iteration, web deployment, asset loading, input, scenes, and deterministic tests.",true),option("Godot","A visual-editor alternative that can also export to the web."),option("Unity","A larger alternative when future native or console delivery matters.")];if(s.threeD)return[option("Unity + C#","Best fit for a cross-platform 3D game with mature tooling, physics, assets, profiling, and deployment support.",true),option("Unreal Engine + C++/Blueprints","A high-end alternative for advanced rendering or console ambitions."),option("Godot + GDScript/C#","An open-source alternative for smaller 3D scope and a lighter editor.")];return[option("Godot + GDScript","Best fit for a focused 2D game with a fast editor loop, scenes, input, animation, export, and low tooling overhead.",true),option("Unity + C#","A mature alternative with a larger asset and platform ecosystem."),option("Phaser + TypeScript","A browser-first alternative for lightweight 2D delivery."),option("Bevy + Rust","A code-first alternative for data-oriented performance and engine control.")];}

function familyForExplicitStack(stack: string): ProjectPlatformFamily {
  if (/electron|tauri|wpf|winforms|pyside|pyqt|desktop/i.test(stack)) return "desktop";
  if (/\bmobile\b|react native|expo|flutter|swiftui|android|jetpack/i.test(stack)) return "mobile";
  if (/express|fastapi|asp\.net|spring|django|flask|backend|api/i.test(stack)) return "backend";
  if (/godot|unity|unreal|phaser|bevy|game/i.test(stack)) return "game";
  if (/commander|typer|cobra|clap|command[- ]line|\bcli\b/i.test(stack)) return "cli";
  if (/polars|pandas|duckdb|spark|dbt|data pipeline|etl/i.test(stack)) return "data";
  if (/embedded|platformio|zephyr|micropython|embedded-hal|firmware/i.test(stack)) return "embedded";
  if (/library|package|sdk|crate|module/i.test(stack)) return "library";
  if (/html|css|javascript|next|react|vite|vue|svelte|astro|web/i.test(stack)) return "web";
  return "unconstrained";
}

function proposedOptionFitsProject(option: StackOption, family: ProjectPlatformFamily, discovery: ProjectDiscoveryResult): boolean {
  const optionFamily = familyForExplicitStack(option.name);
  const signals = workloadSignals(discovery);
  const optionEvidence = `${option.name} ${option.why}`;
  const webCompatible = family === "web" && (optionFamily === "web" || /django|rails|laravel|asp\.net.*(?:react|web)|spring.*(?:react|web)/i.test(option.name));
  if (optionFamily !== "unconstrained" && optionFamily !== family && !webCompatible) return false;
  if (!signals.auth && /auth\.js|nextauth|devise|identity|clerk|auth0|cognito|firebase auth|supabase auth/i.test(option.name)) return false;
  if (!signals.database && /prisma|postgres|mysql|mongodb|sqlite|database/i.test(option.name)) return false;
  if (!signals.payments && /stripe|paypal|adyen|payment gateway/i.test(option.name)) return false;
  if (signals.auth && !/auth|identity|devise|django|clerk|auth0|cognito|firebase auth|supabase auth/i.test(optionEvidence)) return false;
  if (signals.database && !/prisma|postgres|mysql|mongodb|sqlite|database|persistence|django|rails|entity framework/i.test(optionEvidence)) return false;
  if (signals.payments && !/stripe|paypal|adyen|payment|checkout|billing/i.test(optionEvidence)) return false;
  return true;
}

function dynamicOptionsWithinPolicy(family: Exclude<ProjectPlatformFamily, "unconstrained">, discovery: ProjectDiscoveryResult, proposed: StackOption[]): StackOption[] {
  const signals = workloadSignals(discovery);
  const explicitlyStatic = family === "web" && /\b(?:simple static|static (?:site|website|portfolio)|no (?:server|backend|database))\b/i.test(`${discovery.prompt} ${discovery.projectType}`);
  const contaminatedRecommendation = (!signals.auth && /auth\.js|nextauth|devise|identity|clerk|auth0/i.test(discovery.recommendedStack))
    || (!signals.database && /prisma|postgres|mysql|mongodb|sqlite|database/i.test(discovery.recommendedStack));
  const accepted = explicitlyStatic || contaminatedRecommendation
    ? []
    : proposed.filter((item) => item.name.trim() && proposedOptionFitsProject(item, family, discovery));
  const fallback = capabilityAwareOptions(family, discovery);
  const proposedRecommended = accepted.find((item) => item.recommended)?.name;
  const primary = proposedRecommended ? accepted : fallback;
  const secondary = proposedRecommended ? fallback : accepted;
  const combined = [...primary, ...secondary.filter((candidate) => !primary.some((item) => item.name.toLowerCase() === candidate.name.toLowerCase()))].slice(0, 5);
  const recommendedName = proposedRecommended ?? combined[0]?.name;
  return combined.map((item) => ({ ...item, recommended: item.name === recommendedName }));
}

/** A selected starter is authoritative; custom briefs derive their family from the discovery memo. */
export function platformFamilyForProject(starterId: string, discovery?: ProjectDiscoveryResult): ProjectPlatformFamily {
  const known = starterPlatformFamilies[starterId];
  if (known) return known;
  // Freeform clients and persisted briefs may use a custom starter alias rather than the literal
  // "custom" id. If no authoritative known starter exists, the reviewed discovery memo is still
  // enough to enforce its platform contract.
  if (!discovery) return "unconstrained";
  const explicitStack = explicitStackFromPrompt(discovery.prompt);
  if (explicitStack) return familyForExplicitStack(explicitStack);
  const explicitPlatform = explicitPlatformFromPrompt(discovery.prompt);
  if (explicitPlatform) return familyForExplicitStack(explicitPlatform);
  const evidence = discoveryPlatformEvidence(discovery);
  if (/\bdesktop|windows native|macos native|linux desktop|wpf|winforms|electron|tauri\b/.test(evidence)) return "desktop";
  if (/\bmobile|ios|android|iphone|ipad|react native|flutter\b/.test(evidence)) return "mobile";
  if (/\bcli\b|command-line|terminal tool|developer command\b/.test(evidence)) return "cli";
  if (/\bdata pipeline|etl|analytics pipeline|data processing|batch processing\b/.test(evidence)) return "data";
  if (/\bfirmware|microcontroller|embedded|arduino|esp32|raspberry pi pico|rtos\b/.test(evidence)) return "embedded";
  if (/\blibrary|package|reusable sdk|npm package|python package|crate\b/.test(evidence)) return "library";
  if (/\bapi|backend|microservice|webhook service|server-only\b/.test(evidence)) return "backend";
  if (/\bgame|gameplay|game engine|level editor\b/.test(evidence)) return "game";
  if (/\bweb|website|browser|saas|storefront|dashboard\b/.test(evidence)) return "web";
  return "unconstrained";
}

export function platformStackOptionsForProject(starterId: string, discovery?: ProjectDiscoveryResult): StackOption[] {
  const family = platformFamilyForProject(starterId, discovery);
  return family === "unconstrained" ? [] : (discovery?capabilityAwareOptions(family,discovery):platformFallbacks[family]).map((option) => ({ ...option }));
}

/**
 * Model reasoning chooses among valid technologies; this boundary prevents an incomplete or
 * contradictory response from changing the selected product's platform.
 */
export function reconcilePlatformStackOptions(
  starterId: string,
  discovery: ProjectDiscoveryResult,
  proposed: StackOption[],
): { stackOptions: StackOption[]; recommendedStack: string; repaired: boolean; family: ProjectPlatformFamily } {
  const family = platformFamilyForProject(starterId, discovery);
  const explicitStack = starterId === "custom" ? explicitStackFromPrompt(discovery.prompt) : undefined;
  if (explicitStack) {
    const alternatives = family === "unconstrained" ? proposed : capabilityAwareOptions(family,discovery);
    const options: StackOption[] = [
      { name: explicitStack, why: "The user explicitly selected this stack in the project brief.", recommended: true },
      ...alternatives
        .filter((option) => option.name.toLowerCase() !== explicitStack.toLowerCase())
        .slice(0, 4)
        .map((option) => ({ ...option, recommended: false })),
    ];
    return { stackOptions: options, recommendedStack: explicitStack, repaired: discovery.recommendedStack !== explicitStack || proposed[0]?.name !== explicitStack, family };
  }
  if (family === "unconstrained") {
    const recommendedIndex = Math.max(0, proposed.findIndex((item) => item.recommended));
    const options = proposed.map((option, index) => ({ ...option, recommended: index === recommendedIndex }));
    return { stackOptions: options, recommendedStack: options.find((option) => option.recommended)?.name || discovery.recommendedStack, repaired: false, family };
  }
  const complete = dynamicOptionsWithinPolicy(family,discovery,proposed);
  const previousRecommendation=proposed.find(option=>option.recommended)?.name||discovery.recommendedStack;
  return { stackOptions: complete, recommendedStack: complete[0].name, repaired: previousRecommendation!==complete[0].name||proposed.length!==complete.length, family };
}
