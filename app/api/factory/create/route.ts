import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { beginPreviewRefreshForProject, createFactoryProject, getPreviewStatus } from "@/lib/factory/runtime";
import { completeExecution, failExecution, recordExecutionEvent, registerExecution } from "@/lib/factory/execution-control";
import type { FactoryCreateRequest, FactoryExecutionEvent, FactoryProjectResult } from "@/lib/factory/types";
import { stackManifest } from "@/lib/certified-build";

const activeCreationRequests = new Set<string>();
const FIRST_SOURCE_OUTPUT_DEADLINE_MS = Math.max(45_000, Math.min(180_000, Number(process.env.FOUNDRY_FIRST_SOURCE_OUTPUT_DEADLINE_MS) || 120_000));

function creationRequestFingerprint(body: Partial<FactoryCreateRequest>) {
  return createHash("sha256").update(JSON.stringify({
    brief: body.brief?.trim() ?? "",
    discovery: body.discovery ?? null,
    modelMode: body.modelMode ?? null,
    quality: body.quality ?? null,
    attachments: (body.evidenceAttachments ?? []).map((attachment) => ({
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      uploadStatus: attachment.uploadStatus,
      bytes: attachment.dataUrl?.length ?? attachment.rawText?.length ?? 0,
    })),
  })).digest("hex");
}

function changedPathsFromEvent(event: FactoryExecutionEvent) {
  const raw = event.details?.changedFiles;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  if (typeof raw === "string") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  return [];
}

function hasPassingProductionBuild(result: FactoryProjectResult) {
  return (result.commands ?? []).some((command) => command.exitCode === 0 && /(?:^|\s)(?:npm(?:\.cmd)?\s+run\s+build|next\s+build|build)(?:\s|$)/i.test(command.command));
}

function hasRunnableRootFile(result: FactoryProjectResult) {
  return (result.files ?? []).some((file) => /^(?:src\/)?app\/page\.[cm]?[jt]sx?$|^pages\/index\.[cm]?[jt]sx?$|^index\.html$/i.test(file.path.replace(/\\/g, "/")));
}

async function recoverFalseRoot404(result: FactoryProjectResult, emit: (event: FactoryExecutionEvent) => void) {
  const reported = `${result.previewReason ?? ""}\n${result.blocker ?? ""}`;
  if (!/application root returned HTTP 404|no runnable product route exists/i.test(reported)) return result;
  if (!hasPassingProductionBuild(result) || !hasRunnableRootFile(result)) return result;

  emit({
    id: "preview-root-recovery",
    timestamp: new Date().toISOString(),
    kind: "preview",
    status: "running",
    title: "The build passed and a root route exists — restarting the preview from the verified project",
    transient: true,
    details: { paidModelCalls: 0, recovery: "verified-root-preview-restart", projectPath: result.projectPath, transientKey: "preview-root-recovery" },
  });

  try {
    beginPreviewRefreshForProject(result.projectId);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      const preview = await getPreviewStatus(result.projectId);
      if (preview.previewState === "ready" && preview.previewUrl) {
        const recovered: FactoryProjectResult = {
          ...result,
          previewState: preview.previewState,
          previewUrl: preview.previewUrl,
          previewReason: undefined,
          blocker: /application root returned HTTP 404|no runnable product route exists/i.test(result.blocker ?? "") ? undefined : result.blocker,
        };
        emit({
          id: "preview-root-recovery",
          timestamp: new Date().toISOString(),
          kind: "preview",
          status: "completed",
          title: "Preview restarted from the verified project root",
          details: { paidModelCalls: 0, previewUrl: preview.previewUrl, attempt },
        });
        return recovered;
      }
      if (preview.previewState === "unavailable") break;
    }
  } catch (error) {
    emit({
      id: "preview-root-recovery",
      timestamp: new Date().toISOString(),
      kind: "preview",
      status: "warning",
      title: "Preview restart did not become ready",
      details: { paidModelCalls: 0, reason: error instanceof Error ? error.message : String(error) },
    });
  }
  return result;
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const body = (await request.json()) as Partial<FactoryCreateRequest>;
    if (!body.brief?.trim()) {
      return NextResponse.json({ error: "Project brief is required." }, { status: 400 });
    }
    const certifiedStackId = body.brief.match(/^Certified stack id:\s*(.+)$/im)?.[1]?.trim();
    if (certifiedStackId === "none") {
      return NextResponse.json({
        error: "Foundry did not find a Level 4 certified stack that can deliver this project in the current environment. Review the architecture limitation or configure the required build environment before starting execution.",
        code: "NO_ELIGIBLE_CERTIFIED_STACK",
      }, { status: 409 });
    }
    if (certifiedStackId) {
      const manifest = stackManifest(certifiedStackId);
      if (!manifest || manifest.supportLevel !== 4 || manifest.status !== "certified") {
        return NextResponse.json({ error: "The selected stack does not have a current Level 4 Foundry certification manifest.", code: "STACK_NOT_CERTIFIED" }, { status: 409 });
      }
    }
    const architectureLine = body.brief.match(/^Project architecture:\s*(.+)$/im)?.[1]?.trim();
    if (architectureLine) {
      try {
        const architecture = JSON.parse(architectureLine) as { applications?: Array<{ stackId?: string }> };
        const unsupported = (architecture.applications ?? []).map((application) => application.stackId ?? "").filter((stackId) => { const manifest = stackManifest(stackId); return !manifest || manifest.supportLevel !== 4 || manifest.status !== "certified"; });
        if (unsupported.length) return NextResponse.json({ error: `The composite project includes stacks without a current Level 4 implementation: ${unsupported.join(", ")}.`, code: "COMPOSITE_STACK_NOT_CERTIFIED" }, { status: 409 });
      } catch {
        return NextResponse.json({ error: "The certified project architecture is malformed.", code: "INVALID_PROJECT_ARCHITECTURE" }, { status: 400 });
      }
    }

    const requestFingerprint = creationRequestFingerprint(body);
    if (activeCreationRequests.has(requestFingerprint)) {
      return NextResponse.json({
        error: "This exact project build is already running. Foundry did not start or bill a duplicate execution.",
        code: "DUPLICATE_BUILD_IN_PROGRESS",
      }, { status: 409, headers: { "Retry-After": "5" } });
    }
    activeCreationRequests.add(requestFingerprint);

    if (url.searchParams.get("stream") === "1") {
      const encoder = new TextEncoder();
      const runtimeController = new AbortController();
      const unregisterExecution = registerExecution(body.controlId, runtimeController);
      let disconnected = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let firstOutputDeadline: ReturnType<typeof setTimeout> | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const sentEvents = new Set<string>();
          const observedProjectFiles = new Set<string>();
          const startedAt = Date.now();
          let firstSourceOutputObserved = false;
          const send = (payload: unknown) => {
            if (!disconnected) controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };
          const emit = (event: FactoryExecutionEvent) => {
            recordExecutionEvent(body.controlId, event);
            send({ type: "event", event });
          };
          const markSourceOutput = () => {
            if (firstSourceOutputObserved) return;
            firstSourceOutputObserved = true;
            if (firstOutputDeadline) clearTimeout(firstOutputDeadline);
          };

          firstOutputDeadline = setTimeout(() => {
            if (firstSourceOutputObserved || runtimeController.signal.aborted) return;
            emit({
              id: "first-source-output-deadline",
              timestamp: new Date().toISOString(),
              kind: "blocked",
              status: "error",
              title: "Foundry stopped additional model attempts because no application file was created in time",
              details: {
                elapsedMs: Date.now() - startedAt,
                deadlineMs: FIRST_SOURCE_OUTPUT_DEADLINE_MS,
                costProtection: true,
                externalBlocker: false,
              },
            });
            runtimeController.abort(new Error("FIRST_SOURCE_OUTPUT_DEADLINE_EXCEEDED"));
          }, FIRST_SOURCE_OUTPUT_DEADLINE_MS);

          heartbeat = setInterval(() => {
            if (firstSourceOutputObserved) return;
            const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1_000));
            emit({
              id: "creation-live-heartbeat",
              timestamp: new Date().toISOString(),
              kind: "reasoning",
              status: "running",
              title: `Waiting for the current model action · ${elapsedSeconds}s elapsed`,
              transient: true,
              details: { elapsedSeconds, modelWorkInProgress: true, paidModelCallsAdded: 0, transientKey: "creation-live-heartbeat" },
            });
          }, 30_000);

          void createFactoryProject(
            body.brief ?? "",
            (event: FactoryExecutionEvent) => {
              const key = event.details?.stage && /^Model\s*·/i.test(event.title) ? `model:${event.details.stage}:${event.title}` : event.id;
              if (sentEvents.has(key)) return;
              sentEvents.add(key);
              const changedPaths = changedPathsFromEvent(event);
              if (event.filePath || changedPaths.length) markSourceOutput();
              const normalizedEvent: FactoryExecutionEvent = changedPaths.length
                ? {
                    ...event,
                    title: /changed|updated|saved|written/i.test(event.title) ? `${changedPaths.length} files saved in this step` : event.title,
                    details: {
                      ...event.details,
                      changedFilesThisStep: changedPaths.length,
                      fileCountScope: "this-step",
                    },
                  }
                : event;
              emit(normalizedEvent);

              if (!event.filePath && changedPaths.length) {
                for (const filePath of changedPaths) {
                  observedProjectFiles.add(filePath.replace(/\\/g, "/"));
                  const fileEvent: FactoryExecutionEvent = {
                    id: `${event.id}:file:${createHash("sha1").update(filePath).digest("hex").slice(0, 10)}`,
                    timestamp: event.timestamp || new Date().toISOString(),
                    kind: "file",
                    status: event.status === "error" ? "error" : "completed",
                    title: `${event.status === "error" ? "Could not update" : "Saved"} ${filePath}`,
                    filePath,
                    details: {
                      projectFilesObserved: observedProjectFiles.size,
                      countScope: "observed-during-this-mission",
                      sourceEventId: event.id,
                    },
                  };
                  emit(fileEvent);
                }
              }
            },
            body.discovery,
            body.modelMode,
            body.quality,
            runtimeController.signal,
            body.evidenceAttachments ?? [],
          )
            .then(async (result) => {
              const recoveredResult = await recoverFalseRoot404(result, emit);
              emit({
                id: "project-file-inventory",
                timestamp: new Date().toISOString(),
                kind: "inspection",
                status: "completed",
                title: `${recoveredResult.files.length} files currently in the project · ${observedProjectFiles.size} changed during this mission`,
                details: {
                  projectFileCount: recoveredResult.files.length,
                  missionChangedFileCount: observedProjectFiles.size,
                  projectFilePaths: recoveredResult.files.map((file) => file.path),
                  countScope: "authoritative-final-inventory",
                },
              });
              completeExecution(body.controlId, recoveredResult);
              send({ type: "result", result: recoveredResult });
              if (!disconnected) controller.close();
            })
            .catch((error) => {
              const deadlineExceeded = runtimeController.signal.aborted && String(runtimeController.signal.reason).includes("FIRST_SOURCE_OUTPUT_DEADLINE_EXCEEDED");
              const message = deadlineExceeded
                ? "No application source was created before the first-output cost limit. Foundry stopped further model attempts instead of continuing to spend."
                : error instanceof Error ? error.message : "Factory project creation failed.";
              failExecution(body.controlId, message);
              send({ type: "error", error: message, code: deadlineExceeded ? "FIRST_SOURCE_OUTPUT_DEADLINE_EXCEEDED" : undefined });
              if (!disconnected) controller.close();
            })
            .finally(() => {
              activeCreationRequests.delete(requestFingerprint);
              if (heartbeat) clearInterval(heartbeat);
              if (firstOutputDeadline) clearTimeout(firstOutputDeadline);
              unregisterExecution();
            });
        },
        cancel() {
          disconnected = true;
          if (heartbeat) clearInterval(heartbeat);
          if (firstOutputDeadline) clearTimeout(firstOutputDeadline);
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        },
      });
    }

    try {
      const result = await createFactoryProject(body.brief, undefined, body.discovery, body.modelMode, body.quality, undefined, body.evidenceAttachments ?? []);
      return NextResponse.json(await recoverFalseRoot404(result, () => undefined));
    } finally {
      activeCreationRequests.delete(requestFingerprint);
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Factory project creation failed.",
      },
      { status: 500 },
    );
  }
}
