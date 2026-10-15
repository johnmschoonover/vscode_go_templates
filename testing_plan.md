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
  - Mock strategy: the `vscode` module only exists inside the extension host, so `vitest.config.ts` aliases it to `test/__mocks__/vscode.ts` (and `tsconfig.test.json` maps it for type checking). The mock implements only the API surface the tested modules touch (`Uri`, `Range`, `Position`, `Diagnostic`, `DiagnosticSeverity`, `EventEmitter`, `Disposable`, `RelativePattern`, `FileType`, `languages.createDiagnosticCollection`, `workspace.workspaceFolders/getConfiguration/asRelativePath/fs/createFileSystemWatcher`, `window.createOutputChannel`). Workspace state is driven through the `__test` helper (virtual in-memory filesystem, workspace root, watcher event simulation); call `__test.reset()` in `beforeEach`. Extend the mock when a new module comes under test rather than reaching for the real API.
  - Currently covered: `diagnosticService` (severity mapping, 1-based to 0-based positions, Go `template: name:L:C:` message parsing, file routing, clearing), `configurationService` (defaults, partial/malformed config, watcher reloads), `contextAssociationManager` (set/get, default-context fallback, config-change behavior), and `ContextStore` in `contextManager` (scan, extension filter, labels, sorting, watchers).
  - TODO: cover `rendererService` (argument building / response normalization) and `previewManager` once their pure logic is factored out; enforce the 80% statement coverage target for core services (add `@vitest/coverage-v8` and a threshold) once more services have tests.
- **Integration Tests -- TODO (not implemented):**
  - Use `@vscode/test-electron` to open a sample workspace and verify preview command wiring, WebView messaging, and export outputs. This needs a VS Code download and, on Linux CI, `xvfb-run`, so it is deferred. See `test/integration/README.md` for the intended layout and setup steps.
  - Mock Go worker responses to simulate success/error paths.
- **Go Worker Tests:**
  - Standard Go unit tests covering template compilation, context loading, and error normalization (`npm run test:templates`).
  - CI also enforces `gofmt -l go-worker` (must print nothing) and `go vet ./...`.
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
