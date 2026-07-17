const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "components/WorkspaceShell.tsx"), "utf8");
const missionBlock = fs.readFileSync(path.join(root, "components/canvas/MissionBlock.tsx"), "utf8");
const provider = fs.readFileSync(path.join(root, "lib/ai/provider.ts"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  workspace.includes("evidenceAttachments,\n      );")
    && workspace.includes("const currentImages = evidenceAttachments.filter")
    && workspace.includes("targetMission.attachments.filter")
    && workspace.includes("result = await answerDirectQuestion(targetMission, task, referencedImages)")
    && workspace.includes("attachments,\n        sources: targetMission.sources"),
  "Read-only image questions can still drop current or referenced screenshot evidence before the answer request.",
);

assert(
  provider.includes('type: "input_image"')
    && provider.includes("shouldSendImageAttachment(request, attachment.fileId)"),
  "Reasoned answers no longer carry selected image evidence to the multimodal provider.",
);

assert(
  missionBlock.includes("max-w-[280px]")
    && missionBlock.includes("h-36 w-full")
    && missionBlock.includes(">Expand</"),
  "Canvas screenshots are not rendered as compact expandable thumbnails.",
);

console.log("Attachment lifecycle regression checks passed.");
