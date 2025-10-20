import * as vscode from 'vscode';
import { Logger } from './logger';

export interface RenderRequest {
  templateUri: vscode.Uri;
  context?: Record<string, unknown>;
  viewMode: 'html' | 'text';
}

export interface RenderResponse {
  rendered: string;
  diagnostics: vscode.Diagnostic[];
  durationMs: number;
}

export class RendererService {
  public constructor(private readonly logger: Logger) {}

  public async render(request: RenderRequest): Promise<RenderResponse> {
    const start = Date.now();
    let rendered = '';
    const diagnostics: vscode.Diagnostic[] = [];

    try {
      const templateContent = Buffer.from(await vscode.workspace.fs.readFile(request.templateUri)).toString('utf-8');
      rendered = this.simplePlaceholderRender(templateContent, request.context ?? {});
      if (request.viewMode === 'html') {
        rendered = this.wrapHtml(rendered);
      }
    } catch (error) {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        error instanceof Error ? error.message : 'Failed to render template',
        vscode.DiagnosticSeverity.Error
      );
      diagnostics.push(diagnostic);
      this.logger.error('Template render failed', error);
    }

    return {
      rendered,
      diagnostics,
      durationMs: Date.now() - start
    };
  }

  private simplePlaceholderRender(template: string, context: Record<string, unknown>): string {
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(placeholder, String(value));
    }
    return result;
  }

  private wrapHtml(rendered: string): string {
    return `<!DOCTYPE html><html><body>${rendered}</body></html>`;
  }
}
