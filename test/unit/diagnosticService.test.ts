import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { DiagnosticService } from '../../src/services/diagnosticService';
import type { RenderDiagnostic } from '../../src/services/rendererService';
import { __test } from '../__mocks__/vscode';

const templateUri = vscode.Uri.file('/ws/templates/page.tmpl');
const contextUri = vscode.Uri.file('/ws/context/data.json');

function collectionOf(): (typeof __test.diagnosticCollections)[number] {
  return __test.diagnosticCollections[0];
}

describe('DiagnosticService', () => {
  let service: DiagnosticService;

  beforeEach(() => {
    __test.reset();
    service = new DiagnosticService();
  });

  it('registers a diagnostics collection named goTemplateStudio', () => {
    expect(collectionOf().name).toBe('goTemplateStudio');
  });

  describe('severity mapping', () => {
    it('maps worker "error" to DiagnosticSeverity.Error and "warning" to Warning', () => {
      const input: RenderDiagnostic[] = [
        { message: 'boom', severity: 'error', line: 1 },
        { message: 'careful', severity: 'warning', line: 2 },
      ];

      service.applyDiagnostics(templateUri, undefined, input);

      const published = collectionOf().get(templateUri)!;
      expect(published.map((d) => d.severity)).toEqual([
        vscode.DiagnosticSeverity.Error,
        vscode.DiagnosticSeverity.Warning,
      ]);
      expect(published.every((d) => d.source === 'go-template-studio')).toBe(true);
    });

    it('carries the worker severity through to the preview diagnostics', () => {
      const result = service.applyDiagnostics(templateUri, undefined, [
        { message: 'a', severity: 'error', line: 1 },
        { message: 'b', severity: 'warning', line: 1 },
      ]);

      expect(result.map((d) => d.severity)).toEqual(['error', 'warning']);
    });
  });

  describe('position conversion', () => {
    it('converts 1-based line/column to 0-based', () => {
      const result = service.applyDiagnostics(templateUri, undefined, [
        { message: 'bad action', severity: 'error', line: 3, column: 7 },
      ]);

      expect(result).toEqual([
        { message: 'bad action', severity: 'error', line: 2, character: 6, source: 'template' },
      ]);

      const [diag] = collectionOf().get(templateUri)!;
      // The editor squiggle always spans the whole line of the 0-based line.
      expect(diag.range.start).toMatchObject({ line: 2, character: 0 });
      expect(diag.range.end.line).toBe(2);
      expect(diag.range.end.character).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('treats line 1 / column 1 as 0 / 0 rather than undefined', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'first', severity: 'error', line: 1, column: 1 },
      ]);

      expect(result.line).toBe(0);
      expect(result.character).toBe(0);
    });

    it('leaves line and character undefined and pins the range to line 0 when positions are missing', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'no position', severity: 'error' },
      ]);

      expect(result.line).toBeUndefined();
      expect(result.character).toBeUndefined();
      const [diag] = collectionOf().get(templateUri)!;
      expect(diag.range.start.line).toBe(0);
      expect(diag.range.end.line).toBe(0);
    });

    it('ignores non-positive line numbers and a column without a line', () => {
      const [zeroLine, columnOnly] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'zero', severity: 'error', line: 0, column: 4 },
        { message: 'col only', severity: 'error', column: 4 },
      ]);

      expect(zeroLine.line).toBeUndefined();
      expect(columnOnly.line).toBeUndefined();
      // column is still reported if the worker supplied it
      expect(columnOnly.character).toBe(3);
    });

    it('leaves character undefined when only a line is supplied', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'line only', severity: 'error', line: 5 },
      ]);

      expect(result.line).toBe(4);
      expect(result.character).toBeUndefined();
    });
  });

  describe('fallback parsing of Go "template: name:LINE:COL: msg" messages', () => {
    it('extracts line, column and trims the message prefix when the worker gave no line', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        {
          message: 'template: page.tmpl:12:5: executing "page.tmpl" at <.Missing>: map has no entry',
          severity: 'error',
        },
      ]);

      expect(result.line).toBe(11);
      expect(result.character).toBe(4);
      expect(result.message).toBe('executing "page.tmpl" at <.Missing>: map has no entry');
    });

    it('handles a location with a line but no column', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'template: page.tmpl:9: unexpected EOF', severity: 'error' },
      ]);

      expect(result.line).toBe(8);
      expect(result.character).toBeUndefined();
      expect(result.message).toBe('unexpected EOF');
    });

    it('does not override an explicit worker line', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'template: page.tmpl:99:1: nope', severity: 'error', line: 2, column: 3 },
      ]);

      expect(result.line).toBe(1);
      expect(result.character).toBe(2);
      expect(result.message).toBe('template: page.tmpl:99:1: nope');
    });

    it('leaves messages that do not match the Go format untouched', () => {
      const [result] = service.applyDiagnostics(templateUri, undefined, [
        { message: 'unexpected "}" in operand', severity: 'error' },
      ]);

      expect(result.message).toBe('unexpected "}" in operand');
      expect(result.line).toBeUndefined();
    });
  });

  describe('target file resolution', () => {
    it('attributes diagnostics with no file hint to the template', () => {
      const [result] = service.applyDiagnostics(templateUri, contextUri, [
        { message: 'x', severity: 'error', line: 1 },
      ]);

      expect(result.source).toBe('template');
      expect(collectionOf().get(templateUri)).toHaveLength(1);
      expect(collectionOf().get(contextUri)).toBeUndefined();
    });

    it('routes a diagnostic whose file matches the context to the context URI', () => {
      const [result] = service.applyDiagnostics(templateUri, contextUri, [
        { message: 'invalid JSON', severity: 'error', file: contextUri.fsPath, line: 4 },
      ]);

      expect(result.source).toBe('context');
      expect(collectionOf().get(contextUri)).toHaveLength(1);
      expect(collectionOf().get(templateUri)).toBeUndefined();
    });

    it('routes a diagnostic whose file matches the template to the template URI', () => {
      const [result] = service.applyDiagnostics(templateUri, contextUri, [
        { message: 'x', severity: 'error', file: templateUri.fsPath, line: 1 },
      ]);

      expect(result.source).toBe('template');
    });

    it('creates a URI from an unknown file hint and reports it as a context diagnostic', () => {
      const other = vscode.Uri.file('/ws/partials/header.tmpl');
      const [result] = service.applyDiagnostics(templateUri, contextUri, [
        { message: 'in partial', severity: 'error', file: other.fsPath, line: 1 },
      ]);

      expect(result.source).toBe('context');
      expect(collectionOf().get(other)).toHaveLength(1);
    });

    it('groups diagnostics for the same file under one collection entry', () => {
      service.applyDiagnostics(templateUri, contextUri, [
        { message: 'a', severity: 'error', line: 1 },
        { message: 'b', severity: 'warning', line: 2 },
        { message: 'c', severity: 'error', file: contextUri.fsPath, line: 1 },
      ]);

      expect(collectionOf().get(templateUri)).toHaveLength(2);
      expect(collectionOf().get(contextUri)).toHaveLength(1);
    });
  });

  describe('clearing', () => {
    it('clears previous template and context diagnostics when the worker reports none', () => {
      service.applyDiagnostics(templateUri, contextUri, [
        { message: 'a', severity: 'error', line: 1 },
        { message: 'c', severity: 'error', file: contextUri.fsPath, line: 1 },
      ]);
      expect(collectionOf().entries.size).toBe(2);

      const result = service.applyDiagnostics(templateUri, contextUri, []);

      expect(result).toEqual([]);
      expect(collectionOf().entries.size).toBe(0);
    });

    it('clears the template entry when a later run only reports context errors', () => {
      service.applyDiagnostics(templateUri, contextUri, [{ message: 'a', severity: 'error', line: 1 }]);

      service.applyDiagnostics(templateUri, contextUri, [
        { message: 'c', severity: 'error', file: contextUri.fsPath, line: 1 },
      ]);

      expect(collectionOf().get(templateUri)).toBeUndefined();
      expect(collectionOf().get(contextUri)).toHaveLength(1);
    });

    it('clears a stale context entry when a later run only reports template errors', () => {
      service.applyDiagnostics(templateUri, contextUri, [
        { message: 'c', severity: 'error', file: contextUri.fsPath, line: 1 },
      ]);

      service.applyDiagnostics(templateUri, contextUri, [{ message: 'a', severity: 'error', line: 1 }]);

      expect(collectionOf().get(contextUri)).toBeUndefined();
      expect(collectionOf().get(templateUri)).toHaveLength(1);
    });

    it('replaces rather than accumulates diagnostics across runs', () => {
      service.applyDiagnostics(templateUri, undefined, [
        { message: 'a', severity: 'error', line: 1 },
        { message: 'b', severity: 'error', line: 2 },
      ]);
      service.applyDiagnostics(templateUri, undefined, [{ message: 'c', severity: 'error', line: 3 }]);

      expect(collectionOf().get(templateUri)!.map((d) => d.message)).toEqual(['c']);
    });
  });

  it('disposes the underlying collection', () => {
    service.dispose();

    expect(collectionOf().disposed).toBe(true);
  });
});
