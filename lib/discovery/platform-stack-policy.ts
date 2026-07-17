import type { ProjectDiscoveryResult } from "@/lib/ai/project-discovery";
import type { StackOption } from "@/lib/ai/project-discovery-llm";

export type ProjectPlatformFamily = "web" | "desktop" | "mobile" | "backend" | "game" | "unconstrained";

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
};

function discoveryPlatformEvidence(discovery: ProjectDiscoveryResult) {
  const platform = discovery.decisions.find((decision) => decision.dimension === "platform")?.hypothesis ?? "";
  return `${discovery.projectType} ${platform} ${discovery.architecture}`.toLowerCase();
}

/** A selected starter is authoritative; custom briefs derive their family from the discovery memo. */
export function platformFamilyForProject(starterId: string, discovery?: ProjectDiscoveryResult): ProjectPlatformFamily {
  const known = starterPlatformFamilies[starterId];
  if (known) return known;
  if (starterId !== "custom" || !discovery) return "unconstrained";
  const evidence = discoveryPlatformEvidence(discovery);
  if (/\bdesktop|windows native|macos native|linux desktop|wpf|winforms|electron|tauri\b/.test(evidence)) return "desktop";
  if (/\bmobile|ios|android|iphone|ipad|react native|flutter\b/.test(evidence)) return "mobile";
  if (/\bapi|backend|microservice|webhook service|server-only\b/.test(evidence)) return "backend";
  if (/\bgame|gameplay|game engine|level editor\b/.test(evidence)) return "game";
  if (/\bweb|website|browser|saas|storefront|dashboard\b/.test(evidence)) return "web";
  return "unconstrained";
}

function stackMatchesPlatform(stack: string, family: Exclude<ProjectPlatformFamily, "unconstrained">) {
  const name = stack.toLowerCase();
  if (family === "web") return /next|nuxt|sveltekit|astro|remix|react|vite|vue|angular|html|css|javascript|typescript/.test(name);
  if (family === "desktop") return /electron|tauri|wpf|winforms|avalonia|maui|pyside|pyqt|\bqt\b|swiftui|appkit|compose desktop|javafx|flutter|gtk/.test(name);
  if (family === "mobile") return /react native|expo|flutter|swiftui|\bios\b|kotlin|android|jetpack compose|maui/.test(name);
  if (family === "backend") return /express|fastapi|asp\.net|spring|\bgo\b|chi|gin|fiber|django|flask|rails|nestjs|hono|axum/.test(name);
  return /godot|unity|unreal|phaser|bevy|monogame|pygame|game maker|gamemaker/.test(name);
}

export function platformStackOptionsForProject(starterId: string, discovery?: ProjectDiscoveryResult): StackOption[] {
  const family = platformFamilyForProject(starterId, discovery);
  return family === "unconstrained" ? [] : platformFallbacks[family].map((option) => ({ ...option }));
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
  if (family === "unconstrained") {
    const recommendedIndex = Math.max(0, proposed.findIndex((item) => item.recommended));
    const options = proposed.map((option, index) => ({ ...option, recommended: index === recommendedIndex }));
    return { stackOptions: options, recommendedStack: options.find((option) => option.recommended)?.name || discovery.recommendedStack, repaired: false, family };
  }

  const compatible = proposed.filter((option) => stackMatchesPlatform(option.name, family));
  const compatibleRecommendation = compatible.find((option) => option.recommended);
  if (compatible.length >= 2 && compatibleRecommendation) {
    return {
      stackOptions: compatible.map((option) => ({ ...option, recommended: option === compatibleRecommendation })),
      recommendedStack: compatibleRecommendation.name,
      repaired: compatible.length !== proposed.length,
      family,
    };
  }

  const fallback = platformFallbacks[family].map((option) => ({ ...option }));
  return { stackOptions: fallback, recommendedStack: fallback[0].name, repaired: true, family };
}
