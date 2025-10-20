import * as vscode from 'vscode';
import { Logger } from './logger';

type TelemetryRecord = {
  event: string;
  timestamp: number;
  properties?: Record<string, string>;
};

export class TelemetryService {
  private readonly buffer: TelemetryRecord[] = [];

  public constructor(
    _context: vscode.ExtensionContext,
    private readonly logger: Logger
  ) {}

  public recordEvent(eventName: string, properties?: Record<string, string>): void {
    const enabled = vscode.workspace.getConfiguration('goTemplateStudio').get<boolean>('telemetryEnabled', false);
    if (!enabled) {
      return;
    }

    this.buffer.push({ event: eventName, properties, timestamp: Date.now() });
    if (this.buffer.length > 50) {
      this.flush();
    }
  }

  public flush(): void {
    if (!this.buffer.length) {
      return;
    }
    this.logger.info(`Telemetry events captured: ${this.buffer.length}`);
    this.buffer.length = 0;
  }

  public dispose(): void {
    this.flush();
  }
}
