import * as vscode from 'vscode';
import { spawn } from 'child_process';

export interface RenderResult {
  rendered: string;
  diagnostics: Array<{ message: string; severity: 'error' | 'warning' }>;
  durationMs: number;
}

interface GoWorkerResponse {
  rendered?: string;
  diagnostics?: Array<{ message: string; severity: 'error' | 'warning' }>;
  durationMs?: number;
  error?: string;
}

export class RendererService {
  public constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}

  public async render(template: vscode.Uri, contextFile?: vscode.Uri): Promise<RenderResult> {
    const goBinary = vscode.workspace.getConfiguration('goTemplateStudio').get<string>('goBinary', 'go');
    const workerUri = vscode.Uri.joinPath(this.context.extensionUri, 'go-worker', 'main.go');
    const commandArgs = ['run', workerUri.fsPath, '--template', template.fsPath];
    if (contextFile) {
      commandArgs.push('--context', contextFile.fsPath);
    }

    this.output.appendLine(`[renderer] Executing: ${goBinary} ${commandArgs.join(' ')}`);

    const response = await this.spawnProcess(goBinary, commandArgs);

    if (response.error) {
      const message = `Go renderer reported an error: ${response.error}`;
      this.output.appendLine(`[renderer] error: ${message}`);
      throw new Error(message);
    }

    return {
      rendered: response.rendered ?? '',
      diagnostics: response.diagnostics ?? [],
      durationMs: response.durationMs ?? 0,
    };
  }

  private spawnProcess(command: string, args: string[]): Promise<GoWorkerResponse> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute Go renderer: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Go renderer exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as GoWorkerResponse;
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Failed to parse renderer response: ${(error as Error).message}\nOutput: ${stdout}`));
        }
      });
    });
  }
}
