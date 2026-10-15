import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from './services/configurationService';
import { RendererService } from './services/rendererService';
import { ContextStore } from './context/contextManager';
import { ContextTreeDataProvider } from './context/contextTreeDataProvider';
import { ContextAssociationManager } from './context/contextAssociationManager';
import { registerContextCommands, resolveContextTarget } from './context/contextCommands';
import { isViewMode, PreviewManager, VIEW_MODE_LABELS, ViewMode } from './services/previewManager';
import { DiagnosticService } from './services/diagnosticService';
import { ExportService } from './services/exportService';
import { PREVIEW_LAYOUT_LABELS, PREVIEW_LAYOUTS, PreviewLayout } from './services/previewLayout';
import { describeRenderStatus } from './services/renderStatus';

const TEMPLATE_LANGUAGE_IDS = ['go-templates', 'gotemplate'];
const TEMPLATE_EXTENSIONS = ['.tmpl', '.tpl', '.gotmpl'];

function isTemplateDocument(document: vscode.TextDocument): boolean {
  if (TEMPLATE_LANGUAGE_IDS.includes(document.languageId)) {
    return true;
  }
  const lowerPath = document.uri.path.toLowerCase();
  return TEMPLATE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

function asUri(value: unknown): vscode.Uri | undefined {
  return value instanceof vscode.Uri ? value : undefined;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Go Template Studio');
  context.subscriptions.push(outputChannel);

  const configurationService = new ConfigurationService();
  context.subscriptions.push(configurationService);
  await configurationService.initialize();

  const contextStore = new ContextStore(configurationService);
  context.subscriptions.push(contextStore);
  await contextStore.initialize();

  const treeDataProvider = new ContextTreeDataProvider(contextStore);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('goTemplateStudio.contextExplorer', treeDataProvider)
  );

  const rendererService = new RendererService(context, outputChannel);
  const associationManager = new ContextAssociationManager(configurationService, contextStore, outputChannel);
  context.subscriptions.push(associationManager);
  const diagnosticService = new DiagnosticService();
  context.subscriptions.push(diagnosticService);

  const previewManager = new PreviewManager(
    rendererService,
    outputChannel,
    diagnosticService,
    context.workspaceState
  );

  context.subscriptions.push(previewManager);

  const exportService = new ExportService(outputChannel);
  registerContextStatusBar(context, associationManager, contextStore, previewManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.showWelcome', async () => {
      const selection = await vscode.window.showInformationMessage(
        'Go Template Studio scaffolding is ready. Review the project docs for the MVP plan.',
        'Open PRD',
        'Open Technical Spec',
        'Buy me a coffee'
      );

      if (selection === 'Open PRD') {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(context.extensionUri, 'PRD.md'));
      } else if (selection === 'Open Technical Spec') {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(context.extensionUri, 'technical_spec.md'));
      } else if (selection === 'Buy me a coffee') {
        void vscode.env.openExternal(vscode.Uri.parse('https://buymeacoffee.com/johnmschoonover'));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.refreshContexts', async () => {
      await contextStore.refresh();
      treeDataProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.openContextFile', async (target?: unknown) => {
      // Accepts a Uri (tree item click), a ContextTreeItem (view context menu), or nothing (palette).
      const descriptor = await resolveContextTarget(contextStore, target, 'Select a context file to open');
      if (!descriptor) {
        return;
      }
      const document = await vscode.workspace.openTextDocument(descriptor.uri);
      await vscode.window.showTextDocument(document, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.selectContext', async (target?: unknown) => {
      // The status bar item passes the template URI; from the palette, fall back to the active editor and
      // then to the focused preview panel (which has no text editor).
      const templateUri =
        asUri(target) ?? vscode.window.activeTextEditor?.document.uri ?? previewManager.getFocusedPreviewTemplate();
      if (!templateUri) {
        void vscode.window.showWarningMessage('Open a Go template file before selecting a context.');
        return;
      }

      const contexts = associationManager.listContexts();
      if (contexts.length === 0) {
        void vscode.window.showWarningMessage('No context files found. Add a file to the configured context directories.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        contexts.map((item) => ({
          label: item.label,
          description: item.relativePath,
          item,
        })),
        {
          placeHolder: 'Select a context file',
        }
      );

      if (!pick) {
        return;
      }

      associationManager.setActiveContext(templateUri, pick.item);
      await previewManager.updateContext(templateUri, pick.item.uri);
      void vscode.window.showInformationMessage(`Context set to ${pick.item.relativePath}`);
    })
  );

  /**
   * Opens (or reveals) the preview for `editor`'s document. Prompts for a context when the template has
   * no association and no open preview (re-running Preview just reveals the existing panel); returns
   * false when the user dismisses that prompt.
   */
  const openPreviewForEditor = async (editor: vscode.TextEditor): Promise<boolean> => {
    const templateUri = editor.document.uri;
    let activeContext = associationManager.getActiveContext(templateUri);
    let contextUri: vscode.Uri | undefined = activeContext?.uri;
    if (!activeContext && !previewManager.hasPreview(templateUri)) {
      const contexts = associationManager.listContexts();
      if (contexts.length === 0) {
        void vscode.window.setStatusBarMessage(
          'Go Template Studio: Rendering with empty context.',
          5000
        );
      } else {
        const pick = await vscode.window.showQuickPick(
          [
            {
              label: 'Render without context',
              description: 'Use an empty object for template data',
              item: undefined,
            },
            ...contexts.map((item) => ({
              label: item.label,
              description: item.relativePath,
              item,
            })),
          ],
          {
            placeHolder: 'Select a context file for rendering',
          }
        );

        if (!pick) {
          return false;
        }

        if (pick.item) {
          activeContext = pick.item;
          contextUri = activeContext.uri;
          associationManager.setActiveContext(templateUri, activeContext);
        } else {
          contextUri = undefined;
        }
      }
    }

    await previewManager.showPreview(templateUri, contextUri, editor.document.languageId);
    return true;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.preview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a Go template to preview.');
        return;
      }

      await openPreviewForEditor(editor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.toggleSideBySidePreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        // A focused preview panel has no text editor; toggling from it closes that preview.
        const focusedTemplate = previewManager.getFocusedPreviewTemplate();
        if (focusedTemplate) {
          previewManager.closePreview(focusedTemplate);
        } else {
          void vscode.window.showWarningMessage('Open a Go template to toggle its preview.');
        }
        return;
      }

      if (previewManager.closePreview(editor.document.uri)) {
        return;
      }
      await openPreviewForEditor(editor);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.setPreviewLayout', async () => {
      const current = previewManager.getPreviewLayout();
      const descriptions: Record<PreviewLayout, string> = {
        beside: 'Open the preview in an editor group to the side of the template',
        below: 'Open the preview in a new editor group below the template',
      };
      const pick = await vscode.window.showQuickPick(
        PREVIEW_LAYOUTS.map((layout) => ({
          label: PREVIEW_LAYOUT_LABELS[layout],
          description: layout === current ? '(current)' : undefined,
          detail: descriptions[layout],
          layout,
        })),
        {
          placeHolder: 'Where should new Go template previews open? (remembered for this workspace)',
        }
      );
      if (!pick) {
        return;
      }

      await previewManager.setPreviewLayout(pick.layout);
      void vscode.window.setStatusBarMessage(
        `Go Template Studio: Preview layout: ${PREVIEW_LAYOUT_LABELS[pick.layout]} (applies to newly opened previews)`,
        4000
      );
    })
  );

  context.subscriptions.push(
    ...registerContextCommands({
      contextStore,
      associationManager,
      output: outputChannel,
      onDidAssociate: (templateUri, descriptor) => previewManager.updateContext(templateUri, descriptor.uri),
      onDidDelete: async (descriptor) => {
        await Promise.all(
          previewManager
            .getTemplatesUsingContext(descriptor.uri)
            .map((templateUri) => previewManager.updateContext(templateUri, undefined))
        );
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.exportOutput', async (target?: unknown) => {
      // editor/title passes the template URI; the palette passes nothing and uses the active preview.
      const templateUri = asUri(target);
      let snapshot = previewManager.getRenderSnapshot(templateUri);
      if (!snapshot && !templateUri) {
        // Several previews and none of them active: let the user choose which render to export.
        const rendered = previewManager.getRenderedTemplates();
        if (rendered.length > 1) {
          const pick = await vscode.window.showQuickPick(
            rendered.map((uri) => ({
              label: path.basename(uri.fsPath),
              description: vscode.workspace.asRelativePath(uri, false),
              uri,
            })),
            { placeHolder: 'Select the preview to export' }
          );
          if (!pick) {
            return;
          }
          snapshot = previewManager.getRenderSnapshot(pick.uri);
        }
      }
      await exportService.exportRendered(snapshot);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.refreshPreview', async (target?: unknown) => {
      const refreshed = await previewManager.refresh(asUri(target));
      if (!refreshed) {
        void vscode.window.showWarningMessage('Open a Go template preview before refreshing it.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.toggleViewMode', async (mode?: unknown) => {
      // Keybindings may pass an explicit mode ("html" | "text" | "raw"); otherwise cycle modes.
      let next: ViewMode;
      if (isViewMode(mode)) {
        await previewManager.setViewMode(mode);
        next = mode;
      } else {
        next = await previewManager.cycleViewMode();
      }
      void vscode.window.setStatusBarMessage(`Go Template Studio: Preview view mode: ${VIEW_MODE_LABELS[next]}`, 3000);
    })
  );
}

/**
 * Left-aligned status bar item showing the active context for the focused template (or the template
 * behind the focused preview panel). Adds a warning icon when the last render failed (with a warning
 * background, since the preview fell back to its last successful output) or when `auto` renderer mode
 * fell back to the system Go toolchain because no bundled renderer is available.
 */
function registerContextStatusBar(
  context: vscode.ExtensionContext,
  associationManager: ContextAssociationManager,
  contextStore: ContextStore,
  previewManager: PreviewManager
): void {
  const item = vscode.window.createStatusBarItem('goTemplateStudio.activeContext', vscode.StatusBarAlignment.Left, 100);
  item.name = 'Go Template Studio: Active Context';
  context.subscriptions.push(item);

  const resolveTemplate = (): vscode.Uri | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = editor.document.uri;
      return isTemplateDocument(editor.document) || previewManager.hasPreview(uri) ? uri : undefined;
    }
    return previewManager.getFocusedPreviewTemplate();
  };

  const update = (): void => {
    const templateUri = resolveTemplate();
    if (!templateUri) {
      item.hide();
      return;
    }

    const activeContext = associationManager.getActiveContext(templateUri);
    const label = activeContext ? activeContext.relativePath : 'No context';
    const status = describeRenderStatus(
      previewManager.getRenderState(templateUri),
      Boolean(previewManager.getRenderSnapshot(templateUri))
    );

    item.text = `$(json) ${label}${status.warning ? ' $(warning)' : ''}`;
    item.tooltip = [
      `Go Template Studio context: ${label}`,
      ...status.tooltipLines,
      'Click to select a different context.',
    ].join('\n');
    item.backgroundColor = status.warningBackground
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    item.accessibilityInformation = {
      label: `Go Template Studio context: ${label}${status.accessibilityNote ? `. ${status.accessibilityNote}` : ''}`,
    };
    item.command = {
      command: 'goTemplateStudio.selectContext',
      title: 'Select Context',
      arguments: [templateUri],
    };
    item.show();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => update()),
    associationManager.onDidChange(() => update()),
    contextStore.onDidChange(() => update()),
    previewManager.onDidChangeState(() => update())
  );
  update();
}

export function deactivate(): void {
  // No-op: the extension disposes resources through VS Code subscriptions.
}
