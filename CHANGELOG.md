# Changelog

All notable changes to Go Template Studio are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/) (`0.y.z` during the MVP).

## [1.1.0] - Unreleased

First feature release after the `v1.0.x` packaging tags. Earlier tags shipped the manifest as version 0.0.1; from this release on the manifest version and the git tag match.

### Added
- Side-by-side preview of Go `text/template` and `html/template` files, rendered by a Go worker against the selected context file (or an empty context via **Render without context**).
- Live updates: the preview re-renders while you type (debounced) and on save, preserving scroll position, text selection, and diagnostics between renders.
- Diagnostics for template and context errors, shown as VS Code squiggles and in the preview sidebar with clickable entries that jump to the offending location. The last successful output stays visible when a render fails, and the status footer reports render duration or fallback status.
- Isolated iframe rendering for HTML output, inline code display for other outputs, and an error banner that does not reset the webview.
- Context explorer tree view that lists JSON, YAML, and TOML context files from configured directories and lets you create, duplicate, delete, open, or select them, with an empty-state prompt to create a sample context; directories and associations are configurable in `.vscode/goTemplateStudio.json`.
- YAML (`.yaml`, `.yml`) and TOML (`.toml`) context files render with the same data shapes as JSON, and parse errors report the offending line (and column for TOML).
- Export rendered output to a file, to the clipboard, or to a file plus a shareable context bundle under `.gotemplatestudio/shares/`, from the preview toolbar, the editor title bar, or **Export Rendered Output**.
- Preview toolbar with Refresh, Export, and an HTML / Text / Raw view mode toggle; the chosen mode is remembered per workspace and `goTemplateStudio.defaultViewMode` sets the initial mode.
- Status bar item showing the active context for the focused template, with a warning when the last render failed; click it to switch context.
- One preview panel per template: running Preview again reveals the existing panel, and switching to a template editor reveals its preview without taking focus (`goTemplateStudio.preview.followActiveEditor`, default `true`).
- **Toggle Side-by-Side Preview** command that opens or closes the active template's preview.
- **Set Preview Layout** command and `goTemplateStudio.preview.layout` setting (`beside`, `below`) to open new previews beside the editor or in an editor group below it; the command's choice is remembered per workspace.
- The status bar warns when `auto` renderer mode falls back to the system Go toolchain (`go run`), and the preview footer names the renderer that produced the output.
- Built-in template helpers: `list`, `map`/`dict`, `default`, `join`, `safe`, `escape`, and string filters (`upper`, `lower`, `title`, `capitalize`, `trim`, `replace`).
- **Go Templates** language mode (`.tmpl`, `.gotmpl`, `.tpl`) with TextMate syntax highlighting from the vendored [`jinliming2/vscode-go-template`](https://github.com/jinliming2/vscode-go-template) grammar.
- Bundled `go-worker` renderer binaries for `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`, and `win32-arm64`, with a `go run` fallback for development builds.
- Tagged releases attach the packaged `.vsix` to the GitHub release (and every release run keeps it as a workflow artifact) for sideloading and rollback.
- Settings `goTemplateStudio.goBinary` and `goTemplateStudio.rendererMode` (`auto`, `bundled`, `system`).
- Commands: Show Welcome, Preview Template, Select Context, Refresh Contexts, Open Context File, Create/Duplicate/Delete Context File, Export Rendered Output, Refresh Preview, Toggle Preview View Mode, Toggle Side-by-Side Preview, and Set Preview Layout.
- Marketplace packaging: extension icon, gallery banner, keywords, Sponsor link, and a **Buy me a coffee** button on the welcome notification.
- Contributor docs: `CONTRIBUTING.md`, GitHub issue templates, and a pull request template.
- Vitest unit-test harness for the extension services, plus CI checks for unit tests, `gofmt`, `go vet`, and VSIX packaging.

### Fixed
- The editor title preview button now matches the contributed `go-templates` language id (plus `.tmpl`, `.tpl`, and `.gotmpl` extensions).
- Errors in unsaved templates and context files are reported on the file you are editing (squiggles, Problems panel, and the preview sidebar) instead of on a temporary snapshot file.
- The HTML view now works for `.tmpl`/`.tpl`/`.gotmpl` templates: a template is HTML when it has an inner `.html`/`.htm` extension (`email.html.tmpl`) or starts with `<!DOCTYPE html>` or `<html>`, and the renderer uses `html/template` escaping for exactly those templates.
- The `go run` renderer fallback no longer needs network access or a warm Go module cache (the worker's dependencies are vendored) and ignores unrelated `go.work` files (`GOWORK=off`).
- Command Palette entries no longer repeat the category ("Go Template Studio: Go Template Studio: …").

[1.1.0]: https://github.com/johnmschoonover/vscode_go_templates/releases/tag/v1.1.0
