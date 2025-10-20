import * as vscode from 'vscode';

export interface WorkspaceConfiguration {
  templateRoots: string[];
  contextDirs: string[];
  defaultContext: Record<string, string>;
}

const DEFAULT_CONFIGURATION: WorkspaceConfiguration = Object.freeze({
  templateRoots: ['templates'],
  contextDirs: ['context'],
  defaultContext: {},
});

function cloneDefaultConfiguration(): WorkspaceConfiguration {
  return {
    templateRoots: [...DEFAULT_CONFIGURATION.templateRoots],
    contextDirs: [...DEFAULT_CONFIGURATION.contextDirs],
    defaultContext: { ...DEFAULT_CONFIGURATION.defaultContext },
  };
}

export class ConfigurationService {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<WorkspaceConfiguration>();
  private currentConfiguration: WorkspaceConfiguration = cloneDefaultConfiguration();
  private watcher: vscode.FileSystemWatcher | undefined;

  public readonly onDidChangeConfiguration = this.onDidChangeEmitter.event;

  public async initialize(): Promise<void> {
    await this.loadConfiguration();
    this.registerWatcher();
  }

  public getConfiguration(): WorkspaceConfiguration {
    return this.currentConfiguration;
  }

  private get workspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  private async loadConfiguration(): Promise<void> {
    const folder = this.workspaceFolder;
    if (!folder) {
      this.currentConfiguration = cloneDefaultConfiguration();
      this.onDidChangeEmitter.fire(this.currentConfiguration);
      return;
    }

    try {
      const configUri = vscode.Uri.joinPath(folder.uri, '.vscode', 'goTemplateStudio.json');
      const buffer = await vscode.workspace.fs.readFile(configUri);
      const parsed = JSON.parse(buffer.toString()) as Partial<WorkspaceConfiguration>;
      this.currentConfiguration = {
        templateRoots: Array.isArray(parsed.templateRoots) && parsed.templateRoots.length > 0
          ? parsed.templateRoots
          : [...DEFAULT_CONFIGURATION.templateRoots],
        contextDirs: Array.isArray(parsed.contextDirs) && parsed.contextDirs.length > 0
          ? parsed.contextDirs
          : [...DEFAULT_CONFIGURATION.contextDirs],
        defaultContext: typeof parsed.defaultContext === 'object' && parsed.defaultContext !== null
          ? parsed.defaultContext
          : { ...DEFAULT_CONFIGURATION.defaultContext },
      };
    } catch (error) {
      // If the configuration file doesn't exist or is invalid, fall back to defaults.
      this.currentConfiguration = cloneDefaultConfiguration();
    }

    this.onDidChangeEmitter.fire(this.currentConfiguration);
  }

  private registerWatcher(): void {
    const folder = this.workspaceFolder;
    if (!folder) {
      return;
    }

    const pattern = new vscode.RelativePattern(folder, '.vscode/goTemplateStudio.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidChange(() => void this.loadConfiguration());
    this.watcher.onDidCreate(() => void this.loadConfiguration());
    this.watcher.onDidDelete(() => void this.loadConfiguration());
  }

  public dispose(): void {
    this.watcher?.dispose();
    this.onDidChangeEmitter.dispose();
  }
}
