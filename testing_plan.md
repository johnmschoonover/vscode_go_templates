# Testing & QA Plan: Go Template Studio for VS Code

## 1. Quality Goals
- Ensure the live preview remains responsive and accurate for typical Go template projects.
- Catch regressions in context management and rendering before publishing marketplace updates.
- Provide confidence that the extension behaves predictably in local and remote development environments.

## 2. Test Environments
- **Primary:** VS Code Stable (>= 1.85) on macOS, Windows, and Ubuntu with Go 1.21 installed.
- **Secondary:** GitHub Codespaces / VS Code Remote Containers with Go preinstalled.
- **Fallback Scenario:** VS Code environment without Go to validate degraded experience messaging.

## 3. Automated Testing
- **Unit Tests (TypeScript) -- implemented:**
  - Harness: [`vitest`](https://vitest.dev) (v2, Node 18+ compatible). Tests live in `test/unit/**/*.test.ts`, outside `src/`, so they are never compiled into `dist/` or shipped in the VSIX (`.vscodeignore` also excludes `test/**`).
  - Commands: `npm run test:unit` (one-shot), `npm run test:unit:watch` (watch mode), `npm run typecheck:test` (type-checks the tests via `tsconfig.test.json`). `npm test` runs the unit suite and then the Go worker tests.
  - Mock strategy: the `vscode` module only exists inside the extension host, so `vitest.config.ts` aliases it to `test/__mocks__/vscode.ts` (and `tsconfig.test.json` maps it for type checking). The mock implements only the API surface the tested modules touch (`Uri`, `Range`, `Position`, `Diagnostic`, `DiagnosticSeverity`, `EventEmitter`, `Disposable`, `RelativePattern`, `FileType`, `languages.createDiagnosticCollection`, `workspace.workspaceFolders/getConfiguration/asRelativePath/fs/createFileSystemWatcher/textDocuments` and document/configuration events, `window.createOutputChannel/createWebviewPanel/activeTextEditor/onDidChangeActiveTextEditor/showTextDocument/setStatusBarMessage`, `ViewColumn`, `commands.executeCommand`). Workspace state is driven through the `__test` helper (virtual in-memory filesystem, workspace root, watcher event simulation, webview panel stubs, active editor changes, executed and failing commands); call `__test.reset()` in `beforeEach`. Extend the mock when a new module comes under test rather than reaching for the real API.
  - Currently covered: `diagnosticService` (severity mapping, 1-based to 0-based positions, Go `template: name:L:C:` message parsing, file routing, clearing), `configurationService` (defaults, partial/malformed config, watcher reloads), `contextAssociationManager` (set/get, default-context fallback, config-change behavior), `ContextStore` in `contextManager` (scan, extension filter, labels, sorting, watchers), `previewLayout` (layout resolution, placement, follow-editor rules), `renderStatus` (renderer fallback detection, status bar and footer wording), `previewManager` (one panel per template, reveal on re-run, `below` layout, follow active editor, close/dispose, renderer mode in render state, HTML template detection, export target fallback, context usage lookup), and `rendererService` (snapshot diagnostics mapped back to the edited files, snapshot cleanup, system fallback arguments and environment; `child_process.spawn` is mocked with `vi.mock`).
  - TODO: cover `rendererService` (argument building / response normalization) and the remaining `previewManager` paths (live re-render scheduling, webview messages, view mode broadcast); enforce the 80% statement coverage target for core services (add `@vitest/coverage-v8` and a threshold) once more services have tests.
- **Integration Tests -- TODO (not implemented):**
  - Use `@vscode/test-electron` to open a sample workspace and verify preview command wiring, WebView messaging, and export outputs. This needs a VS Code download and, on Linux CI, `xvfb-run`, so it is deferred. See `test/integration/README.md` for the intended layout and setup steps.
  - Mock Go worker responses to simulate success/error paths.
  - **TODO(level-3):** Level 3 validation: run the samples in a real VS Code via @vscode/test-electron under Xvfb and screenshot the Extension Development Host. Blocked in the cloud environment until update.code.visualstudio.com is allowed by the network policy.
  - **Webview check (manual, candidate for automation):** the sample previews were checked by hand in headless Chromium. A scratch script built the webview HTML with `PreviewManager` and the `vscode` mock, loaded it with Playwright (CSP left on, `acquireVsCodeApi` stubbed), posted the real worker `render` message for each sample, clicked through the HTML, Text, and Raw toolbar buttons, and took screenshots. Confirmed: the HTML view shows the two HTML samples in the iframe and falls back to Text (with the toolbar note) for `deployment.yaml.tmpl`; Text strips markup; Raw shows markup; the escaped `<script>` value in `welcome.html.tmpl` shows as text and does not run. Turning this into a committed Playwright test would catch webview regressions without a VS Code download.
- **Go Worker Tests:**
  - Standard Go unit tests covering template compilation, context loading, and error normalization (`npm run test:templates`).
  - Sample golden-file tests: `TestSampleTemplatesRender` renders the copies of the sample pairs in `go-worker/testdata/` through `execute` and compares each output byte for byte with `testdata/<sample>.golden`. It also fails when a copy differs from its source in `templates/` or `context/`, checks HTML detection for each sample, and checks that the `welcome` sample escapes its `<script>` value. After changing a sample, run `cd go-worker && go test -run TestSampleTemplatesRender -update` to refresh the copies and goldens, then review the golden diff.
  - Broken-fixture tests: `TestBrokenFixtureDiagnostics` renders deliberately broken fixtures that exist only in `go-worker/testdata/` (`broken.tmpl`, `broken.yaml`, `broken.toml`) and asserts each diagnostic's file, line, and (for TOML) column.
  - CI also enforces `gofmt -l` on the worker sources, skipping the vendored modules in `go-worker/vendor/` (must print nothing), and `go vet ./...`.
  - Include fuzz tests for unsafe template input once MVP stabilizes (post-launch).
- **Packaging Check (CI):**
  - The CI workflow runs `npx @vscode/vsce package` on every push/PR and uploads the resulting VSIX as a workflow artifact (`go-template-studio-vsix`), so manifest or `.vscodeignore` problems are caught before a release. vsce 3.x requires Node 20, so the CI job runs on Node 20. The release workflow remains responsible for bundling per-platform Go binaries.

## 4. Manual Testing
- **Smoke Suite (per release):**
  1. Install extension fresh, ensure activation and command registration.
  2. Open sample template and confirm live preview updates and error messaging.
  3. Create new context file, associate with template, and confirm persistence after reload.
  4. Export rendered output to file and clipboard.
  5. Toggle telemetry opt-in/out and verify no prompts after opt-out.
- **Exploratory Sessions:**
  - Multi-root workspaces with overlapping template names.
  - Large templates (>500 KB) to validate performance messaging.
  - Remote environment latency checks (Codespaces).

## 5. Tooling & Automation
- GitHub Actions workflow running `npm ci`, lint, typecheck, `npm run test:unit`, Go format/vet/tests, and a VSIX packaging check on Linux (integration smoke tests and macOS/Windows runners are still TODO).
- Pre-commit hook (optional) to run linting (`eslint`) and format (`prettier` + `gofmt`).
- Release checklist requiring tests to pass before `vsce publish`.

## 6. Bug Triage & Reporting
- Categorize issues by severity (Critical, High, Medium, Low) and component (Preview, Contexts, Export, Telemetry).
- Maintain public GitHub issue templates for bug reports and feature requests.
- Establish SLA: respond to critical issues within 48 hours post-launch.

## 7. Acceptance Criteria for MVP Launch
- All critical and high severity bugs closed.
- Automated pipeline green on supported platforms.
- Manual smoke suite executed on macOS and Windows.
- Marketplace listing updated with release notes and known limitations.

## 8. Post-Launch Monitoring
- Review anonymous telemetry (if opted-in) weekly for error spikes.
- Monitor marketplace reviews and GitHub issues for regressions.
- Schedule quarterly regression testing focusing on diff/history features as they roll out.
