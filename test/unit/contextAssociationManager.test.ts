import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ContextAssociationManager } from '../../src/context/contextAssociationManager';
import { contextFormatFromFileName } from '../../src/context/contextManager';
import type { ContextDescriptor, ContextStore } from '../../src/context/contextManager';
import type { ConfigurationService, WorkspaceConfiguration } from '../../src/services/configurationService';
import { __test } from '../__mocks__/vscode';

const ROOT = '/ws';

function descriptor(relativePath: string): ContextDescriptor {
  return {
    uri: vscode.Uri.file(`${ROOT}/${relativePath}`),
    label: relativePath.replace(/^.*\//, '').replace(/\.[^.]+$/, ''),
    relativePath,
    format: contextFormatFromFileName(relativePath) ?? 'json',
  };
}

function templateUri(relativePath: string): vscode.Uri {
  return vscode.Uri.file(`${ROOT}/${relativePath}`);
}

interface Harness {
  manager: ContextAssociationManager;
  output: vscode.OutputChannel & { lines: string[] };
  emitConfigChange(defaultContext: Record<string, string>): void;
}

function createHarness(defaultContext: Record<string, string>, contexts: ContextDescriptor[]): Harness {
  const emitter = new vscode.EventEmitter<WorkspaceConfiguration>();
  const configurationService = {
    getConfiguration: (): WorkspaceConfiguration => ({
      templateRoots: ['templates'],
      contextDirs: ['context'],
      defaultContext,
    }),
    onDidChangeConfiguration: emitter.event,
  } as unknown as ConfigurationService;
  const contextStore = { getContexts: () => contexts } as unknown as ContextStore;
  const output = vscode.window.createOutputChannel('test') as unknown as Harness['output'];

  return {
    manager: new ContextAssociationManager(configurationService, contextStore, output),
    output,
    emitConfigChange: (updated) =>
      emitter.fire({ templateRoots: ['templates'], contextDirs: ['context'], defaultContext: updated }),
  };
}

describe('ContextAssociationManager', () => {
  const home = descriptor('context/home.json');
  const other = descriptor('context/other.yaml');

  beforeEach(() => {
    __test.reset();
    __test.setWorkspaceRoot(ROOT);
  });

  describe('getActiveContext', () => {
    it('returns undefined when the template has no association', () => {
      const { manager } = createHarness({}, [home]);

      expect(manager.getActiveContext(templateUri('templates/page.tmpl'))).toBeUndefined();
    });

    it('falls back to the defaultContext mapping from configuration', () => {
      const { manager } = createHarness({ 'templates/page.tmpl': 'context/home.json' }, [home, other]);

      expect(manager.getActiveContext(templateUri('templates/page.tmpl'))).toBe(home);
    });

    it('normalizes Windows-style separators in configured template paths', () => {
      const { manager } = createHarness({ 'templates\\page.tmpl': 'context/home.json' }, [home]);

      expect(manager.getActiveContext(templateUri('templates/page.tmpl'))).toBe(home);
    });

    it('returns undefined when the configured context is not in the store', () => {
      const { manager } = createHarness({ 'templates/page.tmpl': 'context/missing.json' }, [home]);

      expect(manager.getActiveContext(templateUri('templates/page.tmpl'))).toBeUndefined();
    });

    it('returns undefined for templates outside the workspace', () => {
      const { manager } = createHarness({ '../outside/page.tmpl': 'context/home.json' }, [home]);

      expect(manager.getActiveContext(vscode.Uri.file('/elsewhere/page.tmpl'))).toBeUndefined();
    });

    it('returns undefined when there is no workspace', () => {
      __test.setWorkspaceRoot(undefined);
      const { manager } = createHarness({ 'templates/page.tmpl': 'context/home.json' }, [home]);

      // With no workspace asRelativePath returns the absolute path, which never matches.
      expect(manager.getActiveContext(templateUri('templates/page.tmpl'))).toBeUndefined();
    });
  });

  describe('setActiveContext', () => {
    it('stores the association and returns it from getActiveContext', () => {
      const { manager } = createHarness({}, [home, other]);
      const template = templateUri('templates/page.tmpl');

      manager.setActiveContext(template, other);

      expect(manager.getActiveContext(template)).toBe(other);
    });

    it('overrides the default association from configuration', () => {
      const { manager } = createHarness({ 'templates/page.tmpl': 'context/home.json' }, [home, other]);
      const template = templateUri('templates/page.tmpl');

      manager.setActiveContext(template, other);

      expect(manager.getActiveContext(template)).toBe(other);
    });

    it('keeps associations independent per template', () => {
      const { manager } = createHarness({}, [home, other]);
      const a = templateUri('templates/a.tmpl');
      const b = templateUri('templates/b.tmpl');

      manager.setActiveContext(a, home);
      manager.setActiveContext(b, other);

      expect(manager.getActiveContext(a)).toBe(home);
      expect(manager.getActiveContext(b)).toBe(other);
    });

    it('logs the association to the output channel', () => {
      const { manager, output } = createHarness({}, [home]);

      manager.setActiveContext(templateUri('templates/page.tmpl'), home);

      expect(output.lines).toEqual(['[context] templates/page.tmpl -> context/home.json']);
    });
  });

  describe('configuration changes', () => {
    it('adds new defaultContext entries when configuration changes', () => {
      const { manager, emitConfigChange } = createHarness({}, [home]);
      const template = templateUri('templates/page.tmpl');
      expect(manager.getActiveContext(template)).toBeUndefined();

      emitConfigChange({ 'templates/page.tmpl': 'context/home.json' });

      expect(manager.getActiveContext(template)).toBe(home);
    });

    it('does not clobber an association that already exists (user choice wins over reloaded config)', () => {
      const { manager, emitConfigChange } = createHarness({}, [home, other]);
      const template = templateUri('templates/page.tmpl');
      manager.setActiveContext(template, other);

      emitConfigChange({ 'templates/page.tmpl': 'context/home.json' });

      expect(manager.getActiveContext(template)).toBe(other);
    });
  });

  it('listContexts proxies the context store', () => {
    const { manager } = createHarness({}, [home, other]);

    expect(manager.listContexts()).toEqual([home, other]);
  });

  describe('clearContext', () => {
    it('removes every association to the context, including defaults, and fires one change', () => {
      const { manager } = createHarness({ 'templates/a.tmpl': 'context/home.json' }, [home, other]);
      manager.setActiveContext(templateUri('templates/b.tmpl'), home);
      manager.setActiveContext(templateUri('templates/c.tmpl'), other);
      const changes: Array<vscode.Uri | undefined> = [];
      manager.onDidChange((uri) => changes.push(uri));

      expect(manager.clearContext(home)).toBe(2);

      expect(manager.getActiveContext(templateUri('templates/a.tmpl'))).toBeUndefined();
      expect(manager.getActiveContext(templateUri('templates/b.tmpl'))).toBeUndefined();
      expect(manager.getActiveContext(templateUri('templates/c.tmpl'))).toBe(other);
      expect(changes).toEqual([undefined]);
    });

    it('does nothing when no template uses the context', () => {
      const { manager } = createHarness({}, [home, other]);
      manager.setActiveContext(templateUri('templates/c.tmpl'), other);
      const changes: Array<vscode.Uri | undefined> = [];
      manager.onDidChange((uri) => changes.push(uri));

      expect(manager.clearContext(home)).toBe(0);
      expect(changes).toEqual([]);
    });
  });
});
