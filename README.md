# Go Template Studio

Preview, debug, and highlight Go `text/template` and `html/template` files in VS Code, with live rendering against your own context data.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/johnmschoonover/vscode_go_templates/actions/workflows/ci.yml/badge.svg)](https://github.com/johnmschoonover/vscode_go_templates/actions/workflows/ci.yml)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/johnmschoonover)

## Features
- **Side-by-side preview:** A Go-powered renderer compiles your template against the selected context file (or an empty context) and opens the rendered output in a side-by-side preview webview.
- **Preview layout:** Each template gets its own preview panel. Running Preview again reveals the existing panel, and switching to a template's editor brings its preview to the front without taking focus. **Go Template Studio: Toggle Side-by-Side Preview** opens or closes the active template's preview. **Go Template Studio: Set Preview Layout** opens new previews beside the editor or in a group below it, and remembers the choice per workspace.
- **Live updates:** The preview streams updates while you type (with a short debounce) in addition to reacting to saves, so you can see rendered output evolve in near real time.
- **Stable preview state:** Scroll position, text selection, and diagnostics in the preview persist between renders, keeping your place as you iterate on a template or tweak its context data.
- **Diagnostics:** Errors surface both as VS Code squiggles and inside the preview sidebar, with clickable entries that focus the offending template or context location. The status footer reports render duration or fallback status, and the preview keeps the last successful output visible when errors occur.
- **Safe HTML rendering:** HTML templates render inside an isolated iframe while other outputs show inline code, and errors surface as a banner within the preview instead of resetting the webview.
- **Context explorer:** A tree view lists JSON, YAML, and TOML context files from configured directories and lets you create, duplicate, delete, open, or select them for rendering (see [Context Files](#context-files)).
- **Syntax highlighting:** A **Go Templates** language mode is available from VS Code's language selector for files such as `.tmpl`, `.gotmpl`, and `.tpl` templates, complete with TextMate-based syntax highlighting powered by the vendored grammar from [`jinliming2/vscode-go-template`](https://github.com/jinliming2/vscode-go-template).
- **Template helpers:** Built-in helpers such as `list`, `dict`, `default`, `join`, and common string filters are pre-registered for every preview (see [Template Helpers](#template-helpers)).
- **Bundled renderer:** Tagged releases ship prebuilt renderer binaries so end users do not need Go installed (see [Renderer Binaries](#renderer-binaries)).
- **Commands:** The extension registers commands for welcoming new contributors, previewing templates, refreshing contexts, and selecting active context data. The welcome command surfaces quick links to the PRD and technical specification so contributors can align their work with the documented plan.

## Getting Started
1. Install **Go Template Studio** from the VS Code Marketplace (or install a `.vsix` build).
2. Open a Go template, for example a `.tmpl`, `.gotmpl`, or `.tpl` file. If VS Code does not pick the language automatically, choose **Go Templates** from the language selector.
3. Run **Go Template Studio: Preview Template** from the Command Palette, or click the preview button in the editor title bar. The preview opens beside your template.
4. Pick a context file from the quick pick, or choose **Render without context** if your template only relies on inline data. Use **Go Template Studio: Select Context** (or the **Go Template Contexts** view in the Explorer) to switch contexts later.
5. Edit the template or its context file and watch the preview update as you type.

With the default `auto` renderer mode, no Go installation is required when a bundled renderer is available for your platform. See the [Quickstart Guide](docs/quickstart.md) for more detail.

### Context Files
- **Formats:** `.json`, `.yaml`/`.yml`, and `.toml` files inside the configured `contextDirs` (default `context/`) are discovered automatically. Templates see the same shapes regardless of format, so `{{ .Site.Owner.Name }}` works against nested YAML maps or TOML tables just as it does for JSON. Values have the same types too: numbers are `float64` in every format (so `printf "%.2f"` and `eq .Count 3.0` behave alike), and YAML/TOML dates and times arrive as RFC 3339 strings. Each tree item shows its format next to its path.
- **Create:** the **+** button in the **Go Template Contexts** view title (or **Go Template Studio: Create Context File**) asks for a file name (`.json` is added when you omit the extension), picks a context directory when several are configured, offers to create `context/` if it is missing, and writes a starter document with `Title` and `Items`. If a template editor was active, you are offered to use the new file as its context.
- **Duplicate / Delete / Open:** right-click a context in the view. Duplicates keep the source format and land beside the original; deletes ask for confirmation and move the file to the trash, and templates that used the deleted file switch to no context (open previews re-render without it). From the command palette these commands show a quick pick instead.
- **Empty state:** when no context files exist, the view shows a **Create a sample context** button.
- **Parse errors:** YAML and TOML syntax errors are reported on the context file at the line (and, for TOML, column) the parser reports. JSON errors are reported on the file without a position.

### Preview Toolbar, Export, and Status Bar
- The preview opens with a toolbar offering **Refresh**, **Export…**, and a **View** switch:
  - **HTML** renders HTML output in the isolated iframe. A template counts as HTML when its name ends in `.html`/`.htm`, has `.html`/`.htm` before the template extension (`email.html.tmpl`), or its content starts with `<!DOCTYPE html>` or `<html>` (leading whitespace and `{{/* ... */}}` comments are skipped); those render with `html/template` escaping, everything else with `text/template`. Text templates fall back to Text, and the toolbar notes the fallback.
  - **Text** shows the output as plain text. For HTML output, markup is stripped to a simplified, readable form.
  - **Raw** shows the rendered source with markup visible.
- The chosen view mode is remembered per workspace. Until you choose one, `goTemplateStudio.defaultViewMode` (`html`, `text`, or `raw`) applies. **Go Template Studio: Toggle Preview View Mode** cycles the modes from the palette or a keybinding, and a keybinding can pass `"html"`, `"text"`, or `"raw"` as `args` to jump straight to one.
- **Go Template Studio: Export Rendered Output** (palette, editor title bar, or the toolbar's Export button) exports the most recent successful render. You can save it to a file (the default name is derived from the template, e.g. `email.html` → `email.rendered.html`), copy it to the clipboard, or save it together with a context bundle. The bundle is a JSON file under `.gotemplatestudio/shares/` holding the template path and source, the context path and data, and the render time. From the palette, the command exports the focused or active template's preview; when several previews are open and none is active, it asks which one to export.
- **Go Template Studio: Refresh Preview** forces a re-render of the active preview.
- A status bar item shows the active context for the focused template, e.g. `context/asdf.json` or `No context`. Click it to switch contexts. It shows a warning icon (with a warning background) when the last render failed and the preview is showing the last successful output. It also shows a warning icon when `auto` renderer mode fell back to `go run` because no bundled renderer is available. The tooltip explains which case applies. The preview footer names the renderer that produced the output (`bundled renderer`, `system Go`, or `system Go (auto fallback)`).

### Preview Layout
- Each template has at most one preview panel. Running **Preview Template** on a template whose preview is already open reveals that panel where you left it.
- When you switch to a template editor whose preview is hidden behind another tab, the preview is revealed in its group without taking focus. Turn this off with `goTemplateStudio.preview.followActiveEditor`.
- **Go Template Studio: Toggle Side-by-Side Preview** opens the active template's preview, prompting for a context like **Preview Template**, or closes it if it is open. Run it from a focused preview to close that preview.
- **Go Template Studio: Set Preview Layout** chooses where new previews open: **Beside** the editor (default) or **Below** it in a new editor group. The choice is remembered per workspace. Until you choose, `goTemplateStudio.preview.layout` applies. Previews that are already open stay where they are.

### Sample Assets
Open a template from `templates/` and pick the matching context from `context/` to try the preview. Each sample exercises a different part of the renderer and preview:
- `templates/asdf.go.tmpl` + `context/asdf.json`: a minimal HTML page with a title and a list of items. Its leading `{{/* ... */}}` comment does not stop `<!DOCTYPE html>` from selecting the HTML view.
- `templates/inline.go.tmpl` (no context): builds its data inline with the `list` and `map` helpers; choose **Render without context**.
- `templates/deployment.yaml.tmpl` + `context/deployment.yaml`: a Kubernetes Deployment manifest from a YAML context, using `range` over a list and over a map (`$k, $v`) and `{{- -}}` whitespace control. It is a text template, so the HTML view falls back to Text.
- `templates/welcome.html.tmpl` + `context/welcome.toml`: an HTML email from a TOML context. The inner `.html` extension selects `html/template` without a doctype, so the context's `<script>alert(1)</script>` display name is escaped and shows as text.
- `templates/report.go.tmpl` + `context/report.json`: a team report from nested JSON using `with`, `range $k, $v`, a `define`d block called with `template`, `printf`, and the `default`, `join`, `upper`, `list`, and `dict` helpers. Blocks must be defined in the same file; the preview does not support cross-file partials yet.

The Go worker tests render copies of these samples (in `go-worker/testdata/`) and compare the output with golden files; see the [Testing & QA Plan](testing_plan.md).

## Settings
- `goTemplateStudio.goBinary`: Path to the Go binary used for rendering templates (default `go`). Override it when a custom toolchain is required.
- `goTemplateStudio.rendererMode`: Selects which renderer to use:
  - `auto` (default) prefers the bundled worker when available and falls back to the system Go toolchain when not.
  - `bundled` requires a packaged worker and surfaces a helpful error if it is missing.
  - `system` always shells out to the configured `goBinary`.
- `goTemplateStudio.defaultViewMode`: Preview view mode (`html`, `text`, or `raw`) used until you pick one from the toolbar (default `html`).
- `goTemplateStudio.preview.layout`: Where new previews open, `beside` (default) or `below` the editor, until you choose a layout with **Set Preview Layout**.
- `goTemplateStudio.preview.followActiveEditor`: Reveal a template's preview when you switch to its editor (default `true`).

### Workspace Configuration
- Context directories and default associations can be customized in `.vscode/goTemplateStudio.json`. The extension watches for updates and refreshes the tree view automatically.

### Renderer Binaries
- Tagged releases include prebuilt `go-worker` binaries under `assets/bin/<platform>-<arch>/` so end users do not need Go installed. Supported targets today are `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64`.
- Development builds (for example, running from source) will automatically fall back to `go run` when the bundled binary is absent, preserving the contributor workflow. The fallback runs `go run -mod=vendor .` inside `go-worker/` with `GOWORK=off`. The worker's YAML/TOML dependencies are vendored in `go-worker/vendor/` (and ship in the VSIX), so the fallback works offline and with an empty module cache. After changing `go-worker/go.mod`, run `go mod vendor` in `go-worker/` and commit the result.
- Contributors can force a specific mode via `rendererMode`, or point `goBinary` at a custom toolchain when testing system-mode changes.

## Template Helpers
- The renderer registers a small helper map for every previewed template. You can build inline data structures with `list` for slices and `map`/`dict` for string-keyed maps without touching your context file:

  ```gotemplate
  {{$values := list "Foo" "Fiz" "Faz"}}
  {{$pairs := dict "key1" "value1" "key2" "value2"}}
  {{range $values}}
  - {{.}}1
  {{end}}
  {{range $key, $value := $pairs}}
  - {{$key}}: {{$value}}
  {{end}}
  ```
- Templates that only rely on inline data no longer need a context file on disk; choose **Render without context** from the preview quick pick and keep authoring directly inside the template.
- Common string filters are also available so templates can manipulate values inline: `{{ "go" | upper }}`, `{{ "GO" | lower }}`, `{{ "go template studio" | title }}`, `{{ "gO Template" | capitalize }}`, `{{ " spaced " | trim }}`, and `{{ "gopher" | replace "go" "GO" }}`.
- Additional helpers cover defaults, joining collections, and HTML safety. For example:

  ```gotemplate
  {{ $items := list "alpha" "beta" }}
  {{ $name := default "friend" .Name }}
  <p>{{ $name }}, combined: {{ $items | join ", " }}</p>
  <div>{{ "<strong>safe</strong>" | safe }}</div>
  <div>{{ "<span>escaped</span>" | escape }}</div>
  ```

## Next Steps
1. JSON and YAML preview view modes and a render diff workflow (`ux_brief.md` sections 7.5 and 7.6).
2. Integration tests with `@vscode/test-electron` (see `testing_plan.md`).
3. Preview layout follow-ups: a toolbar button for the layout toggle and reuse of an existing editor group for the `below` layout (`ux_brief.md` section 7.2).

## Support the Project
Go Template Studio is free and open source. If it saves you time, you can [buy me a coffee](https://buymeacoffee.com/johnmschoonover) to support continued development. The Sponsor button on the Marketplace listing and GitHub repository links to the same page.

## Contributing / Development
Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow checks, and pull request expectations, and [AGENTS.md](AGENTS.md) for repository guidelines. Release notes live in [CHANGELOG.md](CHANGELOG.md).

This repository began as planning documents plus initial scaffolding, so the PRD and technical specification below remain the source of truth for where the extension is heading.

### Development Workflow
1. Install dependencies with `npm install` (requires access to the npm registry).
2. Compile the extension using `npm run compile`.
3. Launch the extension in VS Code by pressing `F5` from this workspace (this uses the included **Run Extension** launch configuration).
   - When you want automatic rebuilds, start `npm run watch` and choose the **Run Extension (Watch)** configuration from the debug dropdown.
4. Run `npm run lint`, `npm run typecheck`, and `npm run test` to keep changes healthy. `npm run test` runs the TypeScript unit tests (`npm run test:unit`, powered by vitest; use `npm run test:unit:watch` while iterating and `npm run typecheck:test` to type-check them) followed by the Go worker tests (`npm run test:templates`). The optional `pre-commit` hook configuration will run these checks automatically before each commit if installed locally.

### Updating the TextMate Grammar
- Run `npm run update:grammar` to pull the latest grammar and license snapshot from `jinliming2/vscode-go-template`.
- Use `npm run verify:grammar` to confirm the vendored files match upstream. CI and the optional `pre-commit` hook run this check automatically so drift is caught quickly.
- Review the upstream repository for release notes or breaking changes whenever you refresh the grammar so downstream behavior stays predictable.
- Vendoring the grammar keeps the VSIX self-contained and spares contributors from managing Git submodules while still letting us track upstream changes with a single refresh command.

### Publishing
- The `Release` GitHub Action builds the per-platform `go-worker` binaries, downloads them into `assets/bin/`, and packages the extension. Configure `VSCE_PAT` and/or `OVSX_TOKEN` repository secrets to enable automatic marketplace publishing when the workflow runs on a tagged release.
- The Marketplace icon is generated by `scripts/generate-icon.py` (output: `assets/icon.png`, with the SVG source in `assets/icon.svg`).

### Reference Documents
- [Product Requirements Document](PRD.md)
- [Technical Specification](technical_spec.md)
- [UX Brief](ux_brief.md)
- [Quickstart Guide](docs/quickstart.md)
- [Testing & QA Plan](testing_plan.md)
- [Operational Readiness Checklist](operational_readiness.md)
- [Third-Party Licenses](docs/THIRD_PARTY_LICENSES.md)
