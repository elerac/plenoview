export interface MemoryUsageSnapshot {
  decodedBytes: number;
  gpuTextureBytes: number;
  cpuMaterializedBytes: number;
  analysisCacheBytes: number;
  totalTrackedBytes: number;
  activeReservationBytes: number;
}

export interface MemoryAccountedResidentChannel {
  textureBytes: number;
  materializedBytes: number;
}

export interface MemoryAccountedResidentLayer {
  residentChannels: Map<string, MemoryAccountedResidentChannel>;
}

export interface MemoryAccountedSession {
  decodedBytes: number;
  residentLayers: Map<number, MemoryAccountedResidentLayer>;
}

export function createMemoryUsageSnapshot(
  sessions: Iterable<MemoryAccountedSession>,
  options: {
    analysisCacheBytes?: number;
    activeReservationBytes?: number;
  } = {}
): MemoryUsageSnapshot {
  let decodedBytes = 0;
  let gpuTextureBytes = 0;
  let cpuMaterializedBytes = 0;

  for (const session of sessions) {
    decodedBytes += sanitizeByteCount(session.decodedBytes);
    for (const layer of session.residentLayers.values()) {
      for (const channel of layer.residentChannels.values()) {
        gpuTextureBytes += sanitizeByteCount(channel.textureBytes);
        cpuMaterializedBytes += sanitizeByteCount(channel.materializedBytes);
      }
    }
  }

  const analysisCacheBytes = sanitizeByteCount(options.analysisCacheBytes ?? 0);
  const activeReservationBytes = sanitizeByteCount(options.activeReservationBytes ?? 0);

  return {
    decodedBytes,
    gpuTextureBytes,
    cpuMaterializedBytes,
    analysisCacheBytes,
    totalTrackedBytes: decodedBytes + gpuTextureBytes + cpuMaterializedBytes + analysisCacheBytes,
    activeReservationBytes
  };
}

export function sanitizeByteCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
