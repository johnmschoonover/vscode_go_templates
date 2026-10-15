import { EventEmitter } from 'events';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { remapSnapshotDiagnostics, RendererService } from '../../src/services/rendererService';
import { __test } from '../__mocks__/vscode';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('child_process', () => ({ spawn: spawnMock }));

interface SpawnCall {
  readonly command: string;
  readonly args: string[];
  readonly options: { cwd?: string; env?: NodeJS.ProcessEnv };
  /** Whether each `--template`/`--context` file existed while the worker ran. */
  readonly existed: Record<string, boolean>;
}

/** Replaces the Go worker: records the call and replies with `respond(args)` as JSON on stdout. */
function fakeWorker(respond: (args: string[]) => unknown): SpawnCall[] {
  const calls: SpawnCall[] = [];
  spawnMock.mockImplementation((command: string, args: string[], options: SpawnCall['options']) => {
    const flagValue = (flag: string): string | undefined => {
      const index = args.indexOf(flag);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const existed: Record<string, boolean> = {};
    for (const flag of ['--template', '--context']) {
      const value = flagValue(flag);
      if (value) {
        existed[flag] = existsSync(value);
      }
    }
    calls.push({ command, args, options, existed });

    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify(respond(args))));
      child.emit('close', 0);
    });
    return child;
  });
  return calls;
}

function dirtyDocument(fsPath: string, text: string) {
  return { uri: vscode.Uri.file(fsPath), isDirty: true, getText: () => text };
}

function createService(): RendererService {
  const context = { extensionUri: vscode.Uri.file('/nonexistent/extension') } as unknown as vscode.ExtensionContext;
  return new RendererService(context, vscode.window.createOutputChannel('Go Template Studio') as unknown as vscode.OutputChannel);
}

const flag = (call: SpawnCall, name: string): string => call.args[call.args.indexOf(name) + 1];

describe('remapSnapshotDiagnostics', () => {
  it('maps snapshot paths back to the original documents and leaves other files alone', () => {
    const snapshots = new Map([
      ['/tmp/go-template-preview-1/a.tmpl', '/ws/templates/a.tmpl'],
      ['/tmp/go-template-preview-2/data.yaml', '/ws/context/data.yaml'],
    ]);

    const result = remapSnapshotDiagnostics(
      [
        { message: 'template', severity: 'error', file: '/tmp/go-template-preview-1/a.tmpl', line: 2 },
        { message: 'context', severity: 'error', file: '/tmp/go-template-preview-2/data.yaml', line: 3 },
        { message: 'other', severity: 'warning', file: '/ws/templates/partial.tmpl' },
        { message: 'no file', severity: 'error' },
      ],
      snapshots
    );

    expect(result.map((diag) => diag.file)).toEqual([
      '/ws/templates/a.tmpl',
      '/ws/context/data.yaml',
      '/ws/templates/partial.tmpl',
      undefined,
    ]);
    expect(result[0]).toMatchObject({ message: 'template', line: 2 });
  });

  it('matches paths that differ only in normalization', () => {
    const result = remapSnapshotDiagnostics(
      [{ message: 'x', severity: 'error', file: '/tmp/snap/./a.tmpl' }],
      new Map([['/tmp/snap/a.tmpl', '/ws/a.tmpl']])
    );
    expect(result[0].file).toBe('/ws/a.tmpl');
  });
});

describe('RendererService.render', () => {
  const TEMP_VARIABLES = ['TMPDIR', 'TEMP', 'TMP'] as const;
  let tempRoot: string;
  let savedTemp: Array<string | undefined>;

  beforeEach(async () => {
    __test.reset();
    spawnMock.mockReset();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'renderer-service-test-'));
    // Point os.tmpdir() at a private directory so leftover snapshot directories are detectable.
    savedTemp = TEMP_VARIABLES.map((name) => process.env[name]);
    TEMP_VARIABLES.forEach((name) => {
      process.env[name] = tempRoot;
    });
  });

  afterEach(async () => {
    TEMP_VARIABLES.forEach((name, index) => {
      const value = savedTemp[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('reports diagnostics for unsaved documents on the original files and removes the snapshots', async () => {
    const templatePath = path.join(tempRoot, 'ws', 'page.html.tmpl');
    const contextPath = path.join(tempRoot, 'ws', 'data.yaml');
    __test.setTextDocuments([dirtyDocument(templatePath, '{{ .Title'), dirtyDocument(contextPath, 'Title: [')]);
    const calls = fakeWorker((args) => ({
      error: 'parse failed',
      diagnostics: [
        { message: 'template: page.html.tmpl:1: unclosed action', severity: 'error', file: args[args.indexOf('--template') + 1], line: 1 },
        { message: 'failed to parse context YAML', severity: 'error', file: args[args.indexOf('--context') + 1], line: 1 },
      ],
    }));

    const result = await createService().render(vscode.Uri.file(templatePath), vscode.Uri.file(contextPath));

    expect(calls).toHaveLength(1);
    const snapshotTemplate = flag(calls[0], '--template');
    const snapshotContext = flag(calls[0], '--context');
    expect(snapshotTemplate).not.toBe(templatePath);
    expect(path.basename(snapshotTemplate)).toBe('page.html.tmpl');
    expect(calls[0].existed).toEqual({ '--template': true, '--context': true });
    expect(result.diagnostics.map((diag) => diag.file)).toEqual([templatePath, contextPath]);
    expect(existsSync(path.dirname(snapshotTemplate))).toBe(false);
    expect(existsSync(path.dirname(snapshotContext))).toBe(false);
    expect((await fs.readdir(tempRoot)).filter((name) => name.startsWith('go-template-preview-'))).toEqual([]);
  });

  it('passes saved documents through unchanged', async () => {
    const templatePath = '/ws/templates/a.tmpl';
    const calls = fakeWorker((args) => ({
      error: 'boom',
      diagnostics: [{ message: 'boom', severity: 'error', file: args[args.indexOf('--template') + 1] }],
    }));

    const result = await createService().render(vscode.Uri.file(templatePath));

    expect(flag(calls[0], '--template')).toBe(templatePath);
    expect(calls[0].args).not.toContain('--context');
    expect(result.diagnostics[0].file).toBe(templatePath);
  });

  it('runs the system fallback from go-worker/vendor with GOWORK=off', async () => {
    const calls = fakeWorker(() => ({ rendered: 'ok' }));

    const result = await createService().render(vscode.Uri.file('/ws/templates/a.tmpl'));

    expect(result).toMatchObject({ rendered: 'ok', rendererMode: 'system', rendererFallback: true });
    expect(calls[0].command).toBe('go');
    expect(calls[0].args.slice(0, 3)).toEqual(['run', '-mod=vendor', '.']);
    expect(calls[0].options.cwd).toBe('/nonexistent/extension/go-worker');
    expect(calls[0].options.env?.GOWORK).toBe('off');
    expect(calls[0].options.env?.PATH).toBe(process.env.PATH);
  });

  it('removes the template snapshot when the worker fails', async () => {
    const templatePath = path.join(tempRoot, 'ws', 'a.tmpl');
    __test.setTextDocuments([dirtyDocument(templatePath, 'x')]);
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    await expect(createService().render(vscode.Uri.file(templatePath))).rejects.toThrow('spawn failed');

    expect((await fs.readdir(tempRoot)).filter((name) => name.startsWith('go-template-preview-'))).toEqual([]);
  });
});
