import * as vscode from 'vscode';
import { ConfigurationService } from '../services/configurationService';
import { ContextDescriptor, ContextStore } from './contextManager';

export class ContextAssociationManager {
  private readonly associations = new Map<string, string>();

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
