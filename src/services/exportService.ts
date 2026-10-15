import * as path from 'path';
import * as vscode from 'vscode';

/**
 * The most recent successful render for a preview session. PreviewManager produces these and the
 * export service consumes them, so exports never trigger a fresh render.
 */
export interface RenderSnapshot {
  readonly templateUri: vscode.Uri;
  readonly contextUri?: vscode.Uri;
  readonly rendered: string;
  readonly isHtml: boolean;
  readonly renderedAt: Date;
  /** True when the latest render failed and this snapshot is the last good output. */
  readonly isStale: boolean;
}

export type ExportTarget = 'file' | 'clipboard' | 'bundle';

const TEMPLATE_EXTENSIONS = ['.tmpl', '.tpl', '.gotmpl'];
// Extensions that describe the template flavor rather than the rendered output type.
const NON_OUTPUT_EXTENSIONS = ['.go'];
const SHARES_DIRECTORY = ['.gotemplatestudio', 'shares'];

export class ExportService {
  public constructor(private readonly output: vscode.OutputChannel) {}

  /**
   * Entry point for the `goTemplateStudio.exportOutput` command. Prompts for a target when none is
   * supplied and warns when there is nothing to export yet.
   */
  public async exportRendered(snapshot: RenderSnapshot | undefined, target?: ExportTarget): Promise<void> {
    if (!snapshot) {
      void vscode.window.showWarningMessage(
        'There is no successful render to export yet. Open a Go template preview and render it without errors first.'
      );
      return;
    }

    const chosen = target ?? (await this.pickTarget(snapshot));
    if (!chosen) {
      return;
    }

    try {
      if (chosen === 'clipboard') {
        await this.copyToClipboard(snapshot);
      } else {
        await this.saveToFile(snapshot, chosen === 'bundle');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[export] failed: ${message}`);
      void vscode.window.showErrorMessage(`Go Template Studio: Export failed: ${message}`);
    }
  }

  public getDefaultFileName(snapshot: Pick<RenderSnapshot, 'templateUri' | 'isHtml'>): string {
    let base = path.posix.basename(snapshot.templateUri.path);
    const templateExtension = path.posix.extname(base).toLowerCase();
    if (TEMPLATE_EXTENSIONS.includes(templateExtension)) {
      base = base.slice(0, -templateExtension.length);
    }

    let outputExtension = path.posix.extname(base);
    if (NON_OUTPUT_EXTENSIONS.includes(outputExtension.toLowerCase())) {
      base = base.slice(0, -outputExtension.length);
      outputExtension = '';
    }

    const stem = outputExtension ? base.slice(0, -outputExtension.length) : base;
    const lowerExtension = outputExtension.toLowerCase();
    let extension: string;
    if (snapshot.isHtml) {
      extension = lowerExtension === '.html' || lowerExtension === '.htm' ? outputExtension : '.html';
    } else {
      extension = outputExtension || '.txt';
    }

    return `${stem || 'output'}.rendered${extension}`;
  }

  private async pickTarget(snapshot: RenderSnapshot): Promise<ExportTarget | undefined> {
    const items: Array<vscode.QuickPickItem & { target: ExportTarget }> = [
      {
        label: '$(save) Save to File',
        description: this.getDefaultFileName(snapshot),
        target: 'file',
      },
      {
        label: '$(clippy) Copy to Clipboard',
        target: 'clipboard',
      },
      {
        label: '$(package) Save to File with Context Bundle',
        description: SHARES_DIRECTORY.join('/'),
        detail: 'Also writes the template source and context data as a shareable JSON bundle.',
        target: 'bundle',
      },
    ];

    const renderedTime = snapshot.renderedAt.toLocaleTimeString();
    const placeHolder = snapshot.isStale
      ? `The latest render failed. Exporting the last successful output from ${renderedTime}.`
      : `Export rendered output of ${path.posix.basename(snapshot.templateUri.path)}`;

    const pick = await vscode.window.showQuickPick(items, { placeHolder });
    return pick?.target;
  }

  private async copyToClipboard(snapshot: RenderSnapshot): Promise<void> {
    await vscode.env.clipboard.writeText(snapshot.rendered);
    this.output.appendLine(`[export] copied rendered output of ${this.describe(snapshot.templateUri)} to clipboard`);
    void vscode.window.showInformationMessage('Go Template Studio: Rendered output copied to clipboard.');
  }

  private async saveToFile(snapshot: RenderSnapshot, includeBundle: boolean): Promise<void> {
    const fileName = this.getDefaultFileName(snapshot);
    const templateDirectory = snapshot.templateUri.with({
      path: path.posix.dirname(snapshot.templateUri.path),
    });
    const extension = path.posix.extname(fileName).slice(1);
    const filters: Record<string, string[]> = snapshot.isHtml
      ? { HTML: ['html', 'htm'], 'All Files': ['*'] }
      : { [extension === 'txt' ? 'Text' : extension.toUpperCase()]: [extension], 'All Files': ['*'] };

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(templateDirectory, fileName),
      filters,
      saveLabel: 'Export',
      title: 'Export Rendered Output',
    });
    if (!target) {
      return;
    }

    await vscode.workspace.fs.writeFile(target, Buffer.from(snapshot.rendered, 'utf8'));
    this.output.appendLine(`[export] wrote rendered output to ${target.fsPath}`);

    let bundleUri: vscode.Uri | undefined;
    if (includeBundle) {
      bundleUri = await this.writeContextBundle(snapshot);
    }

    const actions = bundleUri ? ['Open', 'Reveal', 'Open Bundle'] : ['Open', 'Reveal'];
    const message = bundleUri
      ? `Exported rendered output to ${this.describe(target)} and saved a context bundle to ${this.describe(bundleUri)}.`
      : `Exported rendered output to ${this.describe(target)}.`;
    const selection = await vscode.window.showInformationMessage(message, ...actions);

    if (selection === 'Open') {
      await vscode.window.showTextDocument(target, { preview: false });
    } else if (selection === 'Reveal') {
      const revealCommand = target.scheme === 'file' ? 'revealFileInOS' : 'revealInExplorer';
      await vscode.commands.executeCommand(revealCommand, target);
    } else if (selection === 'Open Bundle' && bundleUri) {
      await vscode.window.showTextDocument(bundleUri, { preview: false });
    }
  }

  /**
   * Writes `{ template, context, renderedAt }` to `.gotemplatestudio/shares/<name>.json` in the
   * template's workspace folder (ux_brief 2C). Returns undefined when no workspace folder is open.
   *
   * TODO(export): capture template/context sources at render time so bundles exactly match the
   * exported output even if the files changed after the last successful render.
   */
  private async writeContextBundle(snapshot: RenderSnapshot): Promise<vscode.Uri | undefined> {
    const folder =
      vscode.workspace.getWorkspaceFolder(snapshot.templateUri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage(
        'Go Template Studio: Context bundles require an open workspace folder. Only the rendered output was saved.'
      );
      return undefined;
    }

    const templateSource = await this.readText(snapshot.templateUri);
    let context: { path: string; data?: unknown; source?: string } | null = null;
    if (snapshot.contextUri) {
      const contextSource = await this.readText(snapshot.contextUri);
      context = { path: this.describe(snapshot.contextUri) };
      if (path.posix.extname(snapshot.contextUri.path).toLowerCase() === '.json') {
        try {
          context.data = JSON.parse(contextSource) as unknown;
        } catch (error) {
          context.source = contextSource;
        }
      } else {
        // Non-JSON formats (YAML/TOML) are stored verbatim so the bundle stays format-agnostic.
        context.source = contextSource;
      }
    }

    const bundle = {
      version: 1,
      renderedAt: snapshot.renderedAt.toISOString(),
      template: {
        path: this.describe(snapshot.templateUri),
        source: templateSource,
      },
      context,
    };

    const stem = this.getDefaultFileName(snapshot).split('.rendered')[0];
    const timestamp = snapshot.renderedAt.toISOString().replace(/[:.]/g, '-');
    const sharesDirectory = vscode.Uri.joinPath(folder.uri, ...SHARES_DIRECTORY);
    await vscode.workspace.fs.createDirectory(sharesDirectory);
    const bundleUri = vscode.Uri.joinPath(sharesDirectory, `${stem}-${timestamp}.json`);
    await vscode.workspace.fs.writeFile(bundleUri, Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8'));
    this.output.appendLine(`[export] wrote context bundle to ${bundleUri.fsPath}`);
    return bundleUri;
  }

  private async readText(uri: vscode.Uri): Promise<string> {
    const openDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (openDocument) {
      return openDocument.getText();
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }

  private describe(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  }
}
