export type ToolchainId =
  | "node" | "python" | "php" | "java" | "android" | "flutter" | "dotnet"
  | "go" | "rust" | "docker" | "terraform" | "kubernetes" | "godot" | "unity";

export type ToolchainDefinition = {
  id: ToolchainId;
  label: string;
  executable: string;
  purpose: string;
  windows: { winget?: string; chocolatey?: string };
  macos?: { brew: string; cask?: boolean };
  postInstall?: string;
};

export const TOOLCHAINS: Record<ToolchainId, ToolchainDefinition> = {
  node: { id: "node", label: "Node.js LTS", executable: "node", purpose: "build and run JavaScript/TypeScript projects", windows: { winget: "OpenJS.NodeJS.LTS", chocolatey: "nodejs-lts" }, macos: { brew: "node" } },
  python: { id: "python", label: "Python", executable: "python", purpose: "build, run, and test Python projects", windows: { winget: "Python.Python.3.13", chocolatey: "python" }, macos: { brew: "python" } },
  php: { id: "php", label: "PHP", executable: "php", purpose: "run and verify PHP projects", windows: { winget: "PHP.PHP", chocolatey: "php" }, macos: { brew: "php" } },
  java: { id: "java", label: "Java JDK", executable: "java", purpose: "compile, run, and test Java projects", windows: { winget: "EclipseAdoptium.Temurin.21.JDK", chocolatey: "temurin21" }, macos: { brew: "openjdk@21" } },
  android: { id: "android", label: "Android Studio and SDK", executable: "adb", purpose: "build, launch, and test Android applications", windows: { winget: "Google.AndroidStudio", chocolatey: "androidstudio" }, macos: { brew: "android-studio", cask: true }, postInstall: "Android Studio may open once to finish downloading the selected Android SDK and accept its license." },
  flutter: { id: "flutter", label: "Flutter SDK", executable: "flutter", purpose: "build, run, and test Flutter applications", windows: { winget: "Google.Flutter", chocolatey: "flutter" }, macos: { brew: "flutter", cask: true }, postInstall: "Foundry will run Flutter's own diagnostics after installation and clearly show any remaining device or platform component." },
  dotnet: { id: "dotnet", label: ".NET SDK", executable: "dotnet", purpose: "build, run, and test .NET projects", windows: { winget: "Microsoft.DotNet.SDK.9", chocolatey: "dotnet-sdk" }, macos: { brew: "dotnet", cask: true } },
  go: { id: "go", label: "Go", executable: "go", purpose: "build, run, and test Go projects", windows: { winget: "GoLang.Go", chocolatey: "golang" }, macos: { brew: "go" } },
  rust: { id: "rust", label: "Rust toolchain", executable: "cargo", purpose: "build, run, and test Rust and Tauri projects", windows: { winget: "Rustlang.Rustup", chocolatey: "rustup.install" }, macos: { brew: "rustup-init" } },
  docker: { id: "docker", label: "Docker Desktop", executable: "docker", purpose: "build and run containers", windows: { winget: "Docker.DockerDesktop", chocolatey: "docker-desktop" }, macos: { brew: "docker", cask: true }, postInstall: "Docker Desktop must be launched once. Windows may request a restart if its virtualization components were not already enabled." },
  terraform: { id: "terraform", label: "Terraform CLI", executable: "terraform", purpose: "format and validate Terraform infrastructure", windows: { winget: "Hashicorp.Terraform", chocolatey: "terraform" }, macos: { brew: "terraform" } },
  kubernetes: { id: "kubernetes", label: "Kubernetes CLI", executable: "kubectl", purpose: "validate and manage Kubernetes resources", windows: { winget: "Kubernetes.kubectl", chocolatey: "kubernetes-cli" }, macos: { brew: "kubectl" } },
  godot: { id: "godot", label: "Godot Engine", executable: "godot", purpose: "open, run, and validate Godot projects", windows: { winget: "GodotEngine.GodotEngine", chocolatey: "godot" }, macos: { brew: "godot", cask: true } },
  unity: { id: "unity", label: "Unity Hub", executable: "Unity Hub", purpose: "install and launch the Unity Editor required by Unity projects", windows: { winget: "Unity.UnityHub", chocolatey: "unity-hub" }, macos: { brew: "unity-hub", cask: true }, postInstall: "Unity Hub will ask you to sign in and select an Editor version because Unity licensing and project-version compatibility require your account choice." },
};

const STACK_TOOLCHAINS: Record<string, ToolchainId[]> = {
  nextjs: ["node"], node: ["node"], "node-express": ["node"], react: ["node"], vue: ["node"], angular: ["node"], electron: ["node"], "react-native": ["node"],
  python: ["python"], php: ["php"], java: ["java"], android: ["java", "android"], flutter: ["flutter"], "dotnet-web": ["dotnet"], "dotnet-desktop": ["dotnet"],
  go: ["go"], rust: ["rust"], tauri: ["rust"], docker: ["docker"], terraform: ["terraform"], kubernetes: ["kubernetes"], godot: ["godot"], unity: ["unity"],
};

export function toolchainsForStack(stackId: string) {
  return (STACK_TOOLCHAINS[stackId] ?? []).map((id) => TOOLCHAINS[id]);
}

export function toolchainById(value: string) {
  return TOOLCHAINS[value as ToolchainId];
}
