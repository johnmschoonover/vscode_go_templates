import * as vscode from 'vscode';

/**
 * Pure helpers for where preview panels open and when they follow the active editor. PreviewManager
 * applies the decisions; keeping them here lets the rules be unit tested without a webview.
 */

export const PREVIEW_LAYOUTS = ['beside', 'below'] as const;
export type PreviewLayout = (typeof PREVIEW_LAYOUTS)[number];

export const PREVIEW_LAYOUT_LABELS: Record<PreviewLayout, string> = {
  beside: 'Beside',
  below: 'Below',
};

export const DEFAULT_PREVIEW_LAYOUT: PreviewLayout = 'beside';

/** VS Code command that creates (and focuses) an empty editor group below the active one. */
export const NEW_GROUP_BELOW_COMMAND = 'workbench.action.newGroupBelow';

export function isPreviewLayout(value: unknown): value is PreviewLayout {
  return typeof value === 'string' && (PREVIEW_LAYOUTS as readonly string[]).includes(value);
}

/**
 * The per-workspace choice (from `Set Preview Layout`) wins; otherwise the
 * `goTemplateStudio.preview.layout` setting; otherwise `beside`.
 */
export function resolvePreviewLayout(persisted: unknown, configured: unknown): PreviewLayout {
  if (isPreviewLayout(persisted)) {
    return persisted;
  }
  if (isPreviewLayout(configured)) {
    return configured;
  }
  return DEFAULT_PREVIEW_LAYOUT;
}

export interface PreviewPlacement {
  /** Command to run before creating the panel so the target editor group exists, if any. */
  readonly prepareCommand?: string;
  /** Column passed to `createWebviewPanel`. */
  readonly viewColumn: vscode.ViewColumn;
  /** Hand focus back to the source editor after the panel is created (the prepare command moves it). */
  readonly restoreEditorFocus: boolean;
}

export function getPreviewPlacement(layout: PreviewLayout): PreviewPlacement {
  if (layout === 'below') {
    // TODO(layout): newGroupBelow always adds a group, even when one already exists below the editor,
    // and relies on the new group becoming active so ViewColumn.Active targets it. Reuse an existing
    // group below once VS Code exposes group geometry (tabGroups has no position information).
    return {
      prepareCommand: NEW_GROUP_BELOW_COMMAND,
      viewColumn: vscode.ViewColumn.Active,
      restoreEditorFocus: true,
    };
  }
  return { viewColumn: vscode.ViewColumn.Beside, restoreEditorFocus: false };
}

export interface FollowEditorInput {
  /** `goTemplateStudio.preview.followActiveEditor`. */
  readonly enabled: boolean;
  /** The preview panel is already visible in its group. */
  readonly panelVisible: boolean;
  readonly panelColumn?: vscode.ViewColumn;
  readonly editorColumn?: vscode.ViewColumn;
}

/**
 * Whether switching to a template editor should reveal that template's preview panel. Skips
 * panels that are already visible, and panels sharing the editor's group (revealing them would hide
 * the editor the user just switched to).
 */
export function shouldRevealPreviewForEditor(input: FollowEditorInput): boolean {
  if (!input.enabled || input.panelVisible) {
    return false;
  }
  if (input.panelColumn !== undefined && input.editorColumn !== undefined && input.panelColumn === input.editorColumn) {
    return false;
  }
  return true;
}
