# Product Requirements Document: VS Code Extension for Go Templates

## 1. Overview
- **Product Name:** Go Template Studio for VS Code
- **Document Owner:** Product Management
- **Last Updated:** 2024-XX-XX
- **Status:** Draft

Go Template Studio is a Visual Studio Code extension that enables developers to author, inspect, and render Go text/template and html/template assets directly inside the editor. The extension focuses on speeding up iteration on template reference data, previewing rendered output, and integrating smoothly with typical Go project structures.

## 2. Problem Statement
Go developers rely heavily on templates for generating configuration files, HTML, and other artifacts. Existing workflows require frequent context switching between editing templates, modifying reference data, and running command-line tools to visualize output. This process is slow, error-prone, and unfriendly for newcomers. A dedicated VS Code extension can centralize these tasks, reducing friction and allowing immediate feedback while editing templates.

## 3. Goals & Non-Goals
### Goals
1. Provide first-class authoring support for Go templates, including syntax awareness and validation.
2. Allow users to define, manage, and quickly modify reference data ("context" objects) used to render templates.
3. Offer rich preview experiences similar to Markdown rendering, including live updates, diffing, and export options.
4. Integrate with Go workspaces and module structures with minimal manual configuration.
5. Support extensibility through commands, settings, and APIs for automation.

### Non-Goals
- Replacing general-purpose Go language tooling (e.g., Go extension for VS Code).
- Providing comprehensive project scaffolding or template repos management outside VS Code.
- Supporting non-Go templating engines.
- Implementing standalone CLIs or servers; the focus is the VS Code extension experience.

## 4. Target Users & Use Cases
### Personas
- **Go Application Developer (Primary):** Maintains backend services with HTML or text templates. Needs fast preview and iterative editing.
- **DevOps Engineer:** Uses templates to create configuration manifests (Kubernetes, Terraform). Wants reliable rendering with custom data sets.
- **Template Library Maintainer:** Curates shared template components and needs tools for validation and documentation.

### Key Use Cases
1. Edit a template file and preview the rendered output side-by-side with live updates.
2. Create and switch between multiple reference data sets for a single template.
3. Validate templates for missing keys, type mismatches, or syntax errors in real time.
4. Export rendered output to files or copy to clipboard for downstream tooling.
5. Document templates with embedded reference data and shareable preview snapshots.

## 5. Product Scope & Features
### 5.1 Core Functional Requirements
1. **Template Editing Enhancements**
   - Syntax highlighting, bracket matching, and snippets for Go template expressions.
   - Autocomplete for built-in template functions and detected custom functions from Go files.
   - Inline diagnostics for syntax errors leveraging `go` parser APIs or `text/template` compilation checks.

2. **Reference Data Management**
   - Side panel (tree view) listing available context files (JSON, YAML, TOML).
   - Ability to create, duplicate, delete, and edit context files with schema hints.
   - Association of default context per template file, stored in workspace settings.

3. **Rendering & Preview**
   - Preview panel similar to Markdown preview with live rendering when template or context changes.
   - Toggle between HTML, plaintext, and raw rendered output formats.
   - Highlighting of rendered sections corresponding to template blocks to aid debugging.
   - Error overlay showing missing variables or runtime errors.

4. **Diff & History Tools**
   - Command to compare rendered output between two contexts.
   - History view capturing recent renderings with ability to revert to previous context states.

5. **Command Palette & Shortcuts**
   - Quick actions: "Preview Go Template", "Set Reference Data", "Export Rendered Output".
   - Keyboard shortcuts customizable via VS Code keybindings.

6. **Integration & Extensibility**
   - Workspace configuration file describing template roots, context directories, and render settings.
   - Extension API to programmatically trigger renders or supply context data for other extensions.
   - Telemetry hooks (opt-in) for feature usage to guide future improvements.

### 5.2 Nice-to-Have Enhancements
- Visual designer for composing context objects with form-based editing.
- Template snippet marketplace integration.
- Collaboration mode for sharing live previews during pair programming (requires Live Share).

## 6. User Experience
- **UI Components:**
  - Template Preview WebView with responsive layout, toolbar for refresh/export, and diff toggle.
  - Activity bar icon for "Go Template Studio" opening a custom view container with context explorer and history.
  - Inline status bar item displaying active context set.
- **Workflow Example:**
  1. Developer opens `templates/email.html`.
  2. Activates preview (Cmd/Ctrl+Shift+P → "Preview Go Template").
  3. Selects context `welcome_user.json` from side panel; preview updates instantly.
  4. Modifies template or context; preview reflects changes in real time.
  5. Exports rendered HTML to `out/email.html` via toolbar.

## 7. Technical Requirements
- Built using VS Code Extension API (`vscode` npm module) with TypeScript.
- Uses Go's `text/template` and `html/template` via lightweight backend process executed with the system Go binary.
- Provide fallback rendering engine implemented in WASM/Node for environments without Go installed.
- Supports VS Code versions `1.85.0` and above (align with stable API features).
- Configuration stored in `.vscode/goTemplateStudio.json` with schema validation.
- Unit tests via `@vscode/test-electron` and integration smoke tests for rendering commands.

## 8. Dependencies & Risks
- **Dependencies:** Go runtime availability, VS Code API stability, Node.js environment.
- **Risks:**
  - Performance issues when rendering large templates or contexts; mitigate with streaming and caching.
  - Security of executing template functions; sandbox custom functions and warn about side effects.
  - Complexity of supporting both `text/template` and `html/template`; ensure consistent feature support.

## 9. Metrics & Success Criteria
- Daily active users of the extension (>1k within 6 months of launch).
- Average preview render time (<300ms for typical templates).
- Reduction in context-switching steps (measured via user surveys, target >40% improvement).
- User satisfaction score (CSAT > 4.2/5) within 3 months of beta release.

## 10. Release Plan
1. **Alpha (Month 1-2):** Basic preview rendering with manual context selection, syntax diagnostics, command palette integration.
2. **Beta (Month 3-4):** Context management UI, live preview updates, export functionality, telemetry instrumentation.
3. **GA (Month 5):** Performance tuning, documentation, localization for EN/JA, publish on VS Code Marketplace.
4. **Post-GA:** Marketplace marketing, user feedback loop, roadmap for collaborative features.

## 11. Open Questions
- Should the extension bundle a Go runtime for systems without Go installed?
- What level of customization is needed for template-specific helper functions?
- How should conflicts be handled when multiple templates share the same default context?

## 12. Appendices
- **References:** VS Code Extension API docs, Go template packages (`text/template`, `html/template`).
- **Glossary:**
  - **Context/Reference Data:** Data object used to populate template variables.
  - **Preview WebView:** Custom VS Code view for rendering template output.

