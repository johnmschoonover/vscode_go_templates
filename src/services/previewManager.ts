import * as path from 'path';
import * as vscode from 'vscode';
import { RendererService, RenderResult } from './rendererService';

interface PreviewSession {
  readonly templateKey: string;
  templateUri: vscode.Uri;
  contextUri?: vscode.Uri;
  panel: vscode.WebviewPanel;
  languageId: string;
}

export class PreviewManager implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly rendererService: RendererService,
    private readonly output: vscode.OutputChannel
  ) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => this.handleSavedDocument(document))
    );
  }

  public dispose(): void {
    for (const session of this.sessions.values()) {
      session.panel.dispose();
    }
    this.sessions.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  public async showPreview(
    templateUri: vscode.Uri,
    contextUri: vscode.Uri | undefined,
    languageId: string
  ): Promise<void> {
    const key = this.getKey(templateUri);
    let session = this.sessions.get(key);

    if (!session) {
      const panel = vscode.window.createWebviewPanel(
        'goTemplateStudio.preview',
        `Preview: ${path.basename(templateUri.fsPath)}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true }
      );

      session = {
        templateKey: key,
        templateUri,
        contextUri,
        panel,
        languageId,
      };

      this.sessions.set(key, session);
      panel.onDidDispose(() => {
        this.sessions.delete(key);
      });
    } else {
      session.templateUri = templateUri;
      session.contextUri = contextUri;
      session.languageId = languageId;
    }

    await this.renderSession(session);
    session.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  public async updateContext(templateUri: vscode.Uri, contextUri: vscode.Uri | undefined): Promise<void> {
    const key = this.getKey(templateUri);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }

    session.contextUri = contextUri;
    await this.renderSession(session);
  }

  private async renderSession(session: PreviewSession): Promise<void> {
    try {
      const result = await this.rendererService.render(session.templateUri, session.contextUri);
      session.panel.webview.html = this.renderHtml(session, result);
      if (result.diagnostics.length > 0) {
        const summary = result.diagnostics.map((diag) => diag.message).join('; ');
        this.output.appendLine(`[preview] rendered with diagnostics: ${summary}`);
      } else {
        this.output.appendLine('[preview] rendered successfully');
      }
      void vscode.window.setStatusBarMessage(
        `Go Template Studio: Rendered in ${result.durationMs} ms`,
        5000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[preview] failed to render: ${message}`);
      session.panel.webview.html = this.renderErrorHtml(session, message);
    }
  }

  private handleSavedDocument(document: vscode.TextDocument): void {
    for (const session of this.sessions.values()) {
      if (this.isSameResource(document.uri, session.templateUri)) {
        void this.renderSession(session);
        continue;
      }

      if (session.contextUri && this.isSameResource(document.uri, session.contextUri)) {
        void this.renderSession(session);
      }
    }
  }

  private renderHtml(session: PreviewSession, result: RenderResult): string {
    const isHtml = this.isHtmlTemplate(session);
    const diagnostics = result.diagnostics
      .map((diag) => `<li class="diag diag--${diag.severity}">${this.escapeHtml(diag.message)}</li>`)
      .join('');

    const diagnosticsBlock = diagnostics
      ? `<aside class="diagnostics"><h2>Diagnostics</h2><ul>${diagnostics}</ul></aside>`
      : '';

    const content = isHtml
      ? `<iframe class="preview-frame" sandbox="allow-same-origin" srcdoc="${this.escapeAttribute(
          result.rendered
        )}"></iframe>`
      : `<pre class="preview-code"><code>${this.escapeHtml(result.rendered)}</code></pre>`;

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <title>Go Template Preview</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      body {
        margin: 0;
        display: flex;
        flex-direction: row;
        min-height: 100vh;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
      }
      main {
        flex: 1;
        overflow: auto;
      }
      .preview-frame {
        width: 100%;
        height: 100vh;
        border: none;
        background: white;
      }
      .preview-code {
        margin: 0;
        padding: 16px;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
        font-size: var(--vscode-editor-font-size, 13px);
      }
      .diagnostics {
        width: 280px;
        border-left: 1px solid rgba(128, 128, 128, 0.3);
        padding: 16px;
        box-sizing: border-box;
        background: var(--vscode-sideBar-background);
      }
      .diagnostics h2 {
        margin-top: 0;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .diagnostics ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .diag {
        margin-bottom: 8px;
        padding: 8px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.4;
      }
      .diag--error {
        background: rgba(255, 0, 0, 0.1);
        color: #ff4d4f;
      }
      .diag--warning {
        background: rgba(255, 165, 0, 0.1);
        color: #ffa500;
      }
    </style>
  </head>
  <body>
    <main>
      ${content}
    </main>
    ${diagnosticsBlock}
  </body>
</html>`;
  }

  private renderErrorHtml(session: PreviewSession, error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Go Template Preview Error</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      body {
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        margin: 0;
        padding: 24px;
      }
      h1 {
        margin-top: 0;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        padding: 16px;
        border-radius: 6px;
        background: rgba(255, 0, 0, 0.1);
        color: #ff4d4f;
      }
    </style>
  </head>
  <body>
    <h1>Failed to render template</h1>
    <pre>${this.escapeHtml(error)}</pre>
  </body>
</html>`;
  }

  private isHtmlTemplate(session: PreviewSession): boolean {
    const extension = path.extname(session.templateUri.fsPath).toLowerCase();
    if (extension === '.html' || extension === '.htm') {
      return true;
    }

    return session.languageId === 'html' || session.languageId === 'gotemplate';
  }

  private handleUriCase(value: string): string {
    return process.platform === 'win32' ? value.toLowerCase() : value;
  }

  private isSameResource(left: vscode.Uri, right: vscode.Uri): boolean {
    return this.handleUriCase(left.fsPath) === this.handleUriCase(right.fsPath);
  }

  private getKey(uri: vscode.Uri): string {
    return this.handleUriCase(uri.toString());
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value).replace(/'/g, '&#39;');
  }
}
