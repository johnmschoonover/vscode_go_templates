/**
 * Pure helpers that describe how a preview was rendered. Kept free of the `vscode` module so the
 * status bar and preview footer wording can be unit tested directly.
 */

/** The renderer that actually ran: the packaged `go-worker` binary or `go run` with the system toolchain. */
export type RendererMode = 'bundled' | 'system';

/** The `goTemplateStudio.rendererMode` setting. */
export type RendererModeSetting = 'auto' | 'bundled' | 'system';

/**
 * True when `auto` mode had to fall back to the system Go toolchain because no bundled renderer is
 * available. Explicitly choosing `system` is not a fallback.
 */
export function isRendererFallback(configured: RendererModeSetting, resolved: RendererMode): boolean {
  return configured === 'auto' && resolved === 'system';
}

/** Short label for the preview footer, e.g. "bundled renderer" or "system Go (auto fallback)". */
export function formatRendererLabel(mode: RendererMode | undefined, fallback: boolean): string | undefined {
  if (!mode) {
    return undefined;
  }
  if (mode === 'bundled') {
    return 'bundled renderer';
  }
  return fallback ? 'system Go (auto fallback)' : 'system Go';
}

/** The subset of a preview's render state the status bar needs. */
export interface RenderStatusInput {
  /** The latest render failed. */
  readonly degraded: boolean;
  readonly message?: string;
  /** The latest render used the `auto` -> system Go fallback. */
  readonly rendererFallback?: boolean;
}

export interface RenderStatusSummary {
  /** Show the `$(warning)` icon. */
  readonly warning: boolean;
  /** Use the warning background (reserved for failed renders). */
  readonly warningBackground: boolean;
  /** Tooltip lines explaining each warning, in display order. */
  readonly tooltipLines: string[];
  /** Short sentence(s) appended to the screen reader label; empty when there is nothing to report. */
  readonly accessibilityNote: string;
}

export const RENDERER_FALLBACK_TOOLTIP =
  'Rendered with the system Go toolchain (go run) because no bundled renderer is available for this platform. ' +
  'Renders may be slower and require Go. Set goTemplateStudio.rendererMode to "system" to silence this warning.';

/**
 * Decides whether the status bar should flag a degraded render: the last render failed, or `auto`
 * renderer mode fell back to the system Go toolchain.
 */
export function describeRenderStatus(
  state: RenderStatusInput | undefined,
  hasLastGoodOutput: boolean
): RenderStatusSummary {
  const failed = Boolean(state?.degraded);
  const fallback = Boolean(state?.rendererFallback);
  const tooltipLines: string[] = [];
  const notes: string[] = [];

  if (failed) {
    const fallbackNote = hasLastGoodOutput ? ' The preview is showing the last successful output.' : '';
    tooltipLines.push(`Last render failed${state?.message ? `: ${state.message}` : ''}.${fallbackNote}`);
    notes.push('Last render failed.');
  }
  if (fallback) {
    tooltipLines.push(RENDERER_FALLBACK_TOOLTIP);
    notes.push('Rendered with the system Go fallback.');
  }

  return {
    warning: failed || fallback,
    warningBackground: failed,
    tooltipLines,
    accessibilityNote: notes.join(' '),
  };
}
