import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from './constants';
import type { ZoomLevel } from './types';

export function clampZoom(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_ZOOM;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function toZoomLevel(value: number): ZoomLevel {
  const bounded = clampZoom(value);
  const snapped = Math.round(bounded / ZOOM_STEP) * ZOOM_STEP;
  return clampZoom(snapped) as ZoomLevel;
}

export function adjustZoom(current: ZoomLevel, delta: number): ZoomLevel {
  return toZoomLevel(current + delta);
}
