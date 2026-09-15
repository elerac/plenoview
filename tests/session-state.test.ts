import { describe, expect, it } from 'vitest';
import {
  buildSessionDisplayName,
  cloneViewerSessionState,
  persistActiveSessionState,
  pickNextSessionIndexAfterRemoval
} from '../src/session-state';
import { ViewerSessionState } from '../src/types';
import { createChannelRgbSelection, createViewerSessionState } from './helpers/state-fixtures';

describe('session state', () => {
  it('builds disambiguated session labels for duplicate filenames', () => {
    const first = buildSessionDisplayName('sample.exr', []);
    const second = buildSessionDisplayName('sample.exr', ['sample.exr']);
    const third = buildSessionDisplayName('sample.exr', ['sample.exr', 'other.exr', 'sample.exr']);

    expect(first).toBe('sample.exr');
    expect(second).toBe('sample.exr (2)');
    expect(third).toBe('sample.exr (3)');
  });

  it('selects nearest next index after closing active session', () => {
    expect(pickNextSessionIndexAfterRemoval(1, 2)).toBe(1);
    expect(pickNextSessionIndexAfterRemoval(2, 2)).toBe(1);
    expect(pickNextSessionIndexAfterRemoval(0, 1)).toBe(0);
    expect(pickNextSessionIndexAfterRemoval(0, 0)).toBe(-1);
  });

  it('persists active session state without mutating others', () => {
    const baseState: ViewerSessionState = createViewerSessionState({
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    });

    const sessions = [
      { id: 'a', state: { ...baseState, exposureEv: -1 } },
      { id: 'b', state: { ...baseState, exposureEv: 2 } }
    ];

    persistActiveSessionState(sessions, 'a', { ...baseState, exposureEv: 3, zoom: 5, pathTracingMaxSamples: 262_144 });

    expect(sessions[0].state.exposureEv).toBe(3);
    expect(sessions[0].state.zoom).toBe(5);
    expect(sessions[0].state.pathTracingMaxSamples).toBe(262_144);
    expect(sessions[1].state.exposureEv).toBe(2);
    expect(sessions[1].state.pathTracingMaxSamples).toBe(65_536);
  });

  it('normalizes legacy and invalid sample ceilings when cloning sessions', () => {
    expect(cloneViewerSessionState(createViewerSessionState({ pathTracingMaxSamples: undefined })).pathTracingMaxSamples).toBe(65_536);
    expect(cloneViewerSessionState(createViewerSessionState({ pathTracingMaxSamples: 99.8 })).pathTracingMaxSamples).toBe(99);
    expect(cloneViewerSessionState(createViewerSessionState({ pathTracingMaxSamples: 2_000_000 })).pathTracingMaxSamples).toBe(1_048_576);
  });

  it('drops transient hover data when cloning session state', () => {
    const cloned = cloneViewerSessionState({
      ...createViewerSessionState(),
      lockedPixel: { ix: 1, iy: 2 }
    } as ViewerSessionState & { hoveredPixel: { ix: number; iy: number } });

    expect(cloned).toEqual({
      ...createViewerSessionState(),
      lockedPixel: { ix: 1, iy: 2 }
    });
    expect('hoveredPixel' in cloned).toBe(false);
  });

  it('deep-clones environment sphere material state', () => {
    const state = createViewerSessionState({
      environmentSphereMaterial: {
        ...createViewerSessionState().environmentSphereMaterial,
        diffuseReflectance: { r: 0.2, g: 0.3, b: 0.4 }
      }
    });
    const cloned = cloneViewerSessionState(state);

    expect(cloned.environmentSphereMaterial).toEqual(state.environmentSphereMaterial);
    expect(cloned.environmentSphereMaterial).not.toBe(state.environmentSphereMaterial);
    expect(cloned.environmentSphereMaterial.diffuseReflectance).not.toBe(
      state.environmentSphereMaterial.diffuseReflectance
    );
  });

  it('preserves free rotation when cloning position depth session state', () => {
    const cloned = cloneViewerSessionState(createViewerSessionState({
      depthChannel: '__position:P',
      depthYawDeg: 120,
      depthPitchDeg: -120
    }));

    expect(cloned.depthYawDeg).toBe(120);
    expect(cloned.depthPitchDeg).toBe(-120);
  });
});
