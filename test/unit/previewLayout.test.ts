import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
  DEFAULT_PREVIEW_LAYOUT,
  getPreviewPlacement,
  isPreviewLayout,
  NEW_GROUP_BELOW_COMMAND,
  resolvePreviewLayout,
  shouldRevealPreviewForEditor,
} from '../../src/services/previewLayout';

describe('previewLayout', () => {
  describe('isPreviewLayout', () => {
    it('accepts beside and below only', () => {
      expect(isPreviewLayout('beside')).toBe(true);
      expect(isPreviewLayout('below')).toBe(true);
      expect(isPreviewLayout('right')).toBe(false);
      expect(isPreviewLayout(undefined)).toBe(false);
      expect(isPreviewLayout(2)).toBe(false);
    });
  });

  describe('resolvePreviewLayout', () => {
    it('defaults to beside when nothing is persisted or configured', () => {
      expect(resolvePreviewLayout(undefined, undefined)).toBe('beside');
      expect(DEFAULT_PREVIEW_LAYOUT).toBe('beside');
    });

    it('uses the setting when nothing is persisted', () => {
      expect(resolvePreviewLayout(undefined, 'below')).toBe('below');
    });

    it('prefers the persisted workspace choice over the setting', () => {
      expect(resolvePreviewLayout('beside', 'below')).toBe('beside');
      expect(resolvePreviewLayout('below', 'beside')).toBe('below');
    });

    it('ignores invalid persisted or configured values', () => {
      expect(resolvePreviewLayout('sideways', 'below')).toBe('below');
      expect(resolvePreviewLayout('sideways', 'diagonal')).toBe('beside');
    });
  });

  describe('getPreviewPlacement', () => {
    it('opens beside the editor without a prepare command', () => {
      expect(getPreviewPlacement('beside')).toEqual({
        viewColumn: vscode.ViewColumn.Beside,
        restoreEditorFocus: false,
      });
    });

    it('creates a group below, targets the active (new) group, and restores editor focus', () => {
      expect(getPreviewPlacement('below')).toEqual({
        prepareCommand: NEW_GROUP_BELOW_COMMAND,
        viewColumn: vscode.ViewColumn.Active,
        restoreEditorFocus: true,
      });
      expect(NEW_GROUP_BELOW_COMMAND).toBe('workbench.action.newGroupBelow');
    });
  });

  describe('shouldRevealPreviewForEditor', () => {
    const base = {
      enabled: true,
      panelVisible: false,
      panelColumn: vscode.ViewColumn.Two,
      editorColumn: vscode.ViewColumn.One,
    };

    it('reveals a hidden preview in another group', () => {
      expect(shouldRevealPreviewForEditor(base)).toBe(true);
    });

    it('does nothing when the setting is off', () => {
      expect(shouldRevealPreviewForEditor({ ...base, enabled: false })).toBe(false);
    });

    it('does nothing when the preview is already visible', () => {
      expect(shouldRevealPreviewForEditor({ ...base, panelVisible: true })).toBe(false);
    });

    it('does not cover the editor when the preview shares its group', () => {
      expect(shouldRevealPreviewForEditor({ ...base, panelColumn: vscode.ViewColumn.One })).toBe(false);
    });

    it('reveals when either column is unknown', () => {
      expect(shouldRevealPreviewForEditor({ ...base, panelColumn: undefined })).toBe(true);
      expect(shouldRevealPreviewForEditor({ ...base, editorColumn: undefined })).toBe(true);
    });
  });
});
