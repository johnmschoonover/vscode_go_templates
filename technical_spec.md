# Technical Specification: Go Template Studio for VS Code

## 1. Architecture Overview
- **Extension Host (TypeScript):** Primary controller that registers activation events, VS Code commands, tree views, and WebView panel providers.
- **Go Render Worker:** Lightweight child process spawned via the system `go` binary to compile and render `text/template` and `html/template` files using selected context data.
- **Fallback Renderer (Node/WASM):** Deferred to post-MVP; placeholder interface allows swapping in a JavaScript-based renderer when Go is unavailable.
- **Communication Channels:**
  - VS Code command and event APIs for user interactions.
  - JSON-RPC-like messaging over `child_process` stdio between the extension host and Go worker.
  - WebView `postMessage` bridge for preview updates, errors, and user actions (e.g., export, view toggle).

## 2. Activation & Lifecycle
- **Activation Events:**
  - `onLanguage:gotemplate` (custom language ID for `.tmpl`, `.tpl`, `.gotmpl`).
  - `onCommand:goTemplateStudio.preview`, `onCommand:goTemplateStudio.selectContext`, `onCommand:goTemplateStudio.export`.
  - `workspaceContains:**/templates/*.tmpl` to auto-enable in common project structures.
- **Deactivation:** Disposes preview panels, kills Go worker processes, and flushes telemetry queue (if opted-in).

## 3. Module Breakdown
- **Preview Manager:** Handles creation of WebView panels, message routing, diff/view mode toggles, and live updates.
- **Context Manager:** Provides tree data provider for context files, CRUD operations, schema validation, and default context association per template.
- **Renderer Service:** Encapsulates process management for the Go worker, caches compiled templates, and reports diagnostics.
- **Configuration Service:** Reads and writes `.vscode/goTemplateStudio.json`, merges workspace/user settings, and supports multi-root workspaces.
- **Telemetry Service:** Wrapper around VS Code telemetry reporter; disabled by default and collects only anonymous event counts when enabled.
- **Export Service:** Streams rendered output to filesystem targets or clipboard and packages shareable bundles (template + context JSON).

## 4. Data Models
- **Workspace Configuration (`.vscode/goTemplateStudio.json`):**
  ```json
  {
    "$schema": "https://example.com/schemas/go-template-studio.schema.json",
    "templateRoots": ["templates", "internal/emails"],
    "contextDirs": ["context"],
    "defaultContext": {
      "templates/email.html": "context/welcome_user.json"
    }
  }
  ```
- **Context Metadata:**
  ```json
  {
    "path": "context/welcome_user.json",
    "label": "Welcome User",
    "lastUsed": "2024-04-18T10:30:00Z"
  }
  ```
- **Renderer Request:**
  ```json
  {
    "templatePath": "templates/email.html",
    "contextPath": "context/welcome_user.json",
    "viewMode": "html"
  }
  ```
- **Renderer Response:**
  ```json
  {
    "rendered": "<html>...</html>",
    "diagnostics": [],
    "durationMs": 120
  }
  ```

## 5. Error Handling & Logging
- Normalize errors into `{ message, severity, location }` objects for consistent UI treatment.
- Display actionable notifications with buttons (e.g., "Open Context", "View Logs").
- Write diagnostic logs to VS Code output channel "Go Template Studio" with log levels (info, warn, error).
- When telemetry is enabled, send aggregated error codes without user data.

## 6. Performance Considerations
- Cache compiled templates per file/context hash in the Go worker to avoid redundant parsing.
- Debounce render requests (e.g., 150ms) while typing to reduce churn.
- Stream large rendered outputs to the WebView in chunks to keep memory usage predictable.
- Target render latency under 300ms for templates under 200 KB.

## 7. Security & Privacy
- Treat context files as untrusted input: sanitize HTML preview by leveraging VS Code's WebView content security policy and escaping dynamic sections.
- Block execution of arbitrary Go template functions beyond safe built-ins unless explicitly opted-in via settings.
- Keep telemetry disabled by default; when enabled, send only feature usage counts without file paths or content.
- Respect VS Code network policy and avoid external calls without user action.

## 8. Packaging & Deployment
- Use `vsce` for packaging; configure semantic versioning (start at `0.1.0`).
- Minimize extension bundle size by compiling TypeScript to ES2019 and tree-shaking dependencies.
- Publish under an open-source license (e.g., MIT) with marketplace listing that clearly states the extension is free.
- Provide sample templates and contexts in the repository `/samples` directory for discoverability.

## 9. Open Technical Questions
- Should the fallback renderer ship in MVP or remain an optional download to minimize bundle size?
- What validation rules should guard custom helper functions when users opt-in to load them from Go binaries?
- Do we need to support remote development containers in MVP or document it as a known limitation?
