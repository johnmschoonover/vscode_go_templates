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
