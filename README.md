# Go Template Studio for VS Code

This repository currently hosts the planning documents and initial scaffolding for the **Go Template Studio** VS Code extension. The aim of this revision is to provide a minimal extension entry point that keeps the project runnable while we continue to iterate toward the full experience described in the PRD and technical specification.

## Current State
- The extension registers commands for welcoming new contributors, previewing templates, refreshing contexts, and selecting active context data.
- Selecting the welcome command surfaces quick links to the PRD and technical specification so contributors can align their work with the documented plan.
- A Go-powered renderer command shells out to the local Go runtime to compile templates against the selected context file and opens the rendered output in a preview document.
- A context explorer tree view lists context files from configured directories and allows opening files or selecting them for rendering.

### Workspace Configuration
- Context directories and default associations can be customized in `.vscode/goTemplateStudio.json`. The extension watches for updates and refreshes the tree view automatically.
- The Go binary used for rendering can be overridden via the `goTemplateStudio.goBinary` setting when a custom toolchain is required.

## Next Steps
1. Build the Webview-based preview and export workflow once rendering pipelines are in place.

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
