import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DiagnosticService } from '../../src/services/diagnosticService';
import { PreviewManager } from '../../src/services/previewManager';
import type { RendererService, RenderResult } from '../../src/services/rendererService';
import { __test, MockWebviewPanel, ViewColumn } from '../__mocks__/vscode';

const templateA = vscode.Uri.file('/ws/templates/a.tmpl');
const templateB = vscode.Uri.file('/ws/templates/b.tmpl');

class MemoryMemento {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

function renderResult(overrides: Partial<RenderResult> = {}): RenderResult {
  return {
    rendered: '<p>ok</p>',
    diagnostics: [],
    durationMs: 3,
    rendererMode: 'bundled',
    rendererFallback: false,
    ...overrides,
  };
}

type RenderFn = (template: vscode.Uri, context?: vscode.Uri) => Promise<RenderResult>;

function createManager(render: RenderFn = async () => renderResult()) {
  const renderSpy = vi.fn(render);
  const output = vscode.window.createOutputChannel('Go Template Studio');
  const manager = new PreviewManager(
    { render: renderSpy } as unknown as RendererService,
    output,
    new DiagnosticService(),
    new MemoryMemento() as unknown as vscode.Memento
  );
  return { manager, render: renderSpy };
}

function panels(): readonly MockWebviewPanel[] {
  return __test.webviewPanels;
}

function lastPayload(panel: MockWebviewPanel): Record<string, unknown> {
  const message = panel.webview.messages[panel.webview.messages.length - 1] as { payload: Record<string, unknown> };
  return message.payload;
}

describe('PreviewManager', () => {
  beforeEach(() => {
    __test.reset();
    __test.setWorkspaceRoot('/ws');
  });

  describe('one preview per template', () => {
    it('opens a separate panel for each template beside the editor', async () => {
      const { manager } = createManager();
      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath));

      await manager.showPreview(templateA, undefined, 'go-templates');
      await manager.showPreview(templateB, undefined, 'go-templates');

      expect(panels()).toHaveLength(2);
      expect(panels().map((panel) => panel.title)).toEqual(['Preview: a.tmpl', 'Preview: b.tmpl']);
      expect(panels().every((panel) => panel.requestedColumn === ViewColumn.Beside)).toBe(true);
      expect(panels().every((panel) => panel.preserveFocus === true)).toBe(true);
      expect(manager.hasPreview(templateA)).toBe(true);
      expect(manager.hasPreview(templateB)).toBe(true);
    });

    it('reveals the existing panel in its own group when Preview runs again', async () => {
      const { manager, render } = createManager();
      await manager.showPreview(templateA, undefined, 'go-templates');
      const [panel] = panels();
      panel.__setViewState({ visible: false, viewColumn: ViewColumn.Three });

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(panels()).toHaveLength(1);
      expect(panel.reveals).toEqual([{ viewColumn: ViewColumn.Three, preserveFocus: true }]);
      expect(render).toHaveBeenCalledTimes(2);
    });
  });

  describe('layout', () => {
    it('uses the setting until a workspace choice is persisted', async () => {
      const { manager } = createManager();
      expect(manager.getPreviewLayout()).toBe('beside');

      __test.setConfigurationValue('goTemplateStudio.preview.layout', 'below');
      expect(manager.getPreviewLayout()).toBe('below');

      await manager.setPreviewLayout('beside');
      expect(manager.getPreviewLayout()).toBe('beside');
    });

    it('splits the editor down, opens in the new group, and refocuses the template for "below"', async () => {
      const { manager } = createManager();
      const editor = __test.createTextEditor(templateA.fsPath, ViewColumn.One);
      __test.setActiveTextEditor(editor);
      await manager.setPreviewLayout('below');

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(__test.executedCommands.map((call) => call.command)).toEqual(['workbench.action.newGroupBelow']);
      expect(panels()).toHaveLength(1);
      expect(panels()[0].requestedColumn).toBe(ViewColumn.Active);
      expect(__test.shownDocuments).toEqual([
        { document: editor.document, options: { viewColumn: ViewColumn.One, preserveFocus: false } },
      ]);
    });

    it('creates a single panel when Preview is triggered twice while the group is being created', async () => {
      const { manager } = createManager();
      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath));
      await manager.setPreviewLayout('below');

      await Promise.all([
        manager.showPreview(templateA, undefined, 'go-templates'),
        manager.showPreview(templateA, undefined, 'go-templates'),
      ]);

      expect(panels()).toHaveLength(1);
      expect(__test.executedCommands).toHaveLength(1);
    });

    it('falls back to beside when the split command fails', async () => {
      const { manager } = createManager();
      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath));
      __test.failCommand('workbench.action.newGroupBelow');
      await manager.setPreviewLayout('below');

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(panels()[0].requestedColumn).toBe(ViewColumn.Beside);
      expect(__test.shownDocuments).toHaveLength(0);
    });
  });

  describe('follow active editor', () => {
    async function openTwoPreviews() {
      const created = createManager();
      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath));
      await created.manager.showPreview(templateA, undefined, 'go-templates');
      __test.setActiveTextEditor(__test.createTextEditor(templateB.fsPath));
      await created.manager.showPreview(templateB, undefined, 'go-templates');
      const [panelA, panelB] = panels();
      // Both previews share the group beside the editors; B's panel now covers A's.
      panelA.__setViewState({ visible: false });
      return { ...created, panelA, panelB };
    }

    it('reveals the matching preview without taking focus', async () => {
      const { panelA, panelB } = await openTwoPreviews();

      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath));

      expect(panelA.reveals).toEqual([{ viewColumn: ViewColumn.Two, preserveFocus: true }]);
      expect(panelB.reveals).toEqual([]);
    });

    it('does nothing when goTemplateStudio.preview.followActiveEditor is false', async () => {
      const { panelA } = await openTwoPreviews();
      __test.setConfigurationValue('goTemplateStudio.preview.followActiveEditor', false);

      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath));

      expect(panelA.reveals).toEqual([]);
    });

    it('does not cover the editor when the preview sits in the same group', async () => {
      const { panelA } = await openTwoPreviews();

      __test.setActiveTextEditor(__test.createTextEditor(templateA.fsPath, ViewColumn.Two));

      expect(panelA.reveals).toEqual([]);
    });

    it('ignores editors without a preview and focus moving to a non-editor', async () => {
      const { panelA, panelB } = await openTwoPreviews();

      __test.setActiveTextEditor(__test.createTextEditor('/ws/templates/c.tmpl'));
      __test.setActiveTextEditor(undefined);

      expect(panelA.reveals).toEqual([]);
      expect(panelB.reveals).toEqual([]);
    });
  });

  describe('closing', () => {
    it('closePreview disposes the panel, forgets the session, and fires a state change', async () => {
      const { manager } = createManager();
      await manager.showPreview(templateA, undefined, 'go-templates');
      const changes: Array<string | undefined> = [];
      manager.onDidChangeState((uri) => changes.push(uri?.toString()));

      expect(manager.closePreview(templateA)).toBe(true);

      expect(panels()[0].disposed).toBe(true);
      expect(manager.hasPreview(templateA)).toBe(false);
      expect(manager.getRenderState(templateA)).toBeUndefined();
      expect(manager.getRenderSnapshot(templateA)).toBeUndefined();
      expect(changes).toEqual([templateA.toString()]);
      expect(manager.closePreview(templateA)).toBe(false);
    });

    it('opens a fresh panel after the user closes the previous one', async () => {
      const { manager } = createManager();
      await manager.showPreview(templateA, undefined, 'go-templates');
      panels()[0].dispose();

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(panels()).toHaveLength(2);
      expect(manager.hasPreview(templateA)).toBe(true);
    });

    it('drops a render that finishes after the panel closed', async () => {
      let finish: (result: RenderResult) => void = () => undefined;
      const { manager, render } = createManager(
        () =>
          new Promise<RenderResult>((resolve) => {
            finish = resolve;
          })
      );

      const showing = manager.showPreview(templateA, undefined, 'go-templates');
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
      panels()[0].dispose();
      finish(renderResult());

      await expect(showing).resolves.toBeUndefined();
      expect(panels()[0].webview.messages).toEqual([]);
      expect(manager.getRenderState(templateA)).toBeUndefined();
    });

    it('dispose closes every preview', async () => {
      const { manager } = createManager();
      await manager.showPreview(templateA, undefined, 'go-templates');
      await manager.showPreview(templateB, undefined, 'go-templates');

      manager.dispose();

      expect(panels().every((panel) => panel.disposed)).toBe(true);
      expect(manager.hasPreview(templateA)).toBe(false);
    });
  });

  describe('renderer mode', () => {
    it('records the auto -> system fallback in the render state and the footer label', async () => {
      const { manager } = createManager(async () => renderResult({ rendererMode: 'system', rendererFallback: true }));

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(manager.getRenderState(templateA)).toEqual({
        degraded: false,
        rendererMode: 'system',
        rendererFallback: true,
      });
      expect(lastPayload(panels()[0]).rendererLabel).toBe('system Go (auto fallback)');
    });

    it('keeps the renderer mode when the template reports an error', async () => {
      const { manager } = createManager(async () =>
        renderResult({ rendered: '', errorMessage: 'bad template', rendererMode: 'bundled' })
      );

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(manager.getRenderState(templateA)).toEqual({
        degraded: true,
        message: 'bad template',
        rendererMode: 'bundled',
        rendererFallback: false,
      });
      expect(lastPayload(panels()[0]).rendererLabel).toBe('bundled renderer');
    });

    it('reports a failure without a renderer mode when the renderer cannot start', async () => {
      const { manager } = createManager(async () => {
        throw new Error('go: not found');
      });

      await manager.showPreview(templateA, undefined, 'go-templates');

      expect(manager.getRenderState(templateA)).toEqual({ degraded: true, message: 'go: not found' });
    });
  });
});
