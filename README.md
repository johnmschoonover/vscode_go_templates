# Go Template Studio for VS Code

This repository currently hosts the planning documents and initial scaffolding for the **Go Template Studio** VS Code extension. The aim of this revision is to provide a minimal extension entry point that keeps the project runnable while we continue to iterate toward the full experience described in the PRD and technical specification.

## Current State
- The extension registers commands for welcoming new contributors, previewing templates, refreshing contexts, and selecting active context data.
- Selecting the welcome command surfaces quick links to the PRD and technical specification so contributors can align their work with the documented plan.
- A Go-powered renderer command shells out to the local Go runtime to compile templates against the selected context file (or an empty context) and opens the rendered output in a side-by-side preview webview.
- The preview webview automatically refreshes whenever the template or its associated context file is saved, mirroring the behavior of VS Code's Markdown preview.
- A context explorer tree view lists context files from configured directories and allows opening files or selecting them for rendering.
- A **Go Templates** language mode is available from VS Code's language selector for files such as `.tmpl` and `.gotmpl` templates.

### Sample Assets
- `templates/asdf.go.tmpl` pairs with `context/asdf.json` to demonstrate a minimal template and context combination that the preview command can render immediately.
- The sample context provides a `Title` string and an `Items` array; the template renders the title as both the document heading and HTML title and lists the array entries.

### Template Helpers
- The renderer registers a small helper map for every previewed template. You can build inline data structures with `list` for slices and `map` for string-keyed maps without touching your context file:

  ```gotemplate
  {{$values := list "Foo" "Fiz" "Faz"}}
  {{$pairs := map "key1" "value1" "key2" "value2"}}
  {{range $values}}
  - {{.}}1
  {{end}}
  {{range $key, $value := $pairs}}
  - {{$key}}: {{$value}}
  {{end}}
  ```
- Templates that only rely on inline data no longer need a context file on disk; choose **Render without context** from the preview quick pick and keep authoring directly inside the template.

### Workspace Configuration
- Context directories and default associations can be customized in `.vscode/goTemplateStudio.json`. The extension watches for updates and refreshes the tree view automatically.
- The Go binary used for rendering can be overridden via the `goTemplateStudio.goBinary` setting when a custom toolchain is required.
- Renderer selection is controlled by the `goTemplateStudio.rendererMode` setting:
  - `auto` (default) prefers the bundled worker when available and falls back to the system Go toolchain when not.
  - `bundled` requires a packaged worker and surfaces a helpful error if it is missing.
  - `system` always shells out to the configured `goBinary`.

## Renderer Binaries
- Tagged releases include prebuilt `go-worker` binaries under `assets/bin/<platform>-<arch>/` so end users do not need Go installed. Supported targets today are `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64`.
- Development builds (for example, running from source) will automatically fall back to `go run` when the bundled binary is absent, preserving the contributor workflow.
- Contributors can force a specific mode via `rendererMode`, or point `goBinary` at a custom toolchain when testing system-mode changes.

## Next Steps
1. Build the Webview-based preview and export workflow once rendering pipelines are in place.

## Development Workflow
1. Install dependencies with `npm install` (requires access to the npm registry).
2. Compile the extension using `npm run compile`.
3. Launch the extension in VS Code by pressing `F5` from this workspace (this uses the included **Run Extension** launch configuration).
   - When you want automatic rebuilds, start `npm run watch` and choose the **Run Extension (Watch)** configuration from the debug dropdown.
4. Run `npm run lint`, `npm run typecheck`, and `npm run test` to keep changes healthy. The optional `pre-commit` hook configuration will run these checks automatically before each commit if installed locally.

## Publishing
- The `Release` GitHub Action builds the per-platform `go-worker` binaries, downloads them into `assets/bin/`, and packages the extension. Configure `VSCE_PAT` and/or `OVSX_TOKEN` repository secrets to enable automatic marketplace publishing when the workflow runs on a tagged release.

## Reference Documents
- [Product Requirements Document](PRD.md)
- [Technical Specification](technical_spec.md)
- [UX Brief](ux_brief.md)
- [Testing & QA Plan](testing_plan.md)
- [Operational Readiness Checklist](operational_readiness.md)
