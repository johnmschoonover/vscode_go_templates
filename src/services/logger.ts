import * as vscode from 'vscode';

type LogLevel = 'info' | 'warn' | 'error';

const channel = vscode.window.createOutputChannel('Go Template Studio');

export class Logger {
  private readonly log = (level: LogLevel, message: string): void => {
    const timestamp = new Date().toISOString();
    channel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  };

  public info(message: string): void {
    this.log('info', message);
  }

  public warn(message: string): void {
    this.log('warn', message);
  }

  public error(message: string, err?: unknown): void {
    const suffix = err instanceof Error ? `: ${err.message}` : '';
    this.log('error', `${message}${suffix}`);
  }

  public dispose(): void {
    channel.dispose();
  }
}
