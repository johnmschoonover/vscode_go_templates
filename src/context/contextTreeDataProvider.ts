import * as vscode from 'vscode';
import { CONTEXT_FORMAT_LABELS, ContextDescriptor, ContextStore } from './contextManager';

/** `contextValue` for context file items; `package.json` menus match on it via `viewItem`. */
export const CONTEXT_TREE_ITEM_CONTEXT_VALUE = 'context-item';

export class ContextTreeItem extends vscode.TreeItem {
  public constructor(public readonly descriptor: ContextDescriptor) {
    super(descriptor.label, vscode.TreeItemCollapsibleState.None);
    const formatLabel = CONTEXT_FORMAT_LABELS[descriptor.format];
    // resourceUri + ThemeIcon.File lets the active file icon theme show a per-format icon.
    this.resourceUri = descriptor.uri;
    this.iconPath = vscode.ThemeIcon.File;
    this.description = `${formatLabel} · ${descriptor.relativePath}`;
    this.tooltip = `${descriptor.relativePath} (${formatLabel} context)`;
    this.contextValue = CONTEXT_TREE_ITEM_CONTEXT_VALUE;
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

  public getChildren(element?: ContextTreeItem): ContextTreeItem[] {
    if (element) {
      return [];
    }

    // Always return an array (possibly empty) so the `viewsWelcome` empty state renders.
    return this.store.getContexts().map((descriptor) => new ContextTreeItem(descriptor));
  }

  public refresh(): void {
    this.onDidChangeEmitter.fire(undefined);
  }
}
