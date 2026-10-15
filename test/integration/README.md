# Integration tests (TODO)

No integration tests exist yet. This directory is a placeholder describing how
to add them; see `testing_plan.md` section 3.

Unit tests live in `test/unit/` and run under vitest with a mocked `vscode`
module (`test/__mocks__/vscode.ts`). Integration tests are different: they run
inside a real VS Code instance, so they use the real `vscode` API and must not
be picked up by vitest (`vitest.config.ts` only includes `test/unit/**`).

## Suggested setup

1. Add dev dependencies: `@vscode/test-electron`, `mocha`, `@types/mocha`
   (and `glob` if you discover test files dynamically).
2. Add `test/integration/runTest.ts`, which calls `runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [<sample workspace>] })`
   from `@vscode/test-electron`, and `test/integration/suite/index.ts`, which
   configures mocha and loads `*.test.ts` files from the suite.
3. Compile these files with a dedicated tsconfig (for example
   `tsconfig.integration.json` emitting to `out/test/integration`) so they stay
   out of the main `dist/` output and the VSIX. Do not widen the main
   `tsconfig.json`.
4. Add a fixture workspace under `test/integration/fixtures/` containing
   `templates/`, `context/`, and `.vscode/goTemplateStudio.json`.
5. Add an `npm run test:integration` script that compiles and runs `runTest`.
6. Suggested first cases: extension activates and registers
   `goTemplateStudio.*` commands; previewing a fixture template opens the
   webview; selecting a context persists across a reload; diagnostics appear
   for a broken template. Stub the Go worker with a fake binary or response
   fixture so tests do not depend on a Go toolchain.

## CI notes

- The tests download a VS Code build on first run (cache `.vscode-test/`, which
  is already git-ignored).
- On Linux runners wrap the command in `xvfb-run -a npm run test:integration`.
- Add the step to `.github/workflows/ci.yml` after the unit tests, ideally as
  a separate job so a flaky VS Code download does not block the fast checks.
