import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../services/configurationService';
import type { WorkspaceConfiguration } from '../services/configurationService';

export interface ContextDescriptor {
  uri: vscode.Uri;
  label: string;
  relativePath: string;
}

const SUPPORTED_EXTENSIONS = ['.json', '.yaml', '.yml', '.toml'];

export class ContextStore implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private contexts: ContextDescriptor[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private configuration: WorkspaceConfiguration;

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor(private readonly configurationService: ConfigurationService) {
    this.configuration = configurationService.getConfiguration();
    configurationService.onDidChangeConfiguration((config) => {
      this.configuration = config;
      void this.refresh();
      this.registerWatchers();
    });
  }

  public async initialize(): Promise<void> {
    await this.refresh();
    this.registerWatchers();
  }

  public async refresh(): Promise<void> {
    this.contexts = await this.scanForContexts();
    this.onDidChangeEmitter.fire();
  }

  public getContexts(): ContextDescriptor[] {
    return this.contexts;
  }

  public dispose(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.onDidChangeEmitter.dispose();
  }

  private registerWatchers(): void {
    this.watchers.forEach((watcher) => watcher.dispose());
    this.watchers = [];

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }

    for (const dir of this.configuration.contextDirs) {
      const pattern = new vscode.RelativePattern(folder, `${dir}/**/*`);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => void this.refresh());
      watcher.onDidCreate(() => void this.refresh());
      watcher.onDidDelete(() => void this.refresh());
      this.watchers.push(watcher);
    }
  }

  private async scanForContexts(): Promise<ContextDescriptor[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return [];
    }

    const contexts: ContextDescriptor[] = [];

    for (const dir of this.configuration.contextDirs) {
      const dirUri = vscode.Uri.joinPath(folder.uri, dir);
      try {
        const stats = await vscode.workspace.fs.stat(dirUri);
        if (stats.type !== vscode.FileType.Directory) {
          continue;
        }
      } catch (error) {
        continue;
      }

      await this.walkDirectory(dirUri, dir, contexts);
    }

    contexts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return contexts;
  }

  private async walkDirectory(baseUri: vscode.Uri, relativeRoot: string, accumulator: ContextDescriptor[]): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(baseUri);
    for (const [name, fileType] of entries) {
      const entryUri = vscode.Uri.joinPath(baseUri, name);
      const relativePath = path.posix.join(relativeRoot, name);
      if (fileType === vscode.FileType.Directory) {
        await this.walkDirectory(entryUri, relativePath, accumulator);
        continue;
      }

      if (!SUPPORTED_EXTENSIONS.includes(path.extname(name).toLowerCase())) {
        continue;
      }

      accumulator.push({
        uri: entryUri,
        label: path.basename(name, path.extname(name)),
        relativePath,
      });
    }
  }
}
