import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { safeProjectPath } from "@/lib/factory/runtime";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    if (!projectId) return NextResponse.json({ error: "Project id is required." }, { status: 400 });

    const projectPath = safeProjectPath(projectId);
    const zipPath = path.join(os.tmpdir(), `${projectId}-${Date.now()}.zip`);
    await compressProject(projectPath, zipPath);
    const file = await readFile(zipPath);

    return new NextResponse(file, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${projectId}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not export project.",
      },
      { status: 500 },
    );
  }
}

function compressProject(projectPath: string, zipPath: string) {
  return new Promise<void>((resolve, reject) => {
    const command = [
      "$ErrorActionPreference='Stop'",
      `if (Test-Path -LiteralPath '${escapePowerShell(zipPath)}') { Remove-Item -LiteralPath '${escapePowerShell(zipPath)}' -Force }`,
      `$items = Get-ChildItem -LiteralPath '${escapePowerShell(projectPath)}' -Force | Where-Object { $_.Name -notin @('node_modules','.next','dist') }`,
      `Compress-Archive -Path $items.FullName -DestinationPath '${escapePowerShell(zipPath)}' -Force`,
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0 && existsSync(zipPath)) resolve();
      else reject(new Error(stderr || "PowerShell Compress-Archive failed."));
    });
  });
}

function escapePowerShell(value: string) {
  return value.replace(/'/g, "''");
}
