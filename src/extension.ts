import * as vscode from 'vscode';
import { ConfigurationService } from './services/configurationService';
import { RendererService } from './services/rendererService';
import { ContextStore } from './context/contextManager';
import { ContextTreeDataProvider } from './context/contextTreeDataProvider';
import { ContextAssociationManager } from './context/contextAssociationManager';

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

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.showWelcome', async () => {
      const selection = await vscode.window.showInformationMessage(
        'Go Template Studio scaffolding is ready. Review the project docs for the MVP plan.',
        'Open PRD',
        'Open Technical Spec'
      );

      if (selection === 'Open PRD') {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(context.extensionUri, 'PRD.md'));
      } else if (selection === 'Open Technical Spec') {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(context.extensionUri, 'technical_spec.md'));
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
    vscode.commands.registerCommand('goTemplateStudio.openContextFile', async (uri: vscode.Uri) => {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.selectContext', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
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

      associationManager.setActiveContext(editor.document.uri, pick.item);
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
            contexts.map((item) => ({
              label: item.label,
              description: item.relativePath,
              item,
            })),
            {
              placeHolder: 'Select a context file for rendering',
            }
          );

          if (!pick) {
            return;
          }

          activeContext = pick.item;
          contextUri = activeContext.uri;
          associationManager.setActiveContext(templateUri, activeContext);
        }
      }

      if (activeContext) {
        contextUri = activeContext.uri;
      }

      try {
        const result = await rendererService.render(templateUri, contextUri);
        const document = await vscode.workspace.openTextDocument({
          content: result.rendered,
          language: editor.document.languageId === 'gotemplate' ? 'html' : editor.document.languageId,
        });
        await vscode.window.showTextDocument(document, { preview: true });

        if (result.diagnostics.length > 0) {
          const detail = result.diagnostics.map((diag) => `• ${diag.message}`).join('\n');
          void vscode.window.showWarningMessage(`Render completed with diagnostics:\n${detail}`);
        } else {
          void vscode.window.setStatusBarMessage(
            `Go Template Studio: Rendered in ${result.durationMs} ms`,
            5000
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to render template: ${message}`);
      }
    })
  );
}

export function deactivate(): void {
  // No-op: the extension disposes resources through VS Code subscriptions.
}
