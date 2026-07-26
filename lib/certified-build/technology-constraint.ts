export type TechnologyConstraint =
  | { kind: "certified"; stackId: string; technology: string }
  | { kind: "unsupported"; technology: string };

const CERTIFIED: Array<[RegExp, string, string]> = [
  [/\b(?:plain|static|vanilla)\s+html\b|\bhtml\s*(?:\+|\/|,|and)\s*css\b/i, "static-web-vite", "Static HTML + CSS + JavaScript"],
  [/\bnext\.?js\b/i, "nextjs-typescript-postgres", "Next.js"],
  [/\breact\b[^.\n]{0,40}\bvite\b|\bvite\b[^.\n]{0,40}\breact\b/i, "react-vite-typescript", "React + Vite"],
  [/\bnode\.?js\b|\bexpress\b/i, "node-typescript-api", "Node.js"],
  [/\bfastapi\b/i, "python-fastapi", "FastAPI"],
  [/\basp\.?net\s+core\b|\b\.net\s+(?:web\s+)?api\b/i, "dotnet-web-api", "ASP.NET Core"],
  [/\bwpf\b|(?:^|[^\w])(?:\.net|dotnet)(?:\s+framework)?\b[^.\n]{0,70}\b(?:desktop|register|windows app)/i, "wpf-dotnet", ".NET WPF"],
  [/\bjetpack\s+compose\b|\bkotlin\b[^.\n]{0,40}\bandroid\b|\bandroid\b[^.\n]{0,40}\bkotlin\b/i, "android-kotlin-compose", "Kotlin + Jetpack Compose"],
  [/\bswiftui\b|\bswift\b[^.\n]{0,40}\b(?:ios|iphone|ipad)\b/i, "ios-swiftui", "SwiftUI"],
  [/\bflutter\b/i, "flutter-mobile", "Flutter"],
  [/\belectron\b/i, "electron-typescript", "Electron"],
  [/\btauri\b/i, "tauri-rust", "Tauri"],
  [/\bphaser\b/i, "phaser-typescript", "Phaser"],
  [/\bgodot\b/i, "godot", "Godot"],
  [/\bunity\b/i, "unity", "Unity"],
];

const UNSUPPORTED: Array<[RegExp, string]> = [
  [/\bunreal(?:\s+engine)?\b/i, "Unreal Engine"],
  [/\bwinforms?\b/i, "WinForms"],
  [/\bqt\b[^.\n]{0,30}\bc\+\+|\bc\+\+\b[^.\n]{0,30}\bqt\b/i, "Qt/C++"],
  [/\breact\s+native\b|\bexpo\b/i, "React Native / Expo"],
  [/\bvue(?:\.?js)?\b|\bnuxt(?:\.?js)?\b/i, "Vue / Nuxt"],
  [/\bsvelte(?:kit)?\b/i, "Svelte / SvelteKit"],
  [/\bastro\b/i, "Astro"],
  [/\bdjango\b/i, "Django"],
  [/\bruby\s+on\s+rails\b|\brails\b/i, "Ruby on Rails"],
  [/\blaravel\b/i, "Laravel"],
];

export function technologyConstraintFromPrompt(prompt: string): TechnologyConstraint | null {
  const certified = CERTIFIED.find(([pattern]) => pattern.test(prompt));
  if (certified) return { kind: "certified", stackId: certified[1], technology: certified[2] };
  const unsupported = UNSUPPORTED.find(([pattern]) => pattern.test(prompt));
  return unsupported ? { kind: "unsupported", technology: unsupported[1] } : null;
}
