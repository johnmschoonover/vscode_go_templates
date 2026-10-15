import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isRendererFallback, RendererMode, RendererModeSetting } from './renderStatus';

export interface RenderDiagnostic {
  message: string;
  severity: 'error' | 'warning';
  file?: string;
  line?: number;
  column?: number;
}

export interface RenderResult {
  rendered: string;
  diagnostics: RenderDiagnostic[];
  durationMs: number;
  errorMessage?: string;
  /** The renderer that produced this result. */
  rendererMode: RendererMode;
  /** True when `rendererMode` is `auto` and no bundled worker was found, so `go run` was used instead. */
  rendererFallback: boolean;
}

interface GoWorkerResponse {
  rendered?: string;
  diagnostics?: RenderDiagnostic[];
  durationMs?: number;
  error?: string;
}

interface FileSnapshot {
  readonly fsPath: string;
  dispose(): Promise<void>;
}

export class RendererService {
  public constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}

  public async render(template: vscode.Uri, contextFile?: vscode.Uri): Promise<RenderResult> {
    const templateSnapshot = await this.createSnapshot(template);
    const contextSnapshot = contextFile ? await this.createSnapshot(contextFile) : undefined;

    try {
      const { command, args, mode, configuredMode, cwd } = await this.resolveRendererCommand(
        templateSnapshot.fsPath,
        contextSnapshot?.fsPath
      );
      this.output.appendLine(`[renderer] Executing (${mode}): ${command} ${args.join(' ')}`);

      const response = await this.spawnProcess(command, args, cwd);

      return {
        rendered: response.rendered ?? '',
        diagnostics: response.diagnostics ?? [],
        durationMs: response.durationMs ?? 0,
        errorMessage: response.error,
        rendererMode: mode,
        rendererFallback: isRendererFallback(configuredMode, mode),
      };
    } finally {
      await templateSnapshot.dispose();
      await contextSnapshot?.dispose();
    }
  }

  private async resolveRendererCommand(
    templatePath: string,
    contextPath?: string
  ): Promise<{
    command: string;
    args: string[];
    mode: RendererMode;
    configuredMode: RendererModeSetting;
    cwd?: string;
  }> {
    const config = vscode.workspace.getConfiguration('goTemplateStudio');
    const goBinary = config.get<string>('goBinary', 'go');
    const rendererMode = config.get<RendererModeSetting>('rendererMode', 'auto');
    const bundledBinary = await this.getBundledWorkerPath();

    const needsBundled = rendererMode === 'bundled';
    const preferBundled = rendererMode === 'auto' ? bundledBinary !== undefined : rendererMode === 'bundled';

    if (needsBundled && !bundledBinary) {
      throw new Error(
        'Bundled Go renderer is required but not available. Ensure the extension was installed from a tagged release or switch goTemplateStudio.rendererMode to "system".',
      );
    }

    const args = ['--template', templatePath];
    if (contextPath) {
      args.push('--context', contextPath);
    }

    if (preferBundled && bundledBinary) {
      return { command: bundledBinary, args, mode: 'bundled', configuredMode: rendererMode };
    }

    // Run the worker as a package from its module directory so go.mod/go.sum
    // resolve third-party decoders (YAML/TOML). `go run <file>` from another
    // working directory cannot see the module's requirements.
    const workerDir = vscode.Uri.joinPath(this.context.extensionUri, 'go-worker');
    return {
      command: goBinary,
      args: ['run', '.', ...args],
      mode: 'system',
      configuredMode: rendererMode,
      cwd: workerDir.fsPath,
    };
  }

  private async createSnapshot(uri: vscode.Uri): Promise<FileSnapshot> {
    const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (!document || !document.isDirty) {
      return {
        fsPath: uri.fsPath,
        dispose: async () => {
          // no-op
        },
      };
    }

    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'go-template-preview-'));
    const tempFile = path.join(tempDirectory, path.basename(uri.fsPath));
    await fs.writeFile(tempFile, document.getText(), 'utf8');

    return {
      fsPath: tempFile,
      dispose: async () => {
        try {
          await fs.rm(tempDirectory, { recursive: true, force: true });
        } catch (error) {
          this.output.appendLine(
            `[renderer] Failed to clean up temporary snapshot at ${tempDirectory}: ${(error as Error).message}`
          );
        }
      },
    };
  }

  private async getBundledWorkerPath(): Promise<string | undefined> {
    const platform = process.platform;
    const arch = process.arch;
    const platformKey = (() => {
      switch (platform) {
        case 'darwin':
          return 'darwin';
        case 'linux':
          return 'linux';
        case 'win32':
        case 'cygwin':
          return 'win32';
        default:
          return undefined;
      }
    })();
    const archKey = (() => {
      switch (arch) {
        case 'x64':
          return 'x64';
        case 'arm64':
          return 'arm64';
        default:
          return undefined;
      }
    })();
    if (!platformKey || !archKey) {
      return undefined;
    }

    const directory = `${platformKey}-${archKey}`;
    const fileName = platformKey === 'win32' ? 'go-worker.exe' : 'go-worker';
    const binaryUri = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'bin', directory, fileName);

    try {
      const stats = await fs.stat(binaryUri.fsPath);
      if (!stats.isFile()) {
        return undefined;
      }
      if (platformKey !== 'win32') {
        await fs.chmod(binaryUri.fsPath, 0o755);
      }
      return binaryUri.fsPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      this.output.appendLine(`[renderer] Failed to access bundled renderer: ${(error as Error).message}`);
      return undefined;
    }
  }

  private spawnProcess(command: string, args: string[], cwd?: string): Promise<GoWorkerResponse> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
