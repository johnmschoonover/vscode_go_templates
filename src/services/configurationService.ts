import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from './logger';

export interface WorkspaceConfiguration {
  templateRoots: string[];
  contextDirs: string[];
  defaultContext: Record<string, string>;
}

const CONFIG_FILE = path.join('.vscode', 'goTemplateStudio.json');

export class ConfigurationService {
  private cached?: WorkspaceConfiguration;

  public constructor(private readonly logger: Logger) {}

  public getConfiguration(): WorkspaceConfiguration {
    if (!this.cached) {
      this.cached = this.readConfiguration();
    }
    return this.cached;
  }

  public invalidate(): void {
    this.cached = undefined;
  }

  private readConfiguration(): WorkspaceConfiguration {
    const settings = vscode.workspace.getConfiguration('goTemplateStudio');
    const templateRoots = settings.get<string[]>('templateRoots', ['templates']);
    const contextDirs = settings.get<string[]>('contextDirs', ['context']);
    const defaultContext: Record<string, string> = {};

    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const configPath = path.join(folder.uri.fsPath, CONFIG_FILE);
      if (fs.existsSync(configPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<WorkspaceConfiguration>;
          Object.assign(defaultContext, parsed.defaultContext ?? {});
        } catch (error) {
          this.logger.warn(`Failed to parse ${configPath}`);
        }
      }
    }

    return { templateRoots, contextDirs, defaultContext };
  }
}
