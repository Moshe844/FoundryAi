import { NextResponse } from "next/server";
import { materializeUploadedProjectForPreview } from "@/lib/factory/runtime";
import type { FactoryUploadedFile } from "@/lib/factory/types";

type UploadIntakeRequest = {
  projectName?: string;
  files?: FactoryUploadedFile[];
};

/**
 * Creates the Foundry workspace copy for a browser-uploaded project and starts its preview, at the
 * moment the folder is picked. Opening an existing project is itself a preview trigger; running a
 * mission must not be a hidden prerequisite for seeing the project you just opened.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as UploadIntakeRequest | null;
  const files = body?.files ?? [];
  if (!files.length) {
    return NextResponse.json({ error: "No uploaded project files were provided." }, { status: 400 });
  }
  try {
    const result = await materializeUploadedProjectForPreview(files, body?.projectName?.trim() || "Existing Project");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      previewState: "error",
      previewPlatform: "web",
      previewReason: error instanceof Error ? error.message : "The uploaded project could not be prepared for preview.",
    });
  }
}
