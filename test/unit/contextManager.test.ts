import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextStore } from '../../src/context/contextManager';
import type { ConfigurationService, WorkspaceConfiguration } from '../../src/services/configurationService';
import * as vscode from 'vscode';
import { __test } from '../__mocks__/vscode';

const ROOT = '/ws';

function createStore(contextDirs: string[] = ['context']) {
  const emitter = new vscode.EventEmitter<WorkspaceConfiguration>();
  const config: WorkspaceConfiguration = { templateRoots: ['templates'], contextDirs, defaultContext: {} };
  const configurationService = {
    getConfiguration: () => config,
    onDidChangeConfiguration: emitter.event,
  } as unknown as ConfigurationService;

  return {
    store: new ContextStore(configurationService),
    emitConfigChange: (updated: WorkspaceConfiguration) => emitter.fire(updated),
  };
}

describe('ContextStore', () => {
  beforeEach(() => {
    __test.reset();
    __test.setWorkspaceRoot(ROOT);
  });

  it('finds nothing without a workspace folder', async () => {
    __test.setWorkspaceRoot(undefined);
    const { store } = createStore();

    await store.initialize();

    expect(store.getContexts()).toEqual([]);
    expect(__test.watchers).toHaveLength(0);
  });

  it('finds nothing when the configured context directory does not exist', async () => {
    const { store } = createStore(['context']);

    await store.initialize();

    expect(store.getContexts()).toEqual([]);
  });

  it('derives the label from the file name without its extension', async () => {
    __test.writeFile('/ws/context/home.json', '{}');
    __test.writeFile('/ws/context/user.profile.yaml', '');
    const { store } = createStore();

    await store.initialize();

    const labels = Object.fromEntries(store.getContexts().map((c) => [c.relativePath, c.label]));
    expect(labels).toEqual({
      'context/home.json': 'home',
      // only the final extension is stripped
      'context/user.profile.yaml': 'user.profile',
    });
  });

  it('includes only .json, .yaml, .yml and .toml files (case-insensitive extensions)', async () => {
    for (const name of ['a.json', 'b.yaml', 'c.yml', 'd.toml', 'E.JSON', 'notes.md', 'script.js', 'README']) {
      __test.writeFile(`/ws/context/${name}`, '');
    }
    const { store } = createStore();

    await store.initialize();

    expect(store.getContexts().map((c) => c.relativePath)).toEqual([
      'context/a.json',
      'context/b.yaml',
      'context/c.yml',
      'context/d.toml',
      'context/E.JSON',
    ].sort((a, b) => a.localeCompare(b)));
  });

  it('recurses into subdirectories and builds posix relative paths', async () => {
    __test.writeFile('/ws/context/nested/deep/item.json', '{}');
    __test.writeFile('/ws/context/top.json', '{}');
    const { store } = createStore();

    await store.initialize();

    expect(store.getContexts().map((c) => c.relativePath)).toEqual([
      'context/nested/deep/item.json',
      'context/top.json',
    ]);
    const nested = store.getContexts()[0];
    expect(nested.label).toBe('item');
    expect(nested.uri.fsPath).toBe('/ws/context/nested/deep/item.json');
  });

  it('scans every configured context directory and sorts results by relative path', async () => {
    __test.writeFile('/ws/fixtures/zeta.json', '{}');
    __test.writeFile('/ws/context/alpha.json', '{}');
    __test.writeFile('/ws/fixtures/beta.toml', '');
    const { store } = createStore(['fixtures', 'context']);

    await store.initialize();

    expect(store.getContexts().map((c) => c.relativePath)).toEqual([
      'context/alpha.json',
      'fixtures/beta.toml',
      'fixtures/zeta.json',
    ]);
  });

  it('skips a configured path that is a file rather than a directory', async () => {
    __test.writeFile('/ws/context', '{}');
    const { store } = createStore(['context']);

    await store.initialize();

    expect(store.getContexts()).toEqual([]);
  });

  it('fires onDidChange on refresh', async () => {
    const { store } = createStore();
    const listener = vi.fn();
    store.onDidChange(listener);

    await store.refresh();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('registers one watcher per context dir and rescans when files change', async () => {
    __test.writeFile('/ws/context/a.json', '{}');
    const { store } = createStore(['context', 'fixtures']);
    await store.initialize();

    expect(__test.watchers.map((w) => w.__pattern.pattern)).toEqual(['context/**/*', 'fixtures/**/*']);
    expect(store.getContexts()).toHaveLength(1);

    __test.writeFile('/ws/context/b.json', '{}');
    __test.watchers[0].__fire('create');
    await vi.waitFor(() => expect(store.getContexts()).toHaveLength(2));
  });

  it('re-reads configuration and rebuilds watchers when configuration changes', async () => {
    __test.writeFile('/ws/context/a.json', '{}');
    __test.writeFile('/ws/fixtures/b.json', '{}');
    const { store, emitConfigChange } = createStore(['context']);
    await store.initialize();
    const initialWatcher = __test.watchers[0];

    emitConfigChange({ templateRoots: ['templates'], contextDirs: ['fixtures'], defaultContext: {} });

    await vi.waitFor(() => expect(store.getContexts().map((c) => c.relativePath)).toEqual(['fixtures/b.json']));
    expect(initialWatcher.__disposed).toBe(true);
    expect(__test.watchers.at(-1)!.__pattern.pattern).toBe('fixtures/**/*');
  });

  it('disposes its watchers', async () => {
    const { store } = createStore(['context']);
    await store.initialize();

    store.dispose();

    expect(__test.watchers.every((w) => w.__disposed)).toBe(true);
  });
});
