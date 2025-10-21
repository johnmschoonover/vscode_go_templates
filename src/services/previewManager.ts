import * as path from 'path';
import * as vscode from 'vscode';
import { RendererService } from './rendererService';

interface PreviewSession {
  readonly templateKey: string;
  templateUri: vscode.Uri;
  contextUri?: vscode.Uri;
  panel: vscode.WebviewPanel;
  languageId: string;
  initialized: boolean;
  templateSignature?: string;
  contextSignature?: string;
  renderTimer?: NodeJS.Timeout;
}

export class PreviewManager implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly renderDelayMs = 200;

  public constructor(
    private readonly rendererService: RendererService,
    private readonly output: vscode.OutputChannel
  ) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => this.handleSavedDocument(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.handleChangedDocument(event))
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
        { enableScripts: true, retainContextWhenHidden: true }
      );

      session = {
        templateKey: key,
        templateUri,
        contextUri,
        panel,
        languageId,
        initialized: false,
      };

      this.sessions.set(key, session);
      panel.onDidDispose(() => {
        if (session?.renderTimer) {
          clearTimeout(session.renderTimer);
        }
        this.sessions.delete(key);
      });
    } else {
      session.templateUri = templateUri;
      session.contextUri = contextUri;
      session.languageId = languageId;
    }

    await this.renderSession(session, true);
    session.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  public async updateContext(templateUri: vscode.Uri, contextUri: vscode.Uri | undefined): Promise<void> {
    const key = this.getKey(templateUri);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }

    session.contextUri = contextUri;
    await this.renderSession(session, true);
  }

  private async renderSession(session: PreviewSession, force = false): Promise<void> {
    this.ensureWebviewInitialized(session);

    try {
      const [templateSignature, contextSignature] = await Promise.all([
        this.getDocumentSignature(session.templateUri),
        this.getDocumentSignature(session.contextUri),
      ]);

      if (!force && templateSignature === session.templateSignature && contextSignature === session.contextSignature) {
        return;
      }

      const result = await this.rendererService.render(session.templateUri, session.contextUri);
      session.templateSignature = templateSignature;
      session.contextSignature = contextSignature;
      await session.panel.webview.postMessage({
        type: 'render',
        payload: {
          rendered: result.rendered,
          diagnostics: result.diagnostics,
          isHtml: this.isHtmlTemplate(session),
          durationMs: result.durationMs,
        },
      });
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
      await session.panel.webview.postMessage({
        type: 'error',
        payload: {
          message,
        },
      });
    }
  }

  private handleSavedDocument(document: vscode.TextDocument): void {
    for (const session of this.sessions.values()) {
      if (this.isSameResource(document.uri, session.templateUri)) {
        this.scheduleRender(session);
        continue;
      }

      if (session.contextUri && this.isSameResource(document.uri, session.contextUri)) {
        this.scheduleRender(session);
      }
    }
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

  private ensureWebviewInitialized(session: PreviewSession): void {
    if (session.initialized) {
      return;
    }

    session.panel.webview.html = this.renderBaseHtml();
    session.initialized = true;
  }

  private scheduleRender(session: PreviewSession): void {
    if (session.renderTimer) {
      clearTimeout(session.renderTimer);
    }

    session.renderTimer = setTimeout(() => {
      session.renderTimer = undefined;
      void this.renderSession(session);
    }, this.renderDelayMs);
  }

  private handleChangedDocument(event: vscode.TextDocumentChangeEvent): void {
    for (const session of this.sessions.values()) {
      if (this.isSameResource(event.document.uri, session.templateUri)) {
        this.scheduleRender(session);
        continue;
      }

      if (session.contextUri && this.isSameResource(event.document.uri, session.contextUri)) {
        this.scheduleRender(session);
      }
    }
  }

  private async getDocumentSignature(uri: vscode.Uri | undefined): Promise<string | undefined> {
    if (!uri) {
      return undefined;
    }

    const openDocument = vscode.workspace.textDocuments.find((doc) => this.isSameResource(doc.uri, uri));
    if (openDocument) {
      return `open:${openDocument.version}:${openDocument.isDirty ? 'dirty' : 'clean'}`;
    }

    try {
      const stats = await vscode.workspace.fs.stat(uri);
      return `disk:${stats.mtime?.toString() ?? '0'}:${stats.size}`;
    } catch (error) {
      return 'missing';
    }
  }

  private renderBaseHtml(): string {
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
        position: relative;
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
        overflow: auto;
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
      .status {
        position: sticky;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.05);
        padding: 8px 16px;
        font-size: 11px;
        color: var(--vscode-editor-foreground);
        backdrop-filter: blur(2px);
      }
      .status[hidden] {
        display: none;
      }
      .error-banner {
        padding: 16px;
        margin: 0;
        background: rgba(255, 0, 0, 0.1);
        color: #ff4d4f;
        display: none;
        border-bottom: 1px solid rgba(255, 0, 0, 0.2);
      }
      .error-banner[aria-hidden="false"] {
        display: block;
      }
    </style>
  </head>
  <body>
    <main id="preview-main">
      <div id="error" class="error-banner" aria-hidden="true"></div>
      <div id="preview-content"></div>
      <div id="preview-status" class="status" hidden></div>
    </main>
    <aside id="diagnostics" class="diagnostics" hidden>
      <h2>Diagnostics</h2>
      <ul id="diagnostics-list"></ul>
    </aside>
    <script>
      (function() {
        const vscode = acquireVsCodeApi();
        const main = document.getElementById('preview-main');
        const content = document.getElementById('preview-content');
        const diagnostics = document.getElementById('diagnostics');
        const diagnosticsList = document.getElementById('diagnostics-list');
        const status = document.getElementById('preview-status');
        const errorBanner = document.getElementById('error');

        function getState() {
          return vscode.getState() || { scroll: { main: 0, diagnostics: 0 }, selection: null };
        }

        function persistState(state) {
          vscode.setState(state);
        }

        function captureSelection(root) {
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) {
            return null;
          }
          const range = selection.getRangeAt(0);
          if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
            return null;
          }

          return {
            anchor: getOffset(root, selection.anchorNode, selection.anchorOffset),
            focus: getOffset(root, selection.focusNode, selection.focusOffset),
          };
        }

        function restoreSelection(root, saved) {
          if (!saved) {
            return;
          }

          const anchor = locatePosition(root, saved.anchor);
          const focus = locatePosition(root, saved.focus);
          if (!anchor || !focus) {
            return;
          }

          const selection = window.getSelection();
          if (!selection) {
            return;
          }

          selection.removeAllRanges();
          const range = document.createRange();
          range.setStart(anchor.node, anchor.offset);
          range.setEnd(focus.node, focus.offset);
          selection.addRange(range);
        }

        function getOffset(root, node, offset) {
          const range = document.createRange();
          range.selectNodeContents(root);
          range.setEnd(node, offset);
          return range.toString().length;
        }

        function locatePosition(root, absoluteOffset) {
          if (absoluteOffset == null) {
            return null;
          }
          let remaining = absoluteOffset;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
          let current = walker.nextNode();
          while (current) {
            const length = current.textContent ? current.textContent.length : 0;
            if (remaining <= length) {
              return { node: current, offset: remaining };
            }
            remaining -= length;
            current = walker.nextNode();
          }
          return null;
        }

        function setScroll(state) {
          if (!state) {
            return;
          }
          main.scrollTop = state.scroll.main || 0;
          if (!diagnostics.hasAttribute('hidden')) {
            diagnostics.scrollTop = state.scroll.diagnostics || 0;
          }
        }

        function captureState() {
          return {
            scroll: {
              main: main.scrollTop,
              diagnostics: diagnostics.scrollTop,
            },
            selection: captureSelection(content),
          };
        }

        function renderPreview(payload) {
          const previous = captureState();

          diagnosticsList.innerHTML = '';
          if (payload.diagnostics.length > 0) {
            diagnostics.removeAttribute('hidden');
            for (const diag of payload.diagnostics) {
              const item = document.createElement('li');
              item.className = 'diag diag--' + diag.severity;
              item.textContent = diag.message;
              diagnosticsList.appendChild(item);
            }
          } else {
            diagnostics.setAttribute('hidden', '');
          }

          content.innerHTML = '';
          if (payload.isHtml) {
            const frame = document.createElement('iframe');
            frame.className = 'preview-frame';
            frame.setAttribute('sandbox', 'allow-same-origin');
            frame.srcdoc = payload.rendered;
            content.appendChild(frame);
          } else {
            const pre = document.createElement('pre');
            pre.className = 'preview-code';
            const code = document.createElement('code');
            code.textContent = payload.rendered;
            pre.appendChild(code);
            content.appendChild(pre);
          }

          errorBanner.setAttribute('aria-hidden', 'true');
          errorBanner.textContent = '';
          status.textContent = 'Rendered in ' + payload.durationMs + ' ms';
          status.hidden = false;

          restoreSelection(content, previous.selection);
          setScroll(previous);
          persistState({
            scroll: {
              main: main.scrollTop,
              diagnostics: diagnostics.scrollTop,
            },
            selection: captureSelection(content),
          });
        }

        function renderError(payload) {
          content.innerHTML = '';
          const pre = document.createElement('pre');
          pre.className = 'preview-code';
          pre.textContent = payload.message;
          content.appendChild(pre);
          diagnostics.setAttribute('hidden', '');
          diagnosticsList.innerHTML = '';
          status.hidden = true;
          errorBanner.textContent = payload.message;
          errorBanner.setAttribute('aria-hidden', 'false');
        }

        window.addEventListener('message', (event) => {
          const message = event.data;
          if (!message) {
            return;
          }
          if (message.type === 'render') {
            renderPreview(message.payload);
          } else if (message.type === 'error') {
            renderError(message.payload);
          }
        });

        setScroll(getState());
      })();
    </script>
  </body>
</html>`;
  }
}
