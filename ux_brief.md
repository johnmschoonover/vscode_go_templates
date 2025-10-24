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
- **Status:** ⏳ Pending. The extension always opens the preview beside the active editor, but it lacks a command or setting to toggle dedicated side-by-side layout options, orientation, or persist workspace preferences.
- **Invocation:** Allow users to launch a dedicated split layout via the command palette (`Go Template Studio: Toggle Side-by-Side Preview`) or a toolbar button.
- **Layout behavior:** Pin the rendered WebView beside the source editor with optional vertical/horizontal orientation. Persist the layout choice per-workspace so frequent editors can return to their preferred view automatically.
- **State management:** When multiple templates are opened, the preview manager should maintain one panel per document and focus the matching preview when the user switches editors. This removes the need to reopen the preview repeatedly.

### 7.3 Inline Diagnostics Scope (Feature #3)
- **Status:** ⏳ Pending. Diagnostics are only surfaced inside the preview webview; no VS Code diagnostic collection exists yet to raise editor squiggles or richer context validation errors.
- Expand diagnostics beyond syntax errors to include missing/extra context keys, type mismatches detected in sample data, and unsafe function usage when helper libraries are disabled.
- Surface diagnostics both in the editor (squiggles + hover) and in the preview banner with quick actions that jump to the offending token or suggest fixes (e.g., "Add default value" for missing keys).
- Cache last-known good render output so that the preview can fall back gracefully while still highlighting issues inline.

### 7.4 Helper Functions Availability (Feature #5)
- **Status:** ✅ Completed. The Go worker registers helper maps for HTML and text templates, corresponding quickstart docs call them out, and unit tests cover their behavior.
- Baseline `list`, `map`, `dict`, and simple arithmetic helpers should continue working out of the box, even without external context files.
- Document in the quickstart that these helpers are pre-registered by the Go worker, and add unit coverage so regressions are caught if the worker code changes.

### 7.5 Multi-Format View Modes (Feature #6)
- **Status:** ⏳ Pending. The preview currently offers only HTML/text rendering pathways without JSON/YAML toggles or graceful handling for unsupported conversions.
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
