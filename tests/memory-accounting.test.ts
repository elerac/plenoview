import { describe, expect, it } from 'vitest';
import { createMemoryUsageSnapshot } from '../src/memory/memory-accounting';

describe('memory accounting', () => {
  it('reports decoded, GPU texture, CPU materialized, analysis, reservation, and total bytes', () => {
    const snapshot = createMemoryUsageSnapshot([
      {
        decodedBytes: 10.9,
        residentLayers: new Map([
          [0, {
            residentChannels: new Map([
              ['R', { textureBytes: 24.8, materializedBytes: 12.2 }],
              ['G', { textureBytes: Number.NaN, materializedBytes: -10 }]
            ])
          }],
          [1, {
            residentChannels: new Map([
              ['Z', { textureBytes: 4, materializedBytes: 2 }]
            ])
          }]
        ])
      },
      {
        decodedBytes: 5,
        residentLayers: new Map()
      }
    ], {
      analysisCacheBytes: 0,
      activeReservationBytes: 0
    });

    expect(snapshot).toEqual({
      decodedBytes: 15,
      gpuTextureBytes: 28,
      cpuMaterializedBytes: 14,
      analysisCacheBytes: 0,
      totalTrackedBytes: 57,
      activeReservationBytes: 0
    });
  });
});
