import * as vscode from 'vscode';
import { RenderDiagnostic } from './rendererService';

export interface PreviewDiagnostic {
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly line?: number;
  readonly character?: number;
  readonly source: 'template' | 'context';
}

export class DiagnosticService implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('goTemplateStudio');

  public dispose(): void {
    this.collection.dispose();
  }

  public applyDiagnostics(
    templateUri: vscode.Uri,
    contextUri: vscode.Uri | undefined,
    diagnostics: RenderDiagnostic[]
  ): PreviewDiagnostic[] {
    const previewDiagnostics: PreviewDiagnostic[] = [];
    const entries = new Map<string, vscode.Diagnostic[]>();

    for (const diagnostic of diagnostics) {
      const targetUri = this.resolveTargetUri(templateUri, contextUri, diagnostic.file);
      const key = targetUri.toString();

      const normalized = this.normalizeDiagnostic(diagnostic);
      const vscodeDiag = new vscode.Diagnostic(
        normalized.range,
        normalized.message,
        diagnostic.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error
      );
      vscodeDiag.source = 'go-template-studio';

      const collection = entries.get(key) ?? [];
      collection.push(vscodeDiag);
      entries.set(key, collection);

      previewDiagnostics.push({
        message: normalized.message,
        severity: diagnostic.severity,
        line: normalized.line,
        character: normalized.character,
        source: this.isSameUri(targetUri, templateUri) ? 'template' : 'context',
      });
    }

    if (diagnostics.length === 0) {
      this.collection.delete(templateUri);
      if (contextUri) {
        this.collection.delete(contextUri);
      }
      return previewDiagnostics;
    }

    for (const [uriString, diagList] of entries.entries()) {
      this.collection.set(vscode.Uri.parse(uriString), diagList);
    }

    const templateKey = templateUri.toString();
    if (!entries.has(templateKey)) {
      this.collection.delete(templateUri);
    }

    if (contextUri) {
      const contextKey = contextUri.toString();
      if (!entries.has(contextKey)) {
        this.collection.delete(contextUri);
      }
    }

    return previewDiagnostics;
  }

  private resolveTargetUri(
    templateUri: vscode.Uri,
    contextUri: vscode.Uri | undefined,
    fileHint?: string
  ): vscode.Uri {
    if (fileHint) {
      if (this.matchesUri(templateUri, fileHint)) {
        return templateUri;
      }
      if (contextUri && this.matchesUri(contextUri, fileHint)) {
        return contextUri;
      }
      try {
        return vscode.Uri.file(fileHint);
      } catch (error) {
        // Fall through to default
      }
    }

    return templateUri;
  }

  private matchesUri(candidate: vscode.Uri, fileHint: string): boolean {
    return this.normalizePath(candidate.fsPath) === this.normalizePath(fileHint);
  }

  private normalizePath(value: string): string {
    return process.platform === 'win32' ? value.toLowerCase() : value;
  }

  private isSameUri(left: vscode.Uri, right: vscode.Uri): boolean {
    return this.normalizePath(left.toString()) === this.normalizePath(right.toString());
  }

  private normalizeDiagnostic(diagnostic: RenderDiagnostic): {
    readonly message: string;
    readonly range: vscode.Range;
    readonly line?: number;
    readonly character?: number;
  } {
    let message = diagnostic.message;
    let line = diagnostic.line;
    let column = diagnostic.column;

    if (!line || line <= 0) {
      const parsed = this.parseTemplateLocation(message);
      if (parsed) {
        line = parsed.line;
        column = parsed.column;
        message = parsed.message;
      }
    }

    const zeroBasedLine = line && line > 0 ? line - 1 : 0;
    const zeroBasedColumn = column && column > 0 ? column - 1 : 0;

    const range = new vscode.Range(
      new vscode.Position(zeroBasedLine, 0),
      new vscode.Position(zeroBasedLine, Number.MAX_SAFE_INTEGER)
    );

    return {
      message,
      range,
      line: line && line > 0 ? zeroBasedLine : undefined,
      character: column && column > 0 ? zeroBasedColumn : undefined,
    };
  }

  private parseTemplateLocation(message: string):
    | { readonly line: number; readonly column?: number; readonly message: string }
    | undefined {
    const match = message.match(/^template:\s+[^:]+:(\d+)(?::(\d+))?:\s*(.*)$/);
    if (!match) {
      return undefined;
    }

    const [, lineString, columnString, remaining] = match;
    const line = parseInt(lineString, 10);
    const column = columnString ? parseInt(columnString, 10) : undefined;

    return {
      line: Number.isNaN(line) ? 0 : line,
      column: column && !Number.isNaN(column) ? column : undefined,
      message: remaining || message,
    };
  }
}
