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
- **Unit Tests (TypeScript):**
  - Run via `npm test` using `vitest` or `mocha` with `ts-node` for services (context manager, configuration, telemetry wrapper).
  - Target coverage: 80% statements for core services.
- **Integration Tests:**
  - Use `@vscode/test-electron` to open a sample workspace and verify preview command wiring, WebView messaging, and export outputs.
  - Mock Go worker responses to simulate success/error paths.
- **Go Worker Tests:**
  - Standard Go unit tests covering template compilation, context loading, and error normalization.
  - Include fuzz tests for unsafe template input once MVP stabilizes (post-launch).

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
- GitHub Actions workflow running `npm install`, `npm test`, `go test ./...`, and integration smoke tests on macOS/Linux.
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
