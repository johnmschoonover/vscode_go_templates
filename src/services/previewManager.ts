import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { RendererService, RenderResult } from './rendererService';
import { DiagnosticService, PreviewDiagnostic } from './diagnosticService';
import type { RenderSnapshot } from './exportService';
import {
  getPreviewPlacement,
  PreviewLayout,
  resolvePreviewLayout,
  shouldRevealPreviewForEditor,
} from './previewLayout';
import { formatRendererLabel, RendererMode } from './renderStatus';

export const VIEW_MODES = ['html', 'text', 'raw'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  html: 'HTML',
  text: 'Text',
  raw: 'Raw',
};

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as readonly string[]).includes(value);
}

const TEMPLATE_EXTENSIONS = new Set(['.tmpl', '.tpl', '.gotmpl']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
/** Content starting with an HTML doctype or <html> element (ASCII whitespace only, as in Go's `\s`). */
const HTML_DOCUMENT_PATTERN = /^[\t\n\f\r ]*(?:<!doctype[\t\n\f\r ]+html|<html[\t\n\f\r />])/i;

/**
 * Whether a template renders HTML, which enables the preview's HTML view. Mirrors `isHTMLTemplate` in
 * go-worker/main.go (which picks html/template, so escaping matches the view): a `.html`/`.htm`
 * extension, an inner `.html`/`.htm` extension before a template extension (`email.html.tmpl`), or
 * otherwise content that starts with an HTML doctype or `<html>` element. The language id is not
 * consulted because the worker cannot see it.
 */
export function isHtmlTemplate(fsPath: string, content: string | undefined): boolean {
  const fileName = path.basename(fsPath).toLowerCase();
  const extension = path.extname(fileName);
  if (HTML_EXTENSIONS.has(extension)) {
    return true;
  }
  if (TEMPLATE_EXTENSIONS.has(extension)) {
    const inner = path.extname(fileName.slice(0, -extension.length));
    if (HTML_EXTENSIONS.has(inner)) {
      return true;
    }
  }

  const text = content?.startsWith('\ufeff') ? content.slice(1) : content;
  return text !== undefined && HTML_DOCUMENT_PATTERN.test(text);
}

const VIEW_MODE_STATE_KEY = 'goTemplateStudio.preview.viewMode';
const LAYOUT_STATE_KEY = 'goTemplateStudio.preview.layout';

export interface PreviewRenderState {
  /** True when the latest render failed and the preview shows the last good output or an error. */
  readonly degraded: boolean;
  readonly message?: string;
  /** Renderer used for the latest render; undefined when the renderer could not be started. */
  readonly rendererMode?: RendererMode;
  /** True when `auto` renderer mode fell back to the system Go toolchain for the latest render. */
  readonly rendererFallback?: boolean;
}

interface SuccessfulRender {
  rendered: string;
  isHtml: boolean;
  contextUri?: vscode.Uri;
  renderedAt: Date;
}

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
  messageSubscription?: vscode.Disposable;
  viewStateSubscription?: vscode.Disposable;
  lastSuccessful?: SuccessfulRender;
  renderState?: PreviewRenderState;
  /** Set once the panel is closed; in-flight renders check it before touching the webview. */
  disposed: boolean;
}

interface PreviewPayload {
  rendered: string;
  diagnostics: PreviewDiagnostic[];
  isHtml: boolean;
  durationMs: number;
  isStale: boolean;
  errorMessage?: string;
  viewMode: ViewMode;
  /** Footer note naming the renderer, e.g. "bundled renderer" or "system Go (auto fallback)". */
  rendererLabel?: string;
}

/**
 * Owns one preview panel per template document (keyed by the template URI). Re-running Preview on a
 * template reveals its existing panel, switching to a template editor reveals its panel without
 * taking focus (`goTemplateStudio.preview.followActiveEditor`), and new panels open beside or below
 * the editor according to the preview layout (workspace choice, then `goTemplateStudio.preview.layout`).
 *
 * Webview message protocol.
 *
 * Extension -> webview:
 *   - `render`          { payload: PreviewPayload }
 *   - `error`           { payload: { message } } (only when no last-good output exists)
 *   - `viewMode.update` { payload: { mode: ViewMode } }
 *
 * Webview -> extension:
 *   - `diagnostic.select` { payload: { line, character, source } }
 *   - `preview.refresh`   {}
 *   - `preview.export`    {}
 *   - `viewMode.set`      { payload: { mode: ViewMode } }
 */
export class PreviewManager implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewSession>();
  /** Panels being created (the `below` layout awaits a workbench command first), to avoid duplicates. */
  private readonly pendingSessions = new Map<string, Promise<PreviewSession>>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly renderDelayMs = 200;
  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  private lastActiveKey: string | undefined;

  /** Fires when a preview finishes rendering, gains/loses focus, or closes. */
  public readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  public constructor(
    private readonly rendererService: RendererService,
    private readonly output: vscode.OutputChannel,
    private readonly diagnosticService: DiagnosticService,
    private readonly workspaceState: vscode.Memento
  ) {
    this.disposables.push(
      this.onDidChangeStateEmitter,
      vscode.workspace.onDidSaveTextDocument((document) => this.handleSavedDocument(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.handleChangedDocument(event)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.handleActiveEditorChange(editor)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('goTemplateStudio.defaultViewMode') &&
          !isViewMode(this.workspaceState.get<string>(VIEW_MODE_STATE_KEY))
        ) {
          void this.broadcastViewMode();
        }
      })
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
    let created = false;

    if (!session) {
      let pending = this.pendingSessions.get(key);
      if (!pending) {
        pending = this.createSession(key, templateUri, contextUri, languageId).finally(() => {
          this.pendingSessions.delete(key);
        });
        this.pendingSessions.set(key, pending);
        created = true;
      }
      session = await pending;
    }

    if (!created) {
      session.templateUri = templateUri;
      session.contextUri = contextUri;
      session.languageId = languageId;
      if (!session.disposed) {
        // One panel per template: reveal the existing panel in whichever group the user left it.
        session.panel.reveal(session.panel.viewColumn, true);
      }
    }

    this.lastActiveKey = key;
    await this.renderSession(session, true);
  }

  /** Closes the preview for `templateUri`. Returns false when that template has no open preview. */
  public closePreview(templateUri: vscode.Uri): boolean {
    const session = this.sessions.get(this.getKey(templateUri));
    if (!session) {
      return false;
    }

    session.panel.dispose();
    return true;
  }

  public getPreviewLayout(): PreviewLayout {
    return resolvePreviewLayout(
      this.workspaceState.get<string>(LAYOUT_STATE_KEY),
      vscode.workspace.getConfiguration('goTemplateStudio').get<string>('preview.layout')
    );
  }

  /** Persists the layout for this workspace. Applies to previews opened afterwards. */
  public async setPreviewLayout(layout: PreviewLayout): Promise<void> {
    await this.workspaceState.update(LAYOUT_STATE_KEY, layout);
    this.output.appendLine(`[preview] layout set to ${layout}`);
  }

  private async createSession(
    key: string,
    templateUri: vscode.Uri,
    contextUri: vscode.Uri | undefined,
    languageId: string
  ): Promise<PreviewSession> {
    const layout = this.getPreviewLayout();
    const placement = getPreviewPlacement(layout);
    const sourceEditor = vscode.window.activeTextEditor;
    let viewColumn = placement.viewColumn;
    let restoreEditorFocus = placement.restoreEditorFocus;

    if (placement.prepareCommand) {
      try {
        await vscode.commands.executeCommand(placement.prepareCommand);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(
          `[preview] ${placement.prepareCommand} failed (${message}); opening the preview beside the editor`
        );
        viewColumn = vscode.ViewColumn.Beside;
        restoreEditorFocus = false;
      }
    }

    const panel = vscode.window.createWebviewPanel(
      'goTemplateStudio.preview',
      `Preview: ${path.basename(templateUri.fsPath)}`,
      { viewColumn, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const session: PreviewSession = {
      templateKey: key,
      templateUri,
      contextUri,
      panel,
      languageId,
      initialized: false,
      disposed: false,
    };

    this.sessions.set(key, session);
    session.viewStateSubscription = panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.lastActiveKey = key;
      }
      this.onDidChangeStateEmitter.fire(session.templateUri);
    });
    panel.onDidDispose(() => {
      session.disposed = true;
      if (session.renderTimer) {
        clearTimeout(session.renderTimer);
        session.renderTimer = undefined;
      }
      session.messageSubscription?.dispose();
      session.viewStateSubscription?.dispose();
      session.lastSuccessful = undefined;
      session.renderState = undefined;
      // A newer panel for the same template may already own the key; only remove our own entry.
      if (this.sessions.get(key) === session) {
        this.sessions.delete(key);
      }
      if (this.lastActiveKey === key) {
        this.lastActiveKey = undefined;
      }
      this.output.appendLine(`[preview] closed preview for ${path.basename(session.templateUri.fsPath)}`);
      this.onDidChangeStateEmitter.fire(session.templateUri);
    });

    this.output.appendLine(`[preview] opened preview for ${path.basename(templateUri.fsPath)} (${layout} layout)`);

    if (restoreEditorFocus && sourceEditor && this.isSameResource(sourceEditor.document.uri, templateUri)) {
      try {
        // The prepare command focused the new group; give focus back to the template editor.
        await vscode.window.showTextDocument(sourceEditor.document, {
          viewColumn: sourceEditor.viewColumn,
          preserveFocus: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[preview] failed to refocus the template editor: ${message}`);
      }
    }

    return session;
  }

  private handleActiveEditorChange(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      return;
    }

    const session = this.sessions.get(this.getKey(editor.document.uri));
    if (!session || session.disposed) {
      return;
    }

    const enabled = vscode.workspace
      .getConfiguration('goTemplateStudio')
      .get<boolean>('preview.followActiveEditor', true);
    const reveal = shouldRevealPreviewForEditor({
      enabled: enabled !== false,
      panelVisible: session.panel.visible,
      panelColumn: session.panel.viewColumn,
      editorColumn: editor.viewColumn,
    });
    if (!reveal) {
      return;
    }

    session.panel.reveal(session.panel.viewColumn, true);
    this.output.appendLine(
      `[preview] revealed preview for ${path.basename(session.templateUri.fsPath)} (follows active editor)`
    );
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

  /**
   * Forces a re-render of the preview for `templateUri`, or of the active preview when omitted.
   * Returns false when no matching preview is open.
   */
  public async refresh(templateUri?: vscode.Uri): Promise<boolean> {
    const session = this.resolveSession(templateUri);
    if (!session) {
      return false;
    }

    this.output.appendLine(`[preview] refresh requested for ${path.basename(session.templateUri.fsPath)}`);
    await this.renderSession(session, true);
    return true;
  }

  /**
   * Returns the most recent successful render of the given (or active) preview, if any. Without a
   * template and without an active preview, falls back to the only preview that has rendered
   * successfully; when several have, callers can offer `getRenderedTemplates()` as a choice.
   */
  public getRenderSnapshot(templateUri?: vscode.Uri): RenderSnapshot | undefined {
    let session = this.resolveSession(templateUri);
    if (!session && !templateUri) {
      const rendered = this.getRenderedSessions();
      session = rendered.length === 1 ? rendered[0] : undefined;
    }
    const last = session?.lastSuccessful;
    if (!session || !last) {
      return undefined;
    }

    return {
      templateUri: session.templateUri,
      contextUri: last.contextUri,
      rendered: last.rendered,
      isHtml: last.isHtml,
      renderedAt: last.renderedAt,
      isStale: Boolean(session.renderState?.degraded),
    };
  }

  /** Templates whose open preview has a successful render to export. */
  public getRenderedTemplates(): vscode.Uri[] {
    return this.getRenderedSessions().map((session) => session.templateUri);
  }

  /** Templates whose open preview renders with `contextUri`. */
  public getTemplatesUsingContext(contextUri: vscode.Uri): vscode.Uri[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.contextUri && this.isSameResource(session.contextUri, contextUri))
      .map((session) => session.templateUri);
  }

  private getRenderedSessions(): PreviewSession[] {
    return Array.from(this.sessions.values()).filter((session) => !session.disposed && session.lastSuccessful);
  }

  public getRenderState(templateUri: vscode.Uri): PreviewRenderState | undefined {
    return this.sessions.get(this.getKey(templateUri))?.renderState;
  }

  public hasPreview(templateUri: vscode.Uri): boolean {
    return this.sessions.has(this.getKey(templateUri));
  }

  /** The template behind the focused preview panel, if a preview panel currently has focus. */
  public getFocusedPreviewTemplate(): vscode.Uri | undefined {
    for (const session of this.sessions.values()) {
      if (session.panel.active) {
        return session.templateUri;
      }
    }
    return undefined;
  }

  public getViewMode(): ViewMode {
    const stored = this.workspaceState.get<string>(VIEW_MODE_STATE_KEY);
    if (isViewMode(stored)) {
      return stored;
    }

    const configured = vscode.workspace.getConfiguration('goTemplateStudio').get<string>('defaultViewMode');
    return isViewMode(configured) ? configured : 'html';
  }

  public async setViewMode(mode: ViewMode): Promise<void> {
    await this.workspaceState.update(VIEW_MODE_STATE_KEY, mode);
    this.output.appendLine(`[preview] view mode set to ${mode}`);
    await this.broadcastViewMode();
  }

  /** Advances html -> text -> raw -> html and returns the new mode. */
  public async cycleViewMode(): Promise<ViewMode> {
    const current = VIEW_MODES.indexOf(this.getViewMode());
    const next = VIEW_MODES[(current + 1) % VIEW_MODES.length];
    await this.setViewMode(next);
    return next;
  }

  private async broadcastViewMode(): Promise<void> {
    const mode = this.getViewMode();
    await Promise.all(
      Array.from(this.sessions.values())
        .filter((session) => session.initialized)
        .map((session) =>
          session.panel.webview.postMessage({
            type: 'viewMode.update',
            payload: { mode },
          })
        )
    );
  }

  private resolveSession(templateUri?: vscode.Uri): PreviewSession | undefined {
    if (templateUri) {
      return this.sessions.get(this.getKey(templateUri));
    }

    for (const session of this.sessions.values()) {
      if (session.panel.active) {
        return session;
      }
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const session = this.sessions.get(this.getKey(editor.document.uri));
      if (session) {
        return session;
      }
    }

    if (this.lastActiveKey) {
      const session = this.sessions.get(this.lastActiveKey);
      if (session) {
        return session;
      }
    }

    return this.sessions.size === 1 ? this.sessions.values().next().value : undefined;
  }

  private async renderSession(session: PreviewSession, force = false): Promise<void> {
    if (session.disposed) {
      return;
    }
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
      if (session.disposed) {
        // The panel was closed while the renderer ran.
        return;
      }
      const previewDiagnostics = this.diagnosticService.applyDiagnostics(
        session.templateUri,
        session.contextUri,
        result.diagnostics
      );

      session.templateSignature = templateSignature;
      session.contextSignature = contextSignature;

      const isHtml = isHtmlTemplate(session.templateUri.fsPath, await this.readTemplateText(session.templateUri));
      const rendererState = {
        rendererMode: result.rendererMode,
        rendererFallback: result.rendererFallback,
      };
      if (!result.errorMessage) {
        session.lastSuccessful = {
          rendered: result.rendered,
          isHtml,
          contextUri: session.contextUri,
          renderedAt: new Date(),
        };
        session.renderState = { degraded: false, ...rendererState };
      } else {
        session.renderState = { degraded: true, message: result.errorMessage, ...rendererState };
      }

      const payload = this.buildPreviewPayload(session, result, previewDiagnostics, isHtml);
      await session.panel.webview.postMessage({
        type: 'render',
        payload,
      });

      if (previewDiagnostics.length > 0) {
        const summary = previewDiagnostics
          .map((diag) => {
            const scope = diag.source === 'context' ? 'context' : 'template';
            const line = typeof diag.line === 'number' ? `:${diag.line + 1}` : '';
            return `${scope}${line} ${diag.message}`;
          })
          .join('; ');
        this.output.appendLine(`[preview] rendered with diagnostics: ${summary}`);
      } else {
        this.output.appendLine('[preview] rendered successfully');
      }

      if (result.errorMessage) {
        this.output.appendLine(`[preview] renderer reported an error: ${result.errorMessage}`);
      }
      void vscode.window.setStatusBarMessage(
        `Go Template Studio: Rendered in ${result.durationMs} ms`,
        5000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (session.disposed) {
        this.output.appendLine(`[preview] render finished after the preview closed: ${message}`);
        return;
      }
      this.output.appendLine(`[preview] failed to render: ${message}`);
      this.diagnosticService.applyDiagnostics(session.templateUri, session.contextUri, []);
      session.renderState = { degraded: true, message };

      const fallback = session.lastSuccessful;
      if (fallback) {
        // Keep the last good output visible (with the error banner) instead of clearing the preview.
        const payload: PreviewPayload = {
          rendered: fallback.rendered,
          diagnostics: [],
          isHtml: fallback.isHtml,
          durationMs: 0,
          isStale: true,
          errorMessage: message,
          viewMode: this.getViewMode(),
        };
        await session.panel.webview.postMessage({ type: 'render', payload });
      } else {
        await session.panel.webview.postMessage({
          type: 'error',
          payload: {
            message,
          },
        });
      }
    } finally {
      this.onDidChangeStateEmitter.fire(session.templateUri);
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

  /** The template text the renderer saw: the open (possibly unsaved) document, else the file on disk. */
  private async readTemplateText(uri: vscode.Uri): Promise<string | undefined> {
    const openDocument = vscode.workspace.textDocuments.find((doc) => this.isSameResource(doc.uri, uri));
    if (openDocument) {
      return openDocument.getText();
    }

    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return undefined;
    }
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

    session.panel.webview.html = this.renderBaseHtml(this.getViewMode());
    session.messageSubscription?.dispose();
    session.messageSubscription = session.panel.webview.onDidReceiveMessage((message) => {
      void this.handleWebviewMessage(session, message);
    });
    session.initialized = true;
  }

  private async handleWebviewMessage(session: PreviewSession, message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') {
      return;
    }

    const { type, payload } = message as { type?: string; payload?: unknown };
    if (type === 'diagnostic.select' && payload && typeof payload === 'object') {
      const details = payload as {
        line?: number;
        character?: number;
        source?: 'template' | 'context';
      };
      const targetUri =
        details.source === 'context' && session.contextUri ? session.contextUri : session.templateUri;
      const line = typeof details.line === 'number' ? details.line : 0;
      const character = typeof details.character === 'number' ? details.character : 0;
      await this.revealRange(targetUri, line, character);
      return;
    }

    if (type === 'preview.refresh') {
      await this.refresh(session.templateUri);
      return;
    }

    if (type === 'preview.export') {
      await vscode.commands.executeCommand('goTemplateStudio.exportOutput', session.templateUri);
      return;
    }

    if (type === 'viewMode.set' && payload && typeof payload === 'object') {
      const { mode } = payload as { mode?: unknown };
      if (isViewMode(mode)) {
        await this.setViewMode(mode);
      }
    }
  }

  private async revealRange(targetUri: vscode.Uri, line: number, character: number): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(targetUri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      const position = new vscode.Position(line, character);
      const selection = new vscode.Selection(position, position);
      editor.selection = selection;
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[preview] failed to reveal diagnostic location: ${message}`);
    }
  }

  private buildPreviewPayload(
    session: PreviewSession,
    result: RenderResult,
    diagnostics: PreviewDiagnostic[],
    isHtml: boolean
  ): PreviewPayload {
    const useFallback = Boolean(result.errorMessage && session.lastSuccessful);
    const fallback = session.lastSuccessful;
    const rendered = useFallback ? fallback?.rendered ?? '' : result.rendered;
    const payloadIsHtml = useFallback ? fallback?.isHtml ?? isHtml : isHtml;

    return {
      rendered,
      diagnostics,
      isHtml: payloadIsHtml,
      durationMs: result.durationMs,
      isStale: useFallback,
      errorMessage: result.errorMessage,
      viewMode: this.getViewMode(),
      rendererLabel: formatRendererLabel(result.rendererMode, result.rendererFallback),
    };
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

  private renderBaseHtml(initialViewMode: ViewMode): string {
    const nonce = randomBytes(16).toString('hex');
    const modeButtons = VIEW_MODES.map(
      (mode) =>
        `<button type="button" class="toolbar-button mode-button" data-mode="${mode}" aria-pressed="${
          mode === initialViewMode ? 'true' : 'false'
        }" aria-label="${VIEW_MODE_LABELS[mode]} view" title="${VIEW_MODE_LABELS[mode]} view">${VIEW_MODE_LABELS[mode]}</button>`
    ).join('\n          ');

    // Note: style-src keeps 'unsafe-inline' because the sandboxed srcdoc iframe inherits this policy and
    // rendered HTML templates commonly include inline <style> blocks. Scripts are nonce-restricted.
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <title>Go Template Preview</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      }
      body {
        margin: 0;
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        font-size: 12px;
      }
      .toolbar-group {
        display: inline-flex;
        gap: 2px;
      }
      .toolbar-label {
        margin-left: 8px;
        opacity: 0.8;
      }
      .toolbar-button {
        font: inherit;
        padding: 3px 10px;
        border-radius: 2px;
        cursor: pointer;
        border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
        background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.15));
        color: var(--vscode-button-secondaryForeground, inherit);
      }
      .toolbar-button:hover {
        background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.25));
      }
      .toolbar-button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .mode-button[aria-pressed="true"] {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-contrastActiveBorder, var(--vscode-button-background));
        font-weight: 600;
      }
      .mode-button[aria-pressed="true"]:hover {
        background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
      }
      .mode-button.mode-button--unavailable {
        text-decoration: line-through;
      }
      .toolbar-note {
        font-style: italic;
        color: var(--vscode-descriptionForeground, inherit);
      }
      .layout {
        flex: 1;
        display: flex;
        flex-direction: row;
        min-height: 0;
      }
      main {
        flex: 1;
        overflow: auto;
        position: relative;
        display: flex;
        flex-direction: column;
      }
      #preview-content {
        flex: 1 0 auto;
        display: flex;
        flex-direction: column;
      }
      .preview-frame {
        flex: 1;
        width: 100%;
        min-height: 300px;
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
      .diag-button {
        margin-bottom: 8px;
        padding: 8px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.4;
        border: none;
        width: 100%;
        text-align: left;
        cursor: pointer;
        background: rgba(128, 128, 128, 0.1);
        color: inherit;
      }
      .diag-button:focus {
        outline: 2px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .diag-button[disabled] {
        cursor: default;
        opacity: 0.7;
      }
      .diag-button.diag--error {
        background: rgba(255, 0, 0, 0.12);
        color: #ff4d4f;
      }
      .diag-button.diag--warning {
        background: rgba(255, 165, 0, 0.12);
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
        background: rgba(255, 0, 0, 0.12);
        color: #ff4d4f;
        display: none;
        border-bottom: 1px solid rgba(255, 0, 0, 0.2);
      }
      .error-banner[aria-hidden="false"] {
        display: block;
      }
      .status--stale {
        background: rgba(255, 165, 0, 0.12);
        color: #ffa500;
      }
    </style>
  </head>
  <body data-view-mode="${initialViewMode}">
    <header class="toolbar" role="toolbar" aria-label="Preview toolbar">
      <button type="button" id="toolbar-refresh" class="toolbar-button" aria-label="Refresh preview" title="Refresh preview">Refresh</button>
      <button type="button" id="toolbar-export" class="toolbar-button" aria-label="Export rendered output" title="Export rendered output">Export…</button>
      <span class="toolbar-label" id="view-mode-label">View:</span>
      <div class="toolbar-group" role="group" aria-labelledby="view-mode-label">
          ${modeButtons}
      </div>
      <span id="view-mode-note" class="toolbar-note" aria-live="polite"></span>
    </header>
    <div class="layout">
      <main id="preview-main">
        <div id="error" class="error-banner" role="alert" aria-hidden="true"></div>
        <div id="preview-content"></div>
        <div id="preview-status" class="status" role="status" aria-live="polite" hidden></div>
      </main>
      <aside id="diagnostics" class="diagnostics" hidden>
        <h2>Diagnostics</h2>
        <ul id="diagnostics-list"></ul>
      </aside>
    </div>
    <script nonce="${nonce}">
      (function() {
        const vscode = acquireVsCodeApi();
        const main = document.getElementById('preview-main');
        const content = document.getElementById('preview-content');
        const diagnostics = document.getElementById('diagnostics');
        const diagnosticsList = document.getElementById('diagnostics-list');
        const status = document.getElementById('preview-status');
        const errorBanner = document.getElementById('error');
        const viewModeNote = document.getElementById('view-mode-note');
        const modeButtons = Array.prototype.slice.call(document.querySelectorAll('.mode-button'));
        const VIEW_MODES = ['html', 'text', 'raw'];

        let viewMode = VIEW_MODES.indexOf(document.body.dataset.viewMode) >= 0 ? document.body.dataset.viewMode : 'html';
        let lastPayload = null;

        document.getElementById('toolbar-refresh').addEventListener('click', () => {
          vscode.postMessage({ type: 'preview.refresh' });
        });
        document.getElementById('toolbar-export').addEventListener('click', () => {
          vscode.postMessage({ type: 'preview.export' });
        });
        modeButtons.forEach((button) => {
          button.addEventListener('click', () => {
            const mode = button.getAttribute('data-mode');
            if (VIEW_MODES.indexOf(mode) < 0 || mode === viewMode) {
              return;
            }
            applyViewMode(mode);
            vscode.postMessage({ type: 'viewMode.set', payload: { mode: mode } });
          });
        });

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

        const BLOCK_TAGS = new Set([
          'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
          'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
          'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
        ]);
        const PARAGRAPH_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'PRE', 'BLOCKQUOTE']);
        const SKIPPED_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);

        // Plain-text ("simplified") rendering of HTML output. DOMParser documents are inert, so no
        // scripts run and no resources load while extracting text.
        function htmlToText(html) {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          let out = '';

          function appendText(text, preserveWhitespace) {
            if (!preserveWhitespace && (out === '' || out.charAt(out.length - 1) === '\\n')) {
              text = text.replace(/^ +/, '');
            }
            out += text;
          }

          function newline(count) {
            out = out.replace(/ +$/, '');
            if (out === '') {
              return;
            }
            const trailing = out.length - out.replace(/\\n+$/, '').length;
            for (let i = trailing; i < count; i++) {
              out += '\\n';
            }
          }

          function walk(node, inPre) {
            if (node.nodeType === Node.TEXT_NODE) {
              const value = node.nodeValue || '';
              appendText(inPre ? value : value.replace(/\\s+/g, ' '), inPre);
              return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
              return;
            }
            const tag = node.tagName;
            if (SKIPPED_TAGS.has(tag)) {
              return;
            }
            if (tag === 'BR') {
              out += '\\n';
              return;
            }
            const breaks = PARAGRAPH_TAGS.has(tag) ? 2 : BLOCK_TAGS.has(tag) ? 1 : 0;
            if (breaks) {
              newline(breaks);
            }
            if (tag === 'LI') {
              appendText('\\u2022 ');
            }
            const childInPre = inPre || tag === 'PRE';
            node.childNodes.forEach((child) => walk(child, childInPre));
            if (breaks) {
              newline(breaks);
            } else if (tag === 'TD' || tag === 'TH') {
              out += '\\t';
            }
          }

          walk(doc.body || doc.documentElement, false);
          return out.replace(/\\n{3,}/g, '\\n\\n').trim();
        }

        function effectiveViewMode(payload) {
          if (viewMode === 'html' && payload && !payload.isHtml) {
            return 'text';
          }
          return viewMode;
        }

        function updateToolbar(payload) {
          const htmlUnavailable = Boolean(payload) && !payload.isHtml;
          modeButtons.forEach((button) => {
            const mode = button.getAttribute('data-mode');
            button.setAttribute('aria-pressed', mode === viewMode ? 'true' : 'false');
            if (mode === 'html') {
              button.classList.toggle('mode-button--unavailable', htmlUnavailable);
              button.title = htmlUnavailable ? 'HTML view (unavailable: this template renders text)' : 'HTML view';
            }
          });
          viewModeNote.textContent =
            htmlUnavailable && viewMode === 'html' ? 'Text output: showing Text view' : '';
        }

        function renderContent(payload) {
          content.innerHTML = '';
          const mode = effectiveViewMode(payload);
          content.setAttribute('data-mode', mode);
          if (mode === 'html') {
            const frame = document.createElement('iframe');
            frame.className = 'preview-frame';
            frame.title = 'Rendered template output';
            frame.setAttribute('sandbox', 'allow-same-origin');
            frame.srcdoc = payload.rendered;
            content.appendChild(frame);
          } else {
            const pre = document.createElement('pre');
            pre.className = 'preview-code';
            const code = document.createElement('code');
            code.textContent = mode === 'text' && payload.isHtml ? htmlToText(payload.rendered) : payload.rendered;
            pre.appendChild(code);
            content.appendChild(pre);
          }
          updateToolbar(payload);
        }

        function applyViewMode(mode) {
          if (VIEW_MODES.indexOf(mode) < 0) {
            return;
          }
          const changed = mode !== viewMode;
          viewMode = mode;
          if (!lastPayload) {
            updateToolbar(null);
            return;
          }
          if (changed) {
            renderContent(lastPayload);
            main.scrollTop = 0;
          } else {
            updateToolbar(lastPayload);
          }
        }

        function renderPreview(payload) {
          const previous = captureState();
          lastPayload = payload;
          if (VIEW_MODES.indexOf(payload.viewMode) >= 0) {
            viewMode = payload.viewMode;
          }

          diagnosticsList.innerHTML = '';
          if (payload.diagnostics.length > 0) {
            diagnostics.removeAttribute('hidden');
            for (const diag of payload.diagnostics) {
              const item = document.createElement('li');
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'diag-button diag--' + diag.severity;
              const segments = [diag.source === 'context' ? 'Context' : 'Template'];
              if (typeof diag.line === 'number' && typeof diag.character === 'number') {
                segments.push('Line ' + (diag.line + 1) + ', Col ' + (diag.character + 1));
              } else if (typeof diag.line === 'number') {
                segments.push('Line ' + (diag.line + 1));
              } else if (typeof diag.character === 'number') {
                segments.push('Col ' + (diag.character + 1));
              }
              const label = segments.join(' \\u00B7 ');
              button.textContent = (label ? label + ': ' : '') + diag.message;
              button.addEventListener('click', () => {
                vscode.postMessage({
                  type: 'diagnostic.select',
                  payload: {
                    line: typeof diag.line === 'number' ? diag.line : 0,
                    character: typeof diag.character === 'number' ? diag.character : 0,
                    source: diag.source,
                  },
                });
              });
              item.appendChild(button);
              diagnosticsList.appendChild(item);
            }
          } else {
            diagnostics.setAttribute('hidden', '');
          }

          renderContent(payload);

          errorBanner.textContent = payload.errorMessage || '';
          if (payload.errorMessage) {
            errorBanner.setAttribute('aria-hidden', 'false');
          } else {
            errorBanner.setAttribute('aria-hidden', 'true');
          }

          const duration = payload.durationMs > 0 ? ' (' + payload.durationMs + ' ms)' : '';
          const rendererNote = payload.rendererLabel ? ' \\u00B7 ' + payload.rendererLabel : '';
          if (payload.errorMessage) {
            if (payload.isStale) {
              status.textContent = 'Render failed, showing last successful result' + duration + rendererNote;
            } else {
              status.textContent = 'Render failed' + duration + rendererNote;
            }
            status.classList.add('status--stale');
          } else {
            status.textContent = 'Rendered in ' + payload.durationMs + ' ms' + rendererNote;
            status.classList.remove('status--stale');
          }
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

        window.addEventListener('message', (event) => {
          const message = event.data;
          if (!message) {
            return;
          }
          if (message.type === 'render') {
            renderPreview(message.payload);
          } else if (message.type === 'error') {
            renderError(message.payload);
          } else if (message.type === 'viewMode.update' && message.payload) {
            applyViewMode(message.payload.mode);
          }
        });

        updateToolbar(null);
        setScroll(getState());

        function renderError(payload) {
          lastPayload = null;
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
          updateToolbar(null);
        }
      })();
    </script>
  </body>
</html>`;
  }
}
