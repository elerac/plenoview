import { isMuellerMatrixSelection, type DisplaySelection } from './display-model';
import { resolveMuellerMatrixDisplaySize } from './mueller';

export interface DisplayImageSize {
  width: number;
  height: number;
}

export function resolveDisplayImageSize(
  sourceWidth: number,
  sourceHeight: number,
  selection: DisplaySelection | null
): DisplayImageSize {
  return isMuellerMatrixSelection(selection)
    ? resolveMuellerMatrixDisplaySize(sourceWidth, sourceHeight)
    : {
        width: Math.max(0, Math.floor(sourceWidth)),
        height: Math.max(0, Math.floor(sourceHeight))
      };
}
