import type { EnvironmentSphereMaterial } from '../../environment-sphere-material';
import {
  computeRoughPlasticTransmittanceSteps,
  ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION,
  type RoughPlasticTransmittance
} from '../../roughplastic-transmittance';

export const ROUGH_PLASTIC_TRANSMITTANCE_TEXTURE_UNIT = 7;
export const ROUGH_PLASTIC_TRANSMITTANCE_TEXTURE_ROWS = 8;
const FIXED_ROUGHNESSES = [0.7, 0.02, 0.05, 0.1, 0.2, 0.4, 0.7] as const;
const PREPARATION_BUDGET_MS = 6;
type PendingTable = ReturnType<typeof computeRoughPlasticTransmittanceSteps>;

/** Small material LUT; R = external T(mu), G = hemispherical internal R. */
export class RoughPlasticTransmittanceCache {
  private readonly tables = new Map<string, RoughPlasticTransmittance>();
  private readonly pendingTables = new Map<string, PendingTable>();
  private texture: WebGLTexture | null = null;
  private key = '';
  private disposed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Advances only a small CPU slice; leaving panorama naturally pauses work. */
  prepare(material: Readonly<EnvironmentSphereMaterial>): boolean {
    if (this.disposed) throw new Error('The rough plastic transmittance cache has been disposed.');
    const deadline = performance.now() + PREPARATION_BUDGET_MS;
    const eta = material.intIor / material.extIor;
    for (const alpha of [material.alpha, ...FIXED_ROUGHNESSES]) {
      const key = `${material.distribution}:${eta}:${alpha}`;
      const cached = this.tables.get(key);
      if (cached) {
        this.tables.delete(key);
        this.tables.set(key, cached);
        continue;
      }
      let steps = this.pendingTables.get(key);
      if (!steps) {
        steps = computeRoughPlasticTransmittanceSteps({ alpha, eta, distribution: material.distribution });
        this.pendingTables.set(key, steps);
        if (this.pendingTables.size > 32) this.pendingTables.delete(this.pendingTables.keys().next().value!);
      }
      for (;;) {
        const step = steps.next();
        if (step.done) {
          this.tables.set(key, step.value);
          this.pendingTables.delete(key);
          if (this.tables.size > 32) this.tables.delete(this.tables.keys().next().value!);
          break;
        }
        if (performance.now() >= deadline) return false;
      }
    }
    return true;
  }

  getOrCreate(material: Readonly<EnvironmentSphereMaterial>): WebGLTexture {
    if (this.disposed) throw new Error('The rough plastic transmittance cache has been disposed.');
    const eta = material.intIor / material.extIor;
    const key = `${material.distribution}:${eta}:${material.alpha}`;
    if (this.texture && this.key === key) return this.texture;
    const pixels = new Float32Array(ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION * ROUGH_PLASTIC_TRANSMITTANCE_TEXTURE_ROWS * 4);
    for (const [row, alpha] of [material.alpha, ...FIXED_ROUGHNESSES].entries()) {
      const tableKey = `${material.distribution}:${eta}:${alpha}`;
      const table = this.tables.get(tableKey);
      if (!table) {
        throw new Error('Panorama material lighting is still preparing.');
      }
      for (let column = 0; column < ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION; column += 1) {
        const offset = (row * ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION + column) * 4;
        pixels[offset] = table.externalTransmittance[column];
        pixels[offset + 1] = table.internalReflectance;
      }
    }
    const gl = this.gl;
    const previousActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0 + ROUGH_PLASTIC_TRANSMITTANCE_TEXTURE_UNIT);
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    try {
      if (!this.texture) this.texture = gl.createTexture();
      if (!this.texture) throw new Error('Unable to create the rough plastic transmittance texture.');
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION,
        ROUGH_PLASTIC_TRANSMITTANCE_TEXTURE_ROWS, 0, gl.RGBA, gl.FLOAT, pixels);
      this.key = key;
      return this.texture;
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.activeTexture(previousActive);
    }
  }

  clear(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.texture = null;
    this.key = '';
    this.tables.clear();
    this.pendingTables.clear();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }
}
