import { describe, expect, it } from 'vitest';
import {
  describeRenderStatus,
  formatRendererLabel,
  isRendererFallback,
  RENDERER_FALLBACK_TOOLTIP,
} from '../../src/services/renderStatus';

describe('renderStatus', () => {
  describe('isRendererFallback', () => {
    it('flags auto mode resolving to the system toolchain', () => {
      expect(isRendererFallback('auto', 'system')).toBe(true);
    });

    it('does not flag auto mode using the bundled worker', () => {
      expect(isRendererFallback('auto', 'bundled')).toBe(false);
    });

    it('does not flag explicit system or bundled modes', () => {
      expect(isRendererFallback('system', 'system')).toBe(false);
      expect(isRendererFallback('bundled', 'bundled')).toBe(false);
    });
  });

  describe('formatRendererLabel', () => {
    it('names the renderer for the preview footer', () => {
      expect(formatRendererLabel('bundled', false)).toBe('bundled renderer');
      expect(formatRendererLabel('system', false)).toBe('system Go');
      expect(formatRendererLabel('system', true)).toBe('system Go (auto fallback)');
    });

    it('returns undefined when the renderer is unknown', () => {
      expect(formatRendererLabel(undefined, false)).toBeUndefined();
    });
  });

  describe('describeRenderStatus', () => {
    it('reports nothing for a healthy render or no preview', () => {
      for (const state of [undefined, { degraded: false }, { degraded: false, rendererFallback: false }]) {
        expect(describeRenderStatus(state, true)).toEqual({
          warning: false,
          warningBackground: false,
          tooltipLines: [],
          accessibilityNote: '',
        });
      }
    });

    it('warns with a background when the last render failed', () => {
      const status = describeRenderStatus({ degraded: true, message: 'boom' }, true);

      expect(status.warning).toBe(true);
      expect(status.warningBackground).toBe(true);
      expect(status.tooltipLines).toEqual([
        'Last render failed: boom. The preview is showing the last successful output.',
      ]);
      expect(status.accessibilityNote).toBe('Last render failed.');
    });

    it('omits the last-good note when there is no successful output', () => {
      expect(describeRenderStatus({ degraded: true }, false).tooltipLines).toEqual(['Last render failed.']);
    });

    it('warns without a background on the auto -> system fallback', () => {
      const status = describeRenderStatus({ degraded: false, rendererFallback: true }, true);

      expect(status.warning).toBe(true);
      expect(status.warningBackground).toBe(false);
      expect(status.tooltipLines).toEqual([RENDERER_FALLBACK_TOOLTIP]);
      expect(status.accessibilityNote).toBe('Rendered with the system Go fallback.');
    });

    it('lists both reasons when a fallback render also failed', () => {
      const status = describeRenderStatus({ degraded: true, message: 'boom', rendererFallback: true }, false);

      expect(status.warning).toBe(true);
      expect(status.warningBackground).toBe(true);
      expect(status.tooltipLines).toEqual(['Last render failed: boom.', RENDERER_FALLBACK_TOOLTIP]);
      expect(status.accessibilityNote).toBe('Last render failed. Rendered with the system Go fallback.');
    });
  });
});
