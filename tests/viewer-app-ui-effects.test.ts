import { describe, expect, it, vi } from 'vitest';
import { applyUiEffects } from '../src/app/viewer-app-ui-effects';
import { ViewerUiInvalidationFlags } from '../src/app/viewer-app-ui';
import type { ViewerUiTransition } from '../src/app/viewer-app-types';
import type { ViewerUi } from '../src/ui/viewer-ui';

describe('viewer app ui effects', () => {
  it('sets EV bounds before exposure values when restoring display controls', () => {
    const calls: string[] = [];
    const ui = {
      setExposureRange: vi.fn(() => calls.push('range')),
      setExposure: vi.fn(() => calls.push('rgb')),
      setColormapExposure: vi.fn(() => calls.push('colormap'))
    } as unknown as ViewerUi;
    applyUiEffects(ui, {
      invalidation: ViewerUiInvalidationFlags.Exposure,
      snapshot: { exposureRange: { minEv: -20, maxEv: 20 }, exposureEv: 15, colormapExposureEv: -15 }
    } as ViewerUiTransition);
    expect(ui.setExposureRange).toHaveBeenCalledWith({ minEv: -20, maxEv: 20 });
    expect(ui.setExposure).toHaveBeenCalledWith(15);
    expect(ui.setColormapExposure).toHaveBeenCalledWith(-15);
    expect(calls).toEqual(['range', 'rgb', 'colormap']);
  });

  it('clears the colormap gradient when the active lut becomes unavailable', () => {
    const ui = {
      setColormapGradient: vi.fn()
    } as unknown as ViewerUi;

    applyUiEffects(ui, {
      invalidation: ViewerUiInvalidationFlags.ColormapGradient,
      snapshot: {
        activeColormapLut: null,
        colormapReversed: false
      }
    } as ViewerUiTransition);

    expect(ui.setColormapGradient).toHaveBeenCalledWith(null, false);
  });
});
