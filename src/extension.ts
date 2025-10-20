import * as vscode from 'vscode';
import { PreviewManager } from './panels/previewManager';
import { ContextManager } from './tree/contextManager';
import { RendererService } from './services/rendererService';
import { ConfigurationService } from './services/configurationService';
import { TelemetryService } from './services/telemetryService';
import { ExportService } from './services/exportService';
import { Logger } from './services/logger';

let previewManager: PreviewManager | undefined;
let contextManager: ContextManager | undefined;
let telemetry: TelemetryService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  const config = new ConfigurationService(logger);
  telemetry = new TelemetryService(context, logger);
  const renderer = new RendererService(logger);
  const exporter = new ExportService(logger);
  contextManager = new ContextManager(config, logger);
  previewManager = new PreviewManager(context.extensionUri, renderer, config, telemetry, exporter, logger);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('goTemplateStudio.contexts', contextManager)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.refreshContexts', () => contextManager?.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.preview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a Go template to preview it.');
        return;
      }
      await previewManager?.openPreview(editor.document.uri);
      telemetry?.recordEvent('previewOpened');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.selectContext', async (resource?: vscode.Uri) => {
      const target = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showInformationMessage('Open a Go template to select a context.');
        return;
      }
      const picked = await contextManager?.pickContext(target);
      if (picked) {
        await previewManager?.updateContext(target, picked);
        telemetry?.recordEvent('contextSelected');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('goTemplateStudio.export', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a Go template to export its preview.');
        return;
      }
      await previewManager?.exportRendered(editor.document.uri);
      telemetry?.recordEvent('exported');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('goTemplateStudio')) {
        config.invalidate();
        contextManager?.refresh();
        previewManager?.refreshActivePreviews();
      }
    })
  );

  await contextManager.refresh();
  logger.info('Go Template Studio activated.');
}

export function deactivate(): void {
  previewManager?.dispose();
  contextManager?.dispose();
  telemetry?.dispose();
}
