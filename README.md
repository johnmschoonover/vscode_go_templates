# Go Template Studio for VS Code

This repository currently hosts the planning documents and initial scaffolding for the **Go Template Studio** VS Code extension. The aim of this revision is to provide a minimal extension entry point that keeps the project runnable while we continue to iterate toward the full experience described in the PRD and technical specification.

## Current State
- The extension registers a single `Go Template Studio: Show Welcome` command.
- Selecting the command surfaces quick links to the PRD and technical specification so contributors can align their work with the documented plan.
- No preview, rendering, or context management capabilities are implemented yet.

## Next Steps
1. Flesh out the renderer integration that shells out to the Go runtime as outlined in `technical_spec.md`.
2. Add the context explorer tree view and associated workspace configuration management.
3. Build the Webview-based preview and export workflow once rendering pipelines are in place.

## Development Workflow
1. Install dependencies with `npm install` (requires access to the npm registry).
2. Compile the extension using `npm run compile`.
3. Launch the extension in VS Code by pressing `F5` from this workspace.
4. Run `npm run lint` and `npm run typecheck` to keep changes healthy. The optional `pre-commit` hook configuration will run these checks automatically before each commit if installed locally.

## Reference Documents
- [Product Requirements Document](PRD.md)
- [Technical Specification](technical_spec.md)
- [UX Brief](ux_brief.md)
- [Testing & QA Plan](testing_plan.md)
- [Operational Readiness Checklist](operational_readiness.md)
