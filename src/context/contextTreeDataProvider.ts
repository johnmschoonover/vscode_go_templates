import * as vscode from 'vscode';
import { ContextDescriptor, ContextStore } from './contextManager';

export class ContextTreeItem extends vscode.TreeItem {
  public constructor(public readonly descriptor: ContextDescriptor) {
    super(descriptor.label, vscode.TreeItemCollapsibleState.None);
    this.description = descriptor.relativePath;
    this.contextValue = 'context-item';
    this.command = {
      command: 'goTemplateStudio.openContextFile',
      title: 'Open Context',
      arguments: [descriptor.uri],
    };
  }
}

export class ContextTreeDataProvider implements vscode.TreeDataProvider<ContextTreeItem> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<ContextTreeItem | undefined | null | void>();

  public readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  public constructor(private readonly store: ContextStore) {
    store.onDidChange(() => this.onDidChangeEmitter.fire(undefined));
  }

  public getTreeItem(element: ContextTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): vscode.ProviderResult<ContextTreeItem[]> {
    return this.store.getContexts().map((descriptor) => new ContextTreeItem(descriptor));
  }

  public refresh(): void {
    this.onDidChangeEmitter.fire(undefined);
  }
}
