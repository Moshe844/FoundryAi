import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const NODE_MISSING_MESSAGE = "Node.js is required to run the Foundry Local Agent. Download it from https://nodejs.org/ and run this file again.";
type AgentScripts = { connector: string; validation: string; staticPreview: string; windowsDesktopUi: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = (url.searchParams.get("platform") || "windows").toLowerCase();

  let scripts: AgentScripts;
  try {
    const [connector, validation, staticPreview, windowsDesktopUi] = await Promise.all([
      readFile(path.join(process.cwd(), "scripts", "foundry-local-connector.cjs"), "utf8"),
      readFile(path.join(process.cwd(), "scripts", "local-agent-validation.cjs"), "utf8"),
      readFile(path.join(process.cwd(), "scripts", "foundry-static-preview.cjs"), "utf8"),
      readFile(path.join(process.cwd(), "scripts", "validate-windows-desktop-ui.ps1"), "utf8"),
    ]);
    scripts = { connector, validation, staticPreview, windowsDesktopUi };
  } catch {
    return NextResponse.json({ error: "The complete local agent runtime is not available on this server." }, { status: 500 });
  }

  if (platform === "mac") {
    return new Response(buildMacLauncher(scripts), {
      headers: {
        "Content-Type": "text/x-sh; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"foundry-local-agent.command\"",
      },
    });
  }

  if (platform === "linux") {
    return new Response(buildLinuxLauncher(scripts), {
      headers: {
        "Content-Type": "text/x-sh; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"foundry-local-agent.sh\"",
      },
    });
  }

  return new Response(buildWindowsLauncher(scripts), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"foundry-local-agent.bat\"",
    },
  });
}

function windowsBase64FileLines(fileName: string, content: string, suffix: string) {
  const chunks = Buffer.from(content, "utf8").toString("base64").match(/.{1,700}/g) ?? [];
  const temporaryVariable = `FOUNDRY_${suffix}_B64`;
  return [
    `set "${temporaryVariable}=%TEMP%\\foundry-${suffix.toLowerCase()}-%RANDOM%.b64"`,
    ...chunks.map((chunk, index) => `${index === 0 ? ">" : ">>"} "%${temporaryVariable}%" echo ${chunk}`),
    `certutil -f -decode "%${temporaryVariable}%" "%INSTALL_DIR%\\${fileName}" >nul 2>nul`,
    "if errorlevel 1 (",
    `  echo Could not install ${fileName}.`,
    "  pause",
    "  exit /b 1",
    ")",
    `del /q "%${temporaryVariable}%" >nul 2>nul`,
  ];
}

function buildWindowsLauncher(scripts: AgentScripts) {
  const header = [
    "@echo off",
    "setlocal",
    "where node >nul 2>nul",
    "if errorlevel 1 (",
    "  echo.",
    `  echo ${NODE_MISSING_MESSAGE}`,
    "  echo.",
    "  pause",
    "  exit /b 1",
    ")",
    "set \"NODEEXE=\"",
    "for /f \"delims=\" %%i in ('where node') do (",
    "  if not defined NODEEXE set \"NODEEXE=%%i\"",
    ")",
    "set \"INSTALL_DIR=%LOCALAPPDATA%\\FoundryLocalAgent\"",
    "if not exist \"%INSTALL_DIR%\" mkdir \"%INSTALL_DIR%\" >nul 2>nul",
    "set \"SCRIPT=%INSTALL_DIR%\\foundry-local-connector.cjs\"",
    "more +__HEADER_LINES__ \"%~f0\" > \"%SCRIPT%\"",
    ...windowsBase64FileLines("local-agent-validation.cjs", scripts.validation, "VALIDATION"),
    ...windowsBase64FileLines("foundry-static-preview.cjs", scripts.staticPreview, "PREVIEW"),
    ...windowsBase64FileLines("validate-windows-desktop-ui.ps1", scripts.windowsDesktopUi, "DESKTOP_UI"),
    "echo Installing Foundry Local Agent to %INSTALL_DIR% ...",
    "set \"LAUNCH_VBS=%INSTALL_DIR%\\launch-agent.vbs\"",
    "> \"%LAUNCH_VBS%\" echo Set objShell = CreateObject(\"WScript.Shell\")",
    ">> \"%LAUNCH_VBS%\" echo objShell.Run Chr(34) ^& \"%NODEEXE%\" ^& Chr(34) ^& \" \" ^& Chr(34) ^& \"%SCRIPT%\" ^& Chr(34), 0, False",
    "set \"STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\"",
    "copy /y \"%LAUNCH_VBS%\" \"%STARTUP_DIR%\\FoundryLocalAgent.vbs\" >nul 2>nul",
    "if errorlevel 1 (",
    "  echo Could not register auto-start on this computer. You will need to re-run this file after restarting.",
    ") else (",
    "  echo Registered to start automatically whenever you log in to this computer.",
    ")",
    "echo Starting Foundry Local Agent now...",
    "wscript.exe \"%LAUNCH_VBS%\"",
    "ping -n 3 127.0.0.1 >nul",
    "echo.",
    "echo Foundry Local Agent is running in the background. You can close this window.",
    "echo It will keep running silently and restart automatically next time you log in.",
    "pause",
    "exit /b 0",
  ];
  const headerWithLineCount = header.map((line) => line.replace("__HEADER_LINES__", String(header.length)));
  return `${headerWithLineCount.join("\r\n")}\r\n${scripts.connector}`;
}

function buildMacLauncher(scripts: AgentScripts) {
  const lines = [
    "#!/usr/bin/env bash",
    "if ! command -v node >/dev/null 2>&1; then",
    "  echo",
    `  echo "${NODE_MISSING_MESSAGE}"`,
    "  echo",
    "  read -p \"Press Enter to close...\"",
    "  exit 1",
    "fi",
    "NODE_PATH=\"$(command -v node)\"",
    "INSTALL_DIR=\"$HOME/Library/Application Support/FoundryLocalAgent\"",
    "mkdir -p \"$INSTALL_DIR\"",
    "SCRIPT=\"$INSTALL_DIR/foundry-local-connector.cjs\"",
    "cat > \"$SCRIPT\" <<'FOUNDRY_AGENT_SCRIPT_EOF'",
    scripts.connector,
    "FOUNDRY_AGENT_SCRIPT_EOF",
    "cat > \"$INSTALL_DIR/local-agent-validation.cjs\" <<'FOUNDRY_AGENT_VALIDATION_EOF'",
    scripts.validation,
    "FOUNDRY_AGENT_VALIDATION_EOF",
    "cat > \"$INSTALL_DIR/foundry-static-preview.cjs\" <<'FOUNDRY_AGENT_PREVIEW_EOF'",
    scripts.staticPreview,
    "FOUNDRY_AGENT_PREVIEW_EOF",
    "PLIST_DIR=\"$HOME/Library/LaunchAgents\"",
    "mkdir -p \"$PLIST_DIR\"",
    "PLIST=\"$PLIST_DIR/com.foundry.localagent.plist\"",
    "cat > \"$PLIST\" <<PLIST_EOF",
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key><string>com.foundry.localagent</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>$NODE_PATH</string>",
    "    <string>$SCRIPT</string>",
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key><false/>",
    "  <key>StandardOutPath</key><string>$INSTALL_DIR/agent.log</string>",
    "  <key>StandardErrorPath</key><string>$INSTALL_DIR/agent.log</string>",
    "</dict>",
    "</plist>",
    "PLIST_EOF",
    "echo \"Installing Foundry Local Agent to $INSTALL_DIR ...\"",
    "launchctl unload \"$PLIST\" >/dev/null 2>&1",
    "launchctl load \"$PLIST\" >/dev/null 2>&1",
    "echo \"Registered to start automatically whenever you log in to this Mac.\"",
    "echo \"Foundry Local Agent is now running in the background.\"",
    "read -p \"Press Enter to close...\"",
  ];
  return lines.join("\n");
}

function buildLinuxLauncher(scripts: AgentScripts) {
  const lines = [
    "#!/usr/bin/env bash",
    "if ! command -v node >/dev/null 2>&1; then",
    "  echo",
    `  echo "${NODE_MISSING_MESSAGE}"`,
    "  echo",
    "  read -p \"Press Enter to close...\"",
    "  exit 1",
    "fi",
    "NODE_PATH=\"$(command -v node)\"",
    "INSTALL_DIR=\"$HOME/.local/share/foundry-local-agent\"",
    "mkdir -p \"$INSTALL_DIR\"",
    "SCRIPT=\"$INSTALL_DIR/foundry-local-connector.cjs\"",
    "cat > \"$SCRIPT\" <<'FOUNDRY_AGENT_SCRIPT_EOF'",
    scripts.connector,
    "FOUNDRY_AGENT_SCRIPT_EOF",
    "cat > \"$INSTALL_DIR/local-agent-validation.cjs\" <<'FOUNDRY_AGENT_VALIDATION_EOF'",
    scripts.validation,
    "FOUNDRY_AGENT_VALIDATION_EOF",
    "cat > \"$INSTALL_DIR/foundry-static-preview.cjs\" <<'FOUNDRY_AGENT_PREVIEW_EOF'",
    scripts.staticPreview,
    "FOUNDRY_AGENT_PREVIEW_EOF",
    "AUTOSTART_DIR=\"$HOME/.config/autostart\"",
    "mkdir -p \"$AUTOSTART_DIR\"",
    "cat > \"$AUTOSTART_DIR/foundry-local-agent.desktop\" <<DESKTOP_EOF",
    "[Desktop Entry]",
    "Type=Application",
    "Name=Foundry Local Agent",
    "Exec=$NODE_PATH \"$SCRIPT\"",
    "X-GNOME-Autostart-enabled=true",
    "NoDisplay=true",
    "DESKTOP_EOF",
    "echo \"Installed to $INSTALL_DIR and registered to start automatically at your next graphical login.\"",
    "echo \"Starting it now...\"",
    "nohup \"$NODE_PATH\" \"$SCRIPT\" >\"$INSTALL_DIR/agent.log\" 2>&1 &",
    "disown",
    "echo \"Foundry Local Agent is running in the background.\"",
    "read -p \"Press Enter to close...\"",
  ];
  return lines.join("\n");
}
