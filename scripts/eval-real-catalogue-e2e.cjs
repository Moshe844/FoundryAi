const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const briefCandidates = [
  path.join(root, "projects", "simple-baby-headbands-catalogue-2", "foundry-brief.md"),
  path.join(root, "projects", "simple-baby-headbands-catalogue-3", "foundry-brief.md"),
  path.join(root, "projects", "simple-baby-headbands-catalogue", "foundry-brief.md"),
];
const briefPath = briefCandidates.find((candidate) => fs.existsSync(candidate));
if (!briefPath) throw new Error("No catalogue acceptance-test brief is available.");
const brief = fs.readFileSync(briefPath, "utf8");
const started = Date.now();

async function main() {
  const baseUrl = process.env.FOUNDRY_BASE_URL || "http://127.0.0.1:3001";
  const response = await fetch(`${baseUrl}/api/factory/create?stream=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief, modelMode: "auto" }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!response.ok || !response.body) throw new Error(`Create request failed: HTTP ${response.status} ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line);
      if (payload.type === "event") console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${payload.event.status} ${payload.event.title}`);
      if (payload.type === "error") throw new Error(payload.error);
      if (payload.type === "result") finalResult = payload.result;
    }
    if (done) break;
  }
  if (!finalResult) throw new Error("Stream ended without a result.");
  const modelEvent = finalResult.timeline?.find((event) => event.details?.provider && event.details?.model);
  console.log(JSON.stringify({
    elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    projectId: finalResult.projectId,
    status: finalResult.status,
    blocker: finalResult.blocker,
    files: finalResult.files?.map((file) => ({ path: file.path, size: file.size })),
    commands: finalResult.commands?.map((item) => ({ command: item.command, exitCode: item.exitCode })),
    provider: modelEvent?.details?.provider,
    model: modelEvent?.details?.model,
    tier: modelEvent?.details?.tier,
    previewUrl: finalResult.previewUrl,
  }, null, 2));
  if (finalResult.status !== "passed" && finalResult.status !== "awaiting-mock-approval") process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
