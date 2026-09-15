import { DISPLAY_SOURCE_SLOT_COUNT } from '../../display/bindings';
import type { RenderPassOptions } from './types';

export const COLORMAP_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT;
export const DEPTH_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT + 1;
export const PATH_TRACING_ACCUMULATION_TEXTURE_UNIT = DEPTH_TEXTURE_UNIT;
// Lighting and presentation do not read the twelve raw display source slots.
export const ENVIRONMENT_STOKES_TEXTURE_UNITS = [15, 1, 2, 3] as const;
export const PATH_TRACING_STOKES_TEXTURE_UNITS = [PATH_TRACING_ACCUMULATION_TEXTURE_UNIT, 4, 5, 6] as const;
export const DEPTH_POSITION_X_TEXTURE_UNIT = DEPTH_TEXTURE_UNIT;
export const DEPTH_POSITION_Y_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT + 2;
export const DEPTH_POSITION_Z_TEXTURE_UNIT = DISPLAY_SOURCE_SLOT_COUNT + 3;
export const PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT = DEPTH_POSITION_Y_TEXTURE_UNIT;
export const REQUIRED_TEXTURE_UNITS = DISPLAY_SOURCE_SLOT_COUNT + 4;

export const DEFAULT_RENDER_PASS_OPTIONS: RenderPassOptions = {
  backgroundMode: 'checker',
  backgroundColor: [0, 0, 0],
  alphaOutputMode: 'opaque'
};
