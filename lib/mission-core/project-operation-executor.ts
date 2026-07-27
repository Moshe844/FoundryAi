import { createHash } from "node:crypto";
import type { ProjectAccess } from "@/lib/ai/mission/project-access";
import type { MissionRecord, PlannedOperation } from "./model";
import type { OperationExecutionResult, OperationExecutor } from "./scheduler";

export class ProjectOperationExecutor implements OperationExecutor {
  constructor(private readonly access: ProjectAccess) {}

  async execute(operation: PlannedOperation, _mission: MissionRecord, signal?: AbortSignal): Promise<OperationExecutionResult> {
    if (signal?.aborted) return { status: "failed", summary: "Operation canceled before execution.", error: "aborted" };

    switch (operation.kind) {
      case "read_file":
        return this.read(operation);
      case "write_file":
        return this.write(operation);
      case "delete_file":
        return this.remove(operation);
      case "run_command":
      case "start_process":
      case "stop_process":
        return this.command(operation);
      case "browser_action":
        return this.browser(operation);
      case "verify":
        return this.verify(operation);
      case "patch_file":
        return { status: "failed", summary: "Patch operations require a patch adapter; full-file fallback was intentionally refused.", error: "patch-adapter-required" };
      default:
        return assertNever(operation.kind);
    }
  }

  private async read(operation: PlannedOperation): Promise<OperationExecutionResult> {
    if (!operation.target) return invalid("Read operation has no target path.");
    const result = await this.access.readFile(operation.target);
    if (!result.exists) return { status: "failed", summary: `File not found: ${operation.target}`, error: "not-found" };
    return {
      status: "succeeded",
      summary: `Read ${operation.target}${result.truncated ? " (truncated)" : ""}.`,
      evidence: [operation.target, result.contentHash ?? createHash("sha256").update(result.content).digest("hex")],
      output: result.content,
      contentHash: result.contentHash,
    };
  }

  private async write(operation: PlannedOperation): Promise<OperationExecutionResult> {
    if (!operation.target) return invalid("Write operation has no target path.");
    if (typeof operation.input?.content !== "string") return invalid(`Write operation for ${operation.target} has no content.`);
    const result = await this.access.writeFile(operation.target, operation.input.content);
    if (!result.verified) return { status: "failed", summary: result.reason || `Write verification failed for ${operation.target}.`, error: result.reason };
    return {
      status: "succeeded",
      summary: `${result.existedBefore ? "Updated" : "Created"} ${operation.target} and verified the write.`,
      evidence: [operation.target, result.modifiedAt ?? "verified-on-disk"],
      changed: result.contentChanged,
      output: result.diff,
    };
  }

  private async remove(operation: PlannedOperation): Promise<OperationExecutionResult> {
    if (!operation.target) return invalid("Delete operation has no target path.");
    if (!this.access.deleteFile) return { status: "failed", summary: "This project connection does not support deletion.", error: "unsupported" };
    const result = await this.access.deleteFile(operation.target);
    if (!result.verified) return { status: "failed", summary: result.reason || `Deletion could not be verified for ${operation.target}.`, error: result.reason };
    return { status: "succeeded", summary: `${result.existed ? "Deleted" : "Confirmed absent"}: ${operation.target}.`, evidence: [operation.target] };
  }

  private async command(operation: PlannedOperation): Promise<OperationExecutionResult> {
    const command = operation.command?.trim();
    if (!command) return invalid("Command operation has no command.");
    if (!this.access.runCommand) return { status: "failed", summary: "This project connection cannot run commands.", error: "unsupported" };
    const result = await this.access.runCommand(command, operation.input?.cwd, {
      approvedCommands: operation.input?.approvedCommands,
      approvedCategories: operation.input?.approvedCategories,
      standingApprovedCommands: operation.input?.standingApprovedCommands,
    });
    if (result.skipped === "permission-required") {
      return { status: "awaiting_approval", summary: result.reason || result.stderr || `Approval required for ${command}.`, evidence: [result.category || "command"] };
    }
    const summary = result.exitCode === 0
      ? `Command completed successfully: ${command}`
      : `Command failed with exit code ${result.exitCode ?? "unknown"}: ${command}`;
    return {
      status: result.exitCode === 0 ? "succeeded" : "failed",
      summary,
      evidence: [command, `exit:${result.exitCode ?? "null"}`],
      output: result.stdout,
      error: result.stderr || undefined,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
  }

  private async browser(operation: PlannedOperation): Promise<OperationExecutionResult> {
    const input = operation.input?.browser;
    if (!input) return invalid("Browser operation has no browser input.");
    if (!this.access.validateBrowser) return { status: "failed", summary: "Browser validation is unavailable for this project connection.", error: "unsupported" };
    const result = await this.access.validateBrowser(input);
    return {
      status: result.verified ? "succeeded" : "failed",
      summary: result.verified ? `Browser validation passed for ${result.url || input.url}.` : result.reason || `Browser validation failed for ${input.url}.`,
      evidence: [result.url || input.url, result.screenshotPath || "no-screenshot"],
      error: result.verified ? undefined : result.reason,
      output: JSON.stringify({ title: result.title, consoleErrors: result.consoleErrors, failedRequests: result.failedRequests, steps: result.steps }),
    };
  }

  private async verify(operation: PlannedOperation): Promise<OperationExecutionResult> {
    if (operation.command) return this.command(operation);
    if (operation.input?.browser) return this.browser(operation);
    if (operation.target) return this.read(operation);
    return invalid("Verification operation has no command, browser check, or file target.");
  }
}

function invalid(summary: string): OperationExecutionResult {
  return { status: "failed", summary, error: "invalid-operation" };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported operation kind: ${String(value)}`);
}
