# UX Brief: Go Template Studio for VS Code

## 1. Experience Principles
1. **Preview First:** Always prioritize the rendered output, mirroring the familiarity of VS Code's Markdown preview.
2. **Minimal Setup:** Offer sensible defaults and auto-discovery to avoid configuration hurdles.
3. **Guided Discovery:** Provide inline hints and sample data to help new Go learners understand template behavior quickly.
4. **Stay Lightweight:** Keep interactions focused on quality-of-life improvements, not full project management.

## 2. Primary Journeys
### A. First-Run Onboarding
1. User installs extension and opens a Go workspace.
2. Extension detects template files and displays welcome notification with link to quickstart guide and sample bundle.
3. User triggers `Preview Go Template` from command palette; preview opens side-by-side with template.
4. Inline coach marks highlight context selector and export buttons.

### B. Editing with Live Preview
1. User edits `templates/email.html`.
2. Preview updates within 150ms, maintaining scroll sync between source and rendered output.
3. Error banner appears if template compilation fails; clicking banner focuses the problematic token in editor.
4. Context switcher shows active context; user selects alternate context to compare output.

### C. Export & Share
1. From preview toolbar, user clicks `Export`.
2. Dialog offers `Save to File` or `Copy to Clipboard`.
3. Optional toggle `Include Context Bundle` packages template + context as sharable JSON stored in `.gotemplatestudio/shares`.
4. Confirmation toast with link to open output folder.

## 3. Information Architecture
- **Activity Bar View Container:** "Go Template Studio" with two tree views: "Contexts" and "History" (history is placeholder in MVP but scaffolding remains for future feature).
- **WebView Toolbar:** Buttons for `Refresh`, `Export`, `View Mode` (Raw, HTML, Simplified), `Context` quick pick, and telemetry opt-in toggle if disabled.
- **Status Bar Item:** Displays active context and warning icon when rendering falls back to degraded mode.

## 4. Interaction & States
- **Loading State:** Skeleton preview with spinner and message "Rendering with Go Template Studio…".
- **Success State:** Rendered output with subtle highlight overlays when hovering template sections.
- **Error State:** Red banner with message, error code, and action buttons `Open Template` and `View Logs`.
- **Empty State:** If no context is associated, show call-to-action to create sample context with one click.

## 5. Accessibility & Localization
- Support keyboard navigation for all interactive elements (e.g., toolbar buttons, tree items) with focus outlines.
- Provide ARIA labels for toolbar controls and dynamic announcements via `aria-live` regions on preview updates.
- Respect VS Code theme tokens to ensure readability in light, dark, and high-contrast themes.
- Localize UI copy via `package.nls.json` with English as default; prepare structure for future locales without delaying MVP.

## 6. Content & Documentation
- Bundle `docs/quickstart.md` and `samples/` templates referenced in onboarding notifications.
- Link to GitHub issues for feedback directly from the preview toolbar `Help` menu.
- Include context-sensitive tips (e.g., "Need a sample context? Generate one now") as dismissible notifications.

## 7. Feature Follow-Up Notes

### 7.1 Live Preview Enhancements (Feature #1)
- **Status:** ✅ Completed. The current preview pipeline tracks template and context signatures, schedules renders on change/save events, and restores scroll/selection state after each webview update.
- **Implementation notes:** See `src/services/previewManager.ts` for the change listeners, signature comparison, and state persistence logic.

### 7.2 Side-by-Side Preview Layout (Feature #2)
- **Status:** ✅ Completed, with follow-ups listed below.
- **Invocation:** `Go Template Studio: Toggle Side-by-Side Preview` opens the preview for the active template, or closes it when one is open. When a preview panel has focus, the command closes that preview. Opening uses the same context prompt as `Preview Template`.
- **Layout behavior:** New previews open `beside` the editor (default) or in a new editor group `below` it. `Go Template Studio: Set Preview Layout` saves the choice per workspace in `workspaceState`, the same way the view mode is saved. Until a choice is saved, the `goTemplateStudio.preview.layout` setting applies. A new layout applies to previews opened afterwards. Open panels stay where they are.
- **State management:** The preview manager keeps one panel per template document, keyed by the template URI. Running Preview again on a template reveals its existing panel in the group where it currently is. Switching to a template editor reveals that template's preview without taking focus. It is skipped when the panel is already visible or sits in the editor's own group. `goTemplateStudio.preview.followActiveEditor` (default `true`) turns this off. Closing a panel cancels any pending render and drops renders still in flight. It also clears the session's render state and fires `onDidChangeState`, so the status bar updates.
- **Implementation notes:** `src/services/previewLayout.ts` holds the pure layout and follow-editor rules. `PreviewManager` (`src/services/previewManager.ts`) applies them. `below` runs `workbench.action.newGroupBelow`, creates the panel in `ViewColumn.Active`, then gives focus back to the template editor. If the split command fails, the preview opens beside the editor. Unit tests are in `test/unit/previewLayout.test.ts` and `test/unit/previewManager.test.ts`.
- **Follow-ups:** `below` always adds a new group, even when a group already exists below the editor (TODO(layout) in `src/services/previewLayout.ts`). There is no toolbar button or default keybinding for the toggle yet. A "lock preview" mode (a preview that does not follow the active editor) was deferred. Changing the layout does not move previews that are already open.

### 7.3 Inline Diagnostics Scope (Feature #3)
- **Status:** ✅ Completed. Rendering now populates a dedicated VS Code diagnostic collection for both template and context errors, and the preview sidebar mirrors those issues with clickable entries that focus the relevant editor location.
- Diagnostics continue to display inline inside the preview, and when rendering fails the webview preserves the last successful output while announcing the fallback state.
- The groundwork is in place for future enhancements (e.g., richer fix suggestions) by centralizing diagnostic normalization inside `src/services/diagnosticService.ts`.

### 7.4 Helper Functions Availability (Feature #5)
- **Status:** ✅ Completed. The Go worker registers helper maps for HTML and text templates, corresponding quickstart docs call them out, and unit tests cover their behavior.
- Baseline `list`, `map`, `dict`, and simple arithmetic helpers should continue working out of the box, even without external context files.
- Document in the quickstart that these helpers are pre-registered by the Go worker, and add unit coverage so regressions are caught if the worker code changes.

### 7.5 Multi-Format View Modes (Feature #6)
- **Status:** 🟡 Partially complete. The preview toolbar has an HTML / Text / Raw view switch. The choice is persisted per workspace, defaults to the `goTemplateStudio.defaultViewMode` setting, and is reachable via `Go Template Studio: Toggle Preview View Mode`. HTML mode falls back to Text for text templates and the toolbar notes the fallback. Text mode strips HTML markup into a simplified plain-text view. Raw mode shows the rendered markup. JSON/YAML modes are still pending.
- **Implementation notes:** View mode switching happens client-side in the webview (`src/services/previewManager.ts`), so changing modes does not trigger a re-render. The extension persists the choice in `workspaceState` and broadcasts it to every open preview.
- Extend the existing view toggle to support HTML, plain text, raw template output, JSON, and YAML.
- When JSON/YAML is selected, serialize the rendered Go template data structure (pre-HTML escaping) so teams producing config files can verify structure without extra tooling.
- Highlight unsupported conversions gracefully (e.g., streaming binary data) with a toast explaining the limitation.

### 7.6 Render Diff Workflow (Feature #8)
- **Status:** ⏳ Pending. No `Compare Rendered Output…` command or diff view exists yet; preview sessions operate independently without diff synchronization.
- Provide a `Compare Rendered Output…` command that lets users choose a second context (or Git ref) and opens a VS Code diff editor showing render A vs. render B.
- Annotate the diff with badges noting which context or commit produced each side, so reviewers understand the comparison origin.
- Support updating the diff live as either context changes, enabling regression checks before sharing templates with stakeholders.

### 7.7 Go Template Syntax Highlighting (Feature #9)
- **Status:** ✅ Completed. The extension now bundles a TextMate grammar sourced from `jinliming2/vscode-go-template`, enabling scoped syntax highlighting for Go template delimiters, actions, and pipelines.
- **Implementation notes:** The grammar is vendored in `syntaxes/go-template.tmLanguage.json` and registered in `package.json` under `contributes.grammars`. Use `npm run update:grammar` to refresh the snapshot, and `npm run verify:grammar` to ensure the checked-in files remain in sync (enforced via CI and the optional pre-commit hooks).

### 7.8 Sponsor & Funding Placement (Release Prep)
- **Status:** ✅ Completed. Funding entry points are low-key and never block the core preview workflow.
- **Marketplace & VS Code:** `package.json` declares `sponsor.url`, which shows a Sponsor button on the Marketplace listing and the extension details page.
- **GitHub:** `.github/FUNDING.yml` enables the repository Sponsor button, and the README carries a Buy Me a Coffee badge plus a short "Support the Project" section.
- **In-product:** The `Go Template Studio: Show Welcome` notification offers a third button, **Buy me a coffee**, which opens the funding page externally. No nags, popups, or telemetry are tied to it.
- **Marketplace polish:** The extension ships an icon (`assets/icon.png`, generated by `scripts/generate-icon.py`), a dark gallery banner, and keywords. The editor title preview button now targets the contributed `go-templates` language id and `.tmpl`/`.tpl`/`.gotmpl` extensions.

### 7.9 Reference Data Management (PRD 5.1 item 2)
- **Status:** 🟡 Partially completed. The context explorer discovers JSON, YAML (`.yaml`/`.yml`), and TOML files and shows each file's format next to its path. The Go worker renders all three formats and reports YAML/TOML parse errors at the line (and, for TOML, column) the parser reports.
- **CRUD:** `Create Context File` (view title **+**, command palette, and the empty-state button) writes a starter document in the chosen format, offers to create `context/` when it is missing, and offers to associate the new file with the active template. `Duplicate` and `Delete` are in the view's item context menu and fall back to a quick pick from the palette. Delete asks for confirmation in a modal and moves the file to the trash.
- **Empty State (section 4):** A `viewsWelcome` entry shows **Create a sample context** when no context files exist, and an **Open Folder** prompt when no workspace is open.
- **Follow-ups:** Schema hints are still open (TODO in `src/context/contextCommands.ts`). So are pruning associations to deleted contexts, multi-select delete, and persisting associations to `.vscode/goTemplateStudio.json`.

### 7.10 Export & Status Bar Follow-Up (Journeys 2C, Section 3)
- **Status:** ✅ Export and status bar shipped; follow-ups remain.
- **Export:** The preview toolbar's `Export…` button, the editor title bar, and `Go Template Studio: Export Rendered Output` all offer `Save to File`, `Copy to Clipboard`, and `Save to File with Context Bundle`. The bundle is JSON written to `.gotemplatestudio/shares/`. Exports always use the last successful render. When the latest render failed, the quick pick says the exported output is stale. After saving, a confirmation offers `Open` and `Reveal`. Implementation: `src/services/exportService.ts`.
- **Status bar:** A left-aligned item shows the active context (`$(json) <path>` or `No context`) for the focused template or preview and opens the context picker on click. It adds a `$(warning)` icon and a warning background when the last render failed and the preview fell back to its last good output.
- **Renderer degradation (resolved):** `RenderResult` now carries `rendererMode` (`bundled` or `system`) and `rendererFallback`. `rendererFallback` is true when `goTemplateStudio.rendererMode` is `auto` and no bundled worker was found, so `go run` was used. The preview render state passes both fields on. The status bar shows `$(warning)` for this fallback too, with a tooltip that explains it, but without the warning background, which is reserved for failed renders. The preview footer names the renderer, e.g. `Rendered in 12 ms · bundled renderer` or `· system Go (auto fallback)`. The wording is in `src/services/renderStatus.ts`.
- **Follow-ups:** Bundles read template and context sources at export time, not render time (TODO in `exportService.ts`). Importing or opening a share bundle is not implemented. The toolbar does not yet have the `Context` quick pick or the telemetry toggle from Section 3.
