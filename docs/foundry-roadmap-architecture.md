# Foundry Roadmap and Architecture

Foundry is an AI Software Factory for creating, improving, debugging, analyzing, and deploying software projects.

Phase 1 should establish the product shell and guided build dashboard without locking the product into uploaded-file-only workflows. Long term, Foundry must work against real local projects and real developer environments.

## Product Roadmap

1. Phase 1: AI Software Factory dashboard and project-start flow.
2. Phase 2: Project planning and file generation.
3. Phase 3: Local folder/project connection.
4. Phase 4: Local agent / desktop connector.
5. Phase 5: Editor integrations for VS Code, Visual Studio, Android Studio if needed.
6. Phase 6: GitHub/deployment integrations.
7. Phase 7: Autonomous build/debug/deploy loop.

## Local Workspace Connector

The future Local Workspace Connector lets Foundry see and work with the real local project environment, similar to Claude Code or Codex-style workflows.

Supported surfaces should include:

- VS Code
- Visual Studio
- Android Studio
- Notepad++
- Local project folders
- Terminal output
- Dev server logs
- Build logs
- File changes
- Running processes
- Local preview URLs

Implementation direction:

- Foundry desktop app or local agent.
- Optional editor extensions later.
- Local secure connector running on the user's machine.
- User explicitly grants access to selected folders and tools.
- Foundry never scans the entire machine automatically.

Capabilities:

- Detect open project.
- Read files.
- Watch file changes.
- Run safe commands with approval.
- Capture terminal and build logs.
- Detect local dev server ports.
- Show live preview.
- Apply code changes.
- Restart dev server.
- Compare before/after errors.

Security:

- Ask permission before accessing folders.
- Ask permission before running commands.
- Ask permission before editing files.
- Show exactly what Foundry changed.
- Keep local secrets safe.
- Never upload unnecessary files.

## Phase 1 Constraint

The Phase 1 dashboard does not need to implement local tool access, but it must preserve room for it in the architecture. Project state, evidence, live work events, preview URLs, file actions, command output, and deployment state should be modeled in a way that can later come from a local connector, GitHub, uploaded files, or generated project files.
