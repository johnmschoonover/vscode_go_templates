import * as vscode from 'vscode';
import { Logger } from './logger';

export class ExportService {
  public constructor(private readonly logger: Logger) {}

  public async exportToFile(target: vscode.Uri, contents: string): Promise<void> {
    try {
      await vscode.workspace.fs.writeFile(target, Buffer.from(contents, 'utf-8'));
      vscode.window.showInformationMessage(`Rendered output exported to ${target.fsPath}`);
    } catch (error) {
      this.logger.error('Export failed', error);
      vscode.window.showErrorMessage('Failed to export rendered output.');
    }
  }

  public async exportToClipboard(contents: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(contents);
      vscode.window.showInformationMessage('Rendered output copied to clipboard.');
    } catch (error) {
      this.logger.error('Clipboard export failed', error);
      vscode.window.showErrorMessage('Failed to copy rendered output to clipboard.');
    }
  }
}
