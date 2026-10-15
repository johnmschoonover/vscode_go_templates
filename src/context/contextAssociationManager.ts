import * as vscode from 'vscode';
import { ConfigurationService } from '../services/configurationService';
import { ContextDescriptor, ContextStore } from './contextManager';

export class ContextAssociationManager {
  private readonly associations = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();

  /** Fires with the template URI whose association changed, or undefined for bulk updates. */
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly contextStore: ContextStore,
    private readonly output: vscode.OutputChannel
  ) {
    const config = configurationService.getConfiguration();
    for (const [templatePath, contextPath] of Object.entries(config.defaultContext)) {
      this.associations.set(this.normalizePath(templatePath), contextPath);
    }

    configurationService.onDidChangeConfiguration((updated) => {
      for (const [templatePath, contextPath] of Object.entries(updated.defaultContext)) {
        const normalized = this.normalizePath(templatePath);
        if (!this.associations.has(normalized)) {
          this.associations.set(normalized, contextPath);
        }
      }
      this.onDidChangeEmitter.fire(undefined);
    });
  }

  public getActiveContext(templateUri: vscode.Uri): ContextDescriptor | undefined {
    const relativeTemplate = this.workspaceRelativePath(templateUri);
    if (!relativeTemplate) {
      return undefined;
    }

    const configuredPath = this.associations.get(relativeTemplate);
    if (!configuredPath) {
      return undefined;
    }

    return this.contextStore.getContexts().find((ctx) => ctx.relativePath === configuredPath);
  }

  public setActiveContext(templateUri: vscode.Uri, context: ContextDescriptor): void {
    const relativeTemplate = this.workspaceRelativePath(templateUri);
    if (!relativeTemplate) {
      return;
    }

    this.associations.set(relativeTemplate, context.relativePath);
    this.output.appendLine(`[context] ${relativeTemplate} -> ${context.relativePath}`);
    this.onDidChangeEmitter.fire(templateUri);
  }

  /**
   * Forgets every template association that points at `context` (e.g. after the file is deleted) and
   * returns how many were removed. Persisted defaultContext entries are only dropped in memory.
   */
  public clearContext(context: Pick<ContextDescriptor, 'relativePath'>): number {
    const target = this.normalizePath(context.relativePath);
    let removed = 0;
    for (const [templatePath, contextPath] of [...this.associations.entries()]) {
      if (this.normalizePath(contextPath) === target) {
        this.associations.delete(templatePath);
        removed += 1;
      }
    }

    if (removed > 0) {
      this.output.appendLine(`[context] cleared ${removed} association(s) to ${context.relativePath}`);
      this.onDidChangeEmitter.fire(undefined);
    }
    return removed;
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  public listContexts(): ContextDescriptor[] {
    return this.contextStore.getContexts();
  }

  private workspaceRelativePath(uri: vscode.Uri): string | undefined {
    const relative = vscode.workspace.asRelativePath(uri, false);
    if (!relative || relative.startsWith('..')) {
      return undefined;
    }

    return relative.replace(/\\/g, '/');
  }

  private normalizePath(input: string): string {
    return input.replace(/\\/g, '/');
  }
}
