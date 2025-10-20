# Go Template Studio for VS Code

This repository now includes the working source code for the **Go Template Studio** VS Code extension alongside the planning artifacts. The extension delivers a Markdown-style preview experience for Go `text/template` and `html/template` files with lightweight context management and export tools.

## Extension Features
- Live preview panel for `.tmpl`, `.tpl`, and `.gotmpl` files with HTML/text toggle.
- Context explorer view that discovers JSON data files from configurable directories.
- Quick context picker and default-context resolution via `.vscode/goTemplateStudio.json`.
- Inline diagnostics and sanitized preview rendering handled by the extension host.
- Export helpers for saving rendered HTML or copying to the clipboard.

## Getting Started
1. Install dependencies with `npm install` (requires access to the npm registry).
2. (Optional, but recommended) Install the git hooks with `pre-commit install`.
   - Ensure the [`pre-commit`](https://pre-commit.com/) CLI is available locally (for example, `pip install pre-commit`).
   - The configured hooks run `npm run lint` and `npm run typecheck` to keep the codebase clean.
3. Compile the extension using `npm run compile`.
4. Launch the extension in VS Code by pressing `F5` from this workspace.
5. Open a Go template file and run **Go Template Studio: Open Preview** from the Command Palette.

> **Note:** The extension gracefully degrades when telemetry is disabled (the default) and buffers anonymous event counts locally until enabled.

## Documents
- [Product Requirements Document](PRD.md)
- [Technical Specification](technical_spec.md)
- [UX Brief](ux_brief.md)
- [Testing & QA Plan](testing_plan.md)
- [Operational Readiness Checklist](operational_readiness.md)

## Vision
Create a lightweight, community-friendly extension that makes working with Go templates delightful by offering live previews, easy context management, and simple export workflows.
