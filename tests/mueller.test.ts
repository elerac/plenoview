import { describe, expect, it } from 'vitest';
import {
  buildMuellerMatrixSelection,
  buildRgbMuellerMatrixSelection,
  detectMuellerMatrixChannels,
  detectMuellerMatrixChannelSets,
  detectRgbMuellerMatrixChannels,
  getMuellerMatrixDisplayOptions,
  isMuellerMatrixDisplayAvailable,
  MUELLER_MATRIX_ELEMENTS,
  resolveMuellerMatrixDisplayPixel,
  resolveMuellerMatrixDisplaySize
} from '../src/mueller';

describe('mueller', () => {
  it('detects complete bare and suffixed Mueller matrix channel sets', () => {
    const bare = [...MUELLER_MATRIX_ELEMENTS];
    const suffixed = MUELLER_MATRIX_ELEMENTS.map((element) => `${element}.Y`);
    const channelNames = [
      'M00.mask', 'M01.mask',
      ...suffixed,
      ...bare
    ];

    expect(detectMuellerMatrixChannels(channelNames)).toEqual({
      elements: Object.fromEntries(MUELLER_MATRIX_ELEMENTS.map((element) => [element, element]))
    });
    expect(detectMuellerMatrixChannels(channelNames, 'Y')).toEqual({
      suffix: 'Y',
      elements: Object.fromEntries(MUELLER_MATRIX_ELEMENTS.map((element) => [element, `${element}.Y`]))
    });
    expect(detectMuellerMatrixChannelSets(channelNames).map((channels) => channels.suffix ?? '')).toEqual([
      '',
      'Y'
    ]);
    expect(detectMuellerMatrixChannels(channelNames, 'mask')).toBeNull();
  });

  it('detects RGB-suffixed matrix elements as grouped and split Mueller displays', () => {
    const rgbSuffixed = MUELLER_MATRIX_ELEMENTS.flatMap((element) => [
      `${element}.R`,
      `${element}.G`,
      `${element}.B`
    ]);

    expect(detectRgbMuellerMatrixChannels(rgbSuffixed)).toEqual({
      r: {
        suffix: 'R',
        elements: Object.fromEntries(MUELLER_MATRIX_ELEMENTS.map((element) => [element, `${element}.R`]))
      },
      g: {
        suffix: 'G',
        elements: Object.fromEntries(MUELLER_MATRIX_ELEMENTS.map((element) => [element, `${element}.G`]))
      },
      b: {
        suffix: 'B',
        elements: Object.fromEntries(MUELLER_MATRIX_ELEMENTS.map((element) => [element, `${element}.B`]))
      }
    });
    expect(detectMuellerMatrixChannelSets(rgbSuffixed)).toEqual([]);
    expect(getMuellerMatrixDisplayOptions(rgbSuffixed).map((option) => option.key)).toEqual([
      'muellerMatrixRgb:'
    ]);
    expect(getMuellerMatrixDisplayOptions(rgbSuffixed, {
      includeRgbGroups: false,
      includeSplitChannels: true
    }).map((option) => option.key)).toEqual([
      'muellerMatrix:R',
      'muellerMatrix:G',
      'muellerMatrix:B'
    ]);
    expect(isMuellerMatrixDisplayAvailable(rgbSuffixed, buildRgbMuellerMatrixSelection())).toBe(true);
  });

  it('builds display options and availability for complete sets only', () => {
    const channelNames = MUELLER_MATRIX_ELEMENTS.map((element) => `${element}.Y`);
    const options = getMuellerMatrixDisplayOptions(channelNames);

    expect(options).toHaveLength(1);
    expect(options[0]?.key).toBe('muellerMatrix:Y');
    expect(options[0]?.label).toBe('Mueller Matrix.Y');
    expect(options[0]?.channelCount).toBe(16);
    expect(options[0]?.selection).toEqual(buildMuellerMatrixSelection('Y'));
    expect(isMuellerMatrixDisplayAvailable(channelNames, buildMuellerMatrixSelection('Y'))).toBe(true);
    expect(isMuellerMatrixDisplayAvailable(channelNames.slice(0, -1), buildMuellerMatrixSelection('Y'))).toBe(false);
  });

  it('maps display pixels into a 4x4 row-major source grid', () => {
    expect(resolveMuellerMatrixDisplaySize(2, 3)).toEqual({ width: 8, height: 12 });
    expect(resolveMuellerMatrixDisplayPixel({ ix: 0, iy: 0 }, 2, 3)).toMatchObject({
      sourcePixel: { ix: 0, iy: 0 },
      element: 'M00',
      sourceIndex: 0
    });
    expect(resolveMuellerMatrixDisplayPixel({ ix: 3, iy: 4 }, 2, 3)).toMatchObject({
      sourcePixel: { ix: 1, iy: 1 },
      element: 'M11',
      sourceIndex: 3
    });
    expect(resolveMuellerMatrixDisplayPixel({ ix: 7, iy: 11 }, 2, 3)).toMatchObject({
      sourcePixel: { ix: 1, iy: 2 },
      element: 'M33',
      sourceIndex: 5
    });
  });
});
