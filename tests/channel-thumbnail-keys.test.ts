import { describe, expect, it } from 'vitest';
import {
  serializeChannelThumbnailContextKey,
  serializeChannelThumbnailRequestKey
} from '../src/channel-thumbnail-keys';
import { createDefaultStokesDegreeModulation } from '../src/stokes';
import { createChannelRgbSelection, createStokesSelection } from './helpers/state-fixtures';

describe('channel thumbnail keys', () => {
  it('includes normal-map color mapping in thumbnail selection keys', () => {
    const selection = createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', null, 'normalMap');

    expect(serializeChannelThumbnailContextKey('session-1', 0, selection)).toBe(
      'session:session-1|layer:0|selection:channelRgb:normal.X:normal.Y:normal.Z::normalMap'
    );
    expect(serializeChannelThumbnailRequestKey({
      sessionId: 'session-1',
      activeLayer: 0,
      selection,
      exposureEv: 4,
      displayGamma: 4,
      stokesDegreeModulation: createDefaultStokesDegreeModulation(),
      stokesAolpDegreeModulationMode: 'value'
    })).toContain('selection:channelRgb:normal.X:normal.Y:normal.Z::normalMap|exposure:4|gamma:4');
  });

  it('invalidates AoLP thumbnails when DoLP gamma changes', () => {
    const args = {
      sessionId: 'session-1',
      activeLayer: 0,
      selection: createStokesSelection('aolp'),
      exposureEv: 0,
      displayGamma: 1,
      stokesDegreeModulation: createDefaultStokesDegreeModulation(),
      stokesAolpDegreeModulationMode: 'value' as const
    };
    expect(serializeChannelThumbnailRequestKey({ ...args, stokesAolpDegreeModulationGamma: 2 }))
      .not.toBe(serializeChannelThumbnailRequestKey({ ...args, stokesAolpDegreeModulationGamma: 1 }));
  });

});
