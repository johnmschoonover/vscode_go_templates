import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationService } from '../services/configurationService';
import { Logger } from '../services/logger';

interface ContextItem {
  uri: vscode.Uri;
  label: string;
}

export class ContextManager implements vscode.TreeDataProvider<ContextItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ContextItem | undefined | null | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private contexts: ContextItem[] = [];

  public constructor(private readonly configuration: ConfigurationService, private readonly logger: Logger) {}

  public getTreeItem(element: ContextItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.resourceUri = element.uri;
    item.contextValue = 'context';
    item.command = {
      command: 'goTemplateStudio.selectContext',
      title: 'Select Context',
      arguments: [element.uri]
    };
    return item;
  }

  public getChildren(): ContextItem[] {
    return this.contexts;
  }

  public async refresh(): Promise<void> {
    this.contexts = await this.findContexts();
    this._onDidChangeTreeData.fire();
  }

  public dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  public async pickContext(_templateUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const items = this.contexts.map(context => ({ label: context.label, uri: context.uri }));
    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a context JSON file',
      canPickMany: false
    });
    return selection?.uri;
  }

  private async findContexts(): Promise<ContextItem[]> {
    const config = this.configuration.getConfiguration();
    const folders = vscode.workspace.workspaceFolders ?? [];
    const discovered: ContextItem[] = [];

    for (const folder of folders) {
      for (const dir of config.contextDirs) {
        const absolute = path.join(folder.uri.fsPath, dir);
        if (!fs.existsSync(absolute)) {
          continue;
        }

        const entries = await fs.promises.readdir(absolute, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
          }
          const uri = vscode.Uri.file(path.join(absolute, entry.name));
          discovered.push({ uri, label: entry.name.replace(/\.json$/i, '') });
        }
      }
    }

    if (!discovered.length) {
      this.logger.warn('No context files found. Configure goTemplateStudio.contextDirs or add JSON files.');
    }

    return discovered;
  }
}
