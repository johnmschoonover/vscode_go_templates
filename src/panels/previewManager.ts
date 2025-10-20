import * as vscode from 'vscode';
import { ConfigurationService } from '../services/configurationService';
import { ExportService } from '../services/exportService';
import { Logger } from '../services/logger';
import { RenderResponse, RendererService } from '../services/rendererService';
import { TelemetryService } from '../services/telemetryService';

interface PreviewState {
  panel: vscode.WebviewPanel;
  template: vscode.Uri;
  context?: vscode.Uri;
  viewMode: 'html' | 'text';
  rendered?: RenderResponse;
}

export class PreviewManager {
  private readonly previews = new Map<string, PreviewState>();

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly renderer: RendererService,
    private readonly configuration: ConfigurationService,
    private readonly telemetry: TelemetryService | undefined,
    private readonly exporter: ExportService,
    private readonly logger: Logger
  ) {}

  public async openPreview(templateUri: vscode.Uri): Promise<void> {
    const key = templateUri.toString();
    let preview = this.previews.get(key);

    if (!preview) {
      const panel = vscode.window.createWebviewPanel(
        'goTemplatePreview',
        `Preview: ${vscode.workspace.asRelativePath(templateUri, false)}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri]
        }
      );
      preview = { panel, template: templateUri, viewMode: 'html' };
      this.previews.set(key, preview);
      this.registerPanelListeners(preview);
    }

    await this.updatePreview(preview);
    preview.panel.reveal(vscode.ViewColumn.Beside);
  }

  public async updateContext(templateUri: vscode.Uri, contextUri: vscode.Uri): Promise<void> {
    const preview = this.previews.get(templateUri.toString());
    if (!preview) {
      await this.openPreview(templateUri);
      return;
    }
    preview.context = contextUri;
    await this.updatePreview(preview);
  }

  public async exportRendered(templateUri: vscode.Uri): Promise<void> {
    const preview = this.previews.get(templateUri.toString());
    if (!preview?.rendered) {
      vscode.window.showWarningMessage('Render the template before exporting.');
      return;
    }

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: templateUri.with({ path: templateUri.path.replace(/\.[^.]+$/, '.html') }),
      filters: { 'HTML Files': ['html'], 'All Files': ['*'] }
    });

    if (!saveUri) {
      return;
    }

    await this.exporter.exportToFile(saveUri, preview.rendered.rendered);
  }

  public refreshActivePreviews(): void {
    for (const preview of this.previews.values()) {
      void this.updatePreview(preview);
    }
  }

  public dispose(): void {
    for (const preview of this.previews.values()) {
      preview.panel.dispose();
    }
    this.previews.clear();
  }

  private registerPanelListeners(preview: PreviewState): void {
    preview.panel.onDidDispose(() => {
      this.previews.delete(preview.template.toString());
    });

    preview.panel.webview.onDidReceiveMessage(async message => {
      switch (message.type) {
        case 'refresh':
          await this.updatePreview(preview);
          break;
        case 'toggleView':
          preview.viewMode = preview.viewMode === 'html' ? 'text' : 'html';
          await this.updatePreview(preview);
          break;
        case 'exportClipboard':
          if (preview.rendered) {
            await this.exporter.exportToClipboard(preview.rendered.rendered);
          }
          break;
        default:
          this.logger.warn(`Unknown message from preview: ${message.type}`);
      }
    });
  }

  private async updatePreview(preview: PreviewState): Promise<void> {
    const contextData = await this.readContext(preview.context, preview.template);
    preview.rendered = await this.renderer.render({
      templateUri: preview.template,
      context: contextData,
      viewMode: preview.viewMode
    });

    this.telemetry?.recordEvent('rendered', { viewMode: preview.viewMode });
    preview.panel.webview.html = this.getHtmlForWebview(preview);
  }

  private async readContext(contextUri: vscode.Uri | undefined, templateUri: vscode.Uri): Promise<Record<string, unknown> | undefined> {
    try {
      if (contextUri) {
        const contents = Buffer.from(await vscode.workspace.fs.readFile(contextUri)).toString('utf-8');
        return JSON.parse(contents) as Record<string, unknown>;
      }

      const defaults = this.configuration.getConfiguration().defaultContext;
      const relative = vscode.workspace.asRelativePath(templateUri, false);
      const defaultContextPath = defaults[relative];
      if (defaultContextPath) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(templateUri);
        if (workspaceFolder) {
          const uri = vscode.Uri.joinPath(workspaceFolder.uri, defaultContextPath);
          const contents = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
          return JSON.parse(contents) as Record<string, unknown>;
        }
      }
    } catch (error) {
      this.logger.error('Failed to read context file', error);
      vscode.window.showErrorMessage('Context file could not be parsed.');
    }

    return undefined;
  }

  private getHtmlForWebview(preview: PreviewState): string {
    const { rendered, viewMode, template } = preview;
    const diagnostics = rendered?.diagnostics ?? [];
    const diagnosticsHtml = diagnostics
      .map(diag => `<li>${diag.message}</li>`)
      .join('');
    const warningSection = diagnosticsHtml
      ? `<section class="warnings"><h3>Diagnostics</h3><ul>${diagnosticsHtml}</ul></section>`
      : '';

    const content = rendered?.rendered ?? '<p>No output</p>';
    const displayContent = viewMode === 'html' ? this.sanitize(content) : this.escape(content);

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <style>
      body { font-family: var(--vscode-font-family); margin: 0; padding: 0; }
      header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }
      header button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; padding: 0.35rem 0.75rem; cursor: pointer; }
      main { padding: 1rem; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
      section.warnings { background: var(--vscode-editorWarning-background); padding: 0.5rem 1rem; margin: 1rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <header>
      <strong>${this.escape(vscode.workspace.asRelativePath(template, false))}</strong>
      <div>
        <button data-action="refresh">Refresh</button>
        <button data-action="toggle">${viewMode === 'html' ? 'View Text' : 'View HTML'}</button>
        <button data-action="clipboard">Copy</button>
      </div>
    </header>
    ${warningSection}
    <main>
      ${viewMode === 'html' ? displayContent : `<pre>${displayContent}</pre>`}
    </main>
    <script>
      const vscode = acquireVsCodeApi();
      document.body.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) { return; }
        const action = button.getAttribute('data-action');
        if (action === 'refresh') {
          vscode.postMessage({ type: 'refresh' });
        } else if (action === 'toggle') {
          vscode.postMessage({ type: 'toggleView' });
        } else if (action === 'clipboard') {
          vscode.postMessage({ type: 'exportClipboard' });
        }
      });
    </script>
  </body>
</html>`;
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private sanitize(value: string): string {
    return value
      .replace(/<script/gi, '&lt;script')
      .replace(/on[a-z]+=/gi, 'data-attr=');
  }
}
