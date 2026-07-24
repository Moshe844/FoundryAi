import type { EnvironmentCapabilities, StackManifest } from "./types";

export function defaultEnvironmentCapabilities(): EnvironmentCapabilities {
  const os = typeof process === "undefined" ? "unknown" : process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform === "linux" ? "linux" : "unknown";
  const configured = (typeof process === "undefined" ? "" : process.env.FOUNDRY_AVAILABLE_TOOLCHAINS ?? "node,npm").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return { os, availableToolchains: configured, unavailableToolchains: [], remoteMacBuilder: typeof process !== "undefined" && process.env.FOUNDRY_REMOTE_MAC_BUILDER === "true" };
}

export function environmentReadiness(manifest: StackManifest, environment: EnvironmentCapabilities) {
  const missing = manifest.toolchain.required.filter((item) => !environment.availableToolchains.includes(item.toLowerCase()));
  if (manifest.supportedPlatforms.includes("ios") && environment.os !== "macos" && !environment.remoteMacBuilder) missing.push("macOS/Xcode build environment");
  return { ready: missing.length === 0, missing: [...new Set(missing)], score: missing.length ? Math.max(0, 1 - missing.length * 0.25) : 1 };
}
