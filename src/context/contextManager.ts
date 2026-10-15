import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../services/configurationService';
import type { WorkspaceConfiguration } from '../services/configurationService';

export type ContextFormat = 'json' | 'yaml' | 'toml';

export interface ContextDescriptor {
  uri: vscode.Uri;
  label: string;
  relativePath: string;
  format: ContextFormat;
}

/**
 * File extensions the Go worker can decode (see `contextFormatForPath` in
 * go-worker/main.go). Keep both lists in sync when adding formats.
 */
export const SUPPORTED_CONTEXT_EXTENSIONS: readonly string[] = ['.json', '.yaml', '.yml', '.toml'];

export const CONTEXT_FORMAT_LABELS: Readonly<Record<ContextFormat, string>> = {
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
};

/** Returns the context format for a file name, or undefined when unsupported. */
export function contextFormatFromFileName(fileName: string): ContextFormat | undefined {
  switch (path.extname(fileName).toLowerCase()) {
    case '.json':
      return 'json';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.toml':
      return 'toml';
    default:
      return undefined;
  }
}

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

  /** Context directories (workspace-relative) from `.vscode/goTemplateStudio.json`. */
  public getContextDirectories(): string[] {
    return [...this.configuration.contextDirs];
  }

  public findByUri(uri: vscode.Uri): ContextDescriptor | undefined {
    const target = uri.toString();
    return this.contexts.find((descriptor) => descriptor.uri.toString() === target);
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
      // Watch every file (not just SUPPORTED_CONTEXT_EXTENSIONS) so folder
      // deletions and renames also trigger a rescan; the scan filters formats.
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

      const format = contextFormatFromFileName(name);
      if (!format) {
        continue;
      }

      accumulator.push({
        uri: entryUri,
        label: path.basename(name, path.extname(name)),
        relativePath,
        format,
      });
    }
  }
}
