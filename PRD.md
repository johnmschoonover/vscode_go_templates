# Product Requirements Document: VS Code Extension for Go Templates

## 1. Overview
- **Product Name:** Go Template Studio for VS Code
- **Document Owner:** Product & Engineering Duo
- **Last Updated:** 2024-04-XX
- **Status:** Draft for MVP build kick-off

Go Template Studio is a free Visual Studio Code extension that enables developers to author, inspect, and render Go `text/template` and `html/template` assets directly inside the editor. The extension focuses on replicating the simplicity of VS Code's Markdown preview experience for Go templates so that developers can see beautifully rendered output without leaving the editor. By reducing context switching between template editing, sample data creation, and command-line rendering, the extension aims to make day-to-day template work faster and friendlier.

## 2. Problem Statement
Go developers rely heavily on templates for generating configuration files, HTML, and other artifacts. Existing workflows require frequent context switching between editing templates, modifying reference data, and running command-line tools to visualize output. This process is slow, error-prone, and unfriendly for newcomers. A dedicated VS Code extension can centralize these tasks, reducing friction and allowing immediate feedback while editing templates.

## 3. Goals & Non-Goals
### Goals
1. Deliver an intuitive, Markdown-style preview for Go templates that updates live as authors type.
2. Provide lightweight tooling for creating, selecting, and managing reference data ("context" objects).
3. Offer a simple export and sharing experience for rendered output that feels native to VS Code.
4. Integrate seamlessly with standard Go workspaces with minimal setup.
5. Make the extension easy to extend via commands and settings so the community can automate repetitive tasks.

### Non-Goals
- Replacing general-purpose Go language tooling (e.g., Go extension for VS Code).
- Providing comprehensive project scaffolding or template repository management outside VS Code.
- Supporting non-Go templating engines.
- Implementing standalone CLIs or paid features; the extension will remain free and open to the community.

## 4. Target Users & Use Cases
### Personas
- **Go Application Developer (Primary):** Maintains backend services with HTML or text templates. Needs fast preview and iterative editing.
- **DevOps Engineer:** Uses templates to create configuration manifests (Kubernetes, Terraform). Wants reliable rendering with custom data sets.
- **Template Library Maintainer:** Curates shared template components and needs tools for validation and documentation.
- **New Go Learner:** Is exploring Go templates for the first time and benefits from immediate visual feedback and examples.

### Key Use Cases
1. Edit a template file and preview the rendered output side-by-side with live updates.
2. Create and switch between multiple reference data sets for a single template.
3. Validate templates for missing keys, type mismatches, or syntax errors in real time.
4. Export rendered output to files or copy to clipboard for downstream tooling.
5. Document templates with embedded reference data and shareable preview snapshots.
6. Quickly toggle between raw, HTML, and simplified outputs when explaining templates to teammates or learners.

## 5. Product Scope & Features
### 5.1 MVP Scope (Must-Haves)
1. **Template Editing Enhancements**
   - Syntax highlighting, bracket matching, and snippets for Go template expressions.
   - Inline diagnostics for syntax errors leveraging `text/template` compilation checks.

2. **Reference Data Management**
   - Side panel (tree view) listing available context files (JSON, YAML, TOML).
   - Ability to create, duplicate, delete, and edit context files with schema hints.
   - Association of default context per template file, stored in workspace settings.

3. **Rendering & Preview**
   - Markdown-style preview panel with live rendering when template or context changes.
   - Toggle between HTML, plaintext, and raw rendered output formats.
   - Error overlay showing missing variables or runtime errors with actionable links back to source.

4. **Export & Sharing**
   - Command palette action and toolbar button to export rendered output to file or clipboard.
   - Lightweight share link generator that packages template + context into a single JSON bundle for teammates.

5. **Command Palette & Shortcuts**
   - Quick actions: "Preview Go Template", "Set Reference Data", "Export Rendered Output".
   - Keyboard shortcuts customizable via VS Code keybindings.

### 5.2 Post-MVP Considerations
- Diff view comparing rendered output between two contexts.
- History view capturing recent renderings with ability to revert to previous context states.
- Visual designer for composing context objects with form-based editing.
- Collaboration mode for sharing live previews during pair programming (requires Live Share).

## 6. User Experience
- **UI Components:**
  - Template Preview WebView with responsive layout, toolbar for refresh/export, and view mode toggle.
  - Activity bar icon for "Go Template Studio" opening a custom view container with context explorer and history.
  - Inline status bar item displaying active context set.
- **Workflow Example:**
  1. Developer opens `templates/email.html`.
  2. Activates preview (Cmd/Ctrl+Shift+P → "Preview Go Template").
  3. Selects context `welcome_user.json` from side panel; preview updates instantly.
  4. Modifies template or context; preview reflects changes in real time.
  5. Exports rendered HTML to `out/email.html` via toolbar or copies to clipboard for quick sharing.

## 7. Technical Requirements
- Built using VS Code Extension API (`vscode` npm module) with TypeScript.
- Uses Go's `text/template` and `html/template` via lightweight backend process executed with the system Go binary.
- Provides fallback rendering engine implemented in WASM/Node for environments without Go installed (post-MVP if needed).
- Supports VS Code versions `1.85.0` and above (align with stable API features).
- Configuration stored in `.vscode/goTemplateStudio.json` with schema validation and multi-root workspace awareness.
- Unit tests via `@vscode/test-electron` and integration smoke tests for rendering commands.
- Telemetry is optional/opt-in and limited to anonymous feature usage counts to respect user privacy.

## 8. Dependencies & Risks
- **Dependencies:** Go runtime availability, VS Code API stability, Node.js environment.
- **Risks:**
  - Performance issues when rendering large templates or contexts; mitigate with streaming and caching.
  - Security of executing template functions; sandbox custom functions and warn about side effects.
  - Complexity of supporting both `text/template` and `html/template`; ensure consistent feature support.
  - Risk of scope creep into full templating platform; stay focused on preview and quality-of-life wins.

## 9. Metrics & Success Criteria
- Daily active users of the extension (>1k within 12 months of launch) with positive marketplace reviews.
- Average preview render time (<300ms for typical templates).
- Reduction in context-switching steps (measured via user surveys, target >40% improvement).
- User satisfaction score (CSAT > 4.2/5) within 3 months of beta release.
- Community adoption signals: GitHub stars on sample template repo, issue participation, and external contributions.

## 10. Release Plan
1. **Preview Spike (Weeks 1-2):** Markdown-like preview for Go templates with manual context selection.
2. **MVP Hardening (Weeks 3-6):** Context management UI, live preview updates, export functionality, opt-in telemetry instrumentation.
3. **Public Launch (Week 8):** Performance tuning, documentation, publish on VS Code Marketplace as a free extension.
4. **Post-Launch Iteration:** Gather feedback, prioritize diff/history enhancements, explore accessibility and localization improvements.

## 11. Open Questions
- Should the extension bundle a Go runtime for systems without Go installed?
- What level of customization is needed for template-specific helper functions?
- How should conflicts be handled when multiple templates share the same default context?

## 12. Appendices
- **References:** VS Code Extension API docs, Go template packages (`text/template`, `html/template`).
- **Glossary:**
  - **Context/Reference Data:** Data object used to populate template variables.
  - **Preview WebView:** Custom VS Code view for rendering template output.

