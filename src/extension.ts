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
      // The status bar item passes the template URI so selection still works while the preview has focus.
      const templateUri = asUri(target) ?? vscode.window.activeTextEditor?.document.uri;
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

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.preview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a Go template to preview.');
        return;
      }

      const templateUri = editor.document.uri;
      let activeContext = associationManager.getActiveContext(templateUri);
      let contextUri: vscode.Uri | undefined = activeContext?.uri;
      if (!activeContext) {
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
            return;
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
    })
  );

  context.subscriptions.push(
    ...registerContextCommands({
      contextStore,
      associationManager,
      output: outputChannel,
      onDidAssociate: (templateUri, descriptor) => previewManager.updateContext(templateUri, descriptor.uri),
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.exportOutput', async (target?: unknown) => {
      // editor/title passes the template URI; the palette passes nothing and uses the active preview.
      await exportService.exportRendered(previewManager.getRenderSnapshot(asUri(target)));
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
 * behind the focused preview panel). Adds a warning icon when the last render failed and the preview
 * fell back to its last successful output.
 *
 * TODO(status-bar): also flag renderer degradation (e.g. auto mode falling back from the bundled worker
 * to `go run`) once RendererService surfaces the resolved renderer mode in RenderResult.
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
    const state = previewManager.getRenderState(templateUri);
    const degraded = Boolean(state?.degraded);

    item.text = `$(json) ${label}${degraded ? ' $(warning)' : ''}`;
    const tooltipLines = [`Go Template Studio context: ${label}`];
    if (degraded) {
      const fallbackNote = previewManager.getRenderSnapshot(templateUri)
        ? ' The preview is showing the last successful output.'
        : '';
      tooltipLines.push(`Last render failed${state?.message ? `: ${state.message}` : ''}.${fallbackNote}`);
    }
    tooltipLines.push('Click to select a different context.');
    item.tooltip = tooltipLines.join('\n');
    item.backgroundColor = degraded ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    item.accessibilityInformation = {
      label: `Go Template Studio context: ${label}${degraded ? '. Last render failed.' : ''}`,
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
