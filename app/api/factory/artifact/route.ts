import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { safeProjectPath } from "@/lib/factory/runtime";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const relativePath = url.searchParams.get("path") ?? "";
    if (!projectId || !relativePath) return NextResponse.json({ error: "Project id and artifact path are required." }, { status: 400 });

    const projectPath = safeProjectPath(projectId);
    const artifactPath = path.resolve(projectPath, relativePath);
    const relative = path.relative(projectPath, artifactPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return NextResponse.json({ error: "Artifact path is outside the project." }, { status: 400 });
    }

    const artifactStat = await stat(artifactPath);
    if (!artifactStat.isFile()) return NextResponse.json({ error: "Artifact is not a file." }, { status: 404 });
    const file = await readFile(artifactPath);
    const filename = path.basename(artifactPath).replace(/["\r\n]/g, "_");
    return new NextResponse(file, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(file.length),
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Artifact is unavailable." }, { status: 404 });
  }
}
