import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('goTemplateStudio.showWelcome', async () => {
    const selection = await vscode.window.showInformationMessage(
      'Go Template Studio scaffolding is ready. Review the project docs for the MVP plan.',
      'Open PRD',
      'Open Technical Spec'
    );

    if (selection === 'Open PRD') {
      void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(context.extensionUri, 'PRD.md'));
    } else if (selection === 'Open Technical Spec') {
      void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(context.extensionUri, 'technical_spec.md'));
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // No-op: the extension only registers a simple command in this revision.
}
