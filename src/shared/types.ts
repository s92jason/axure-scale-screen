export const ZOOM_LEVELS = [
  50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200
] as const;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export interface ZoomState {
  urlKey: string;
  zoom: ZoomLevel;
  updatedAt: number;
}

export type RuntimeMessage =
  | { type: 'GET_ZOOM'; urlKey: string }
  | { type: 'SET_ZOOM'; urlKey: string; zoom: ZoomLevel }
  | { type: 'RESET_ZOOM'; urlKey: string };

export type RuntimeResponse =
  | { ok: true; state: ZoomState | null }
  | { ok: false; error: string };

export type ContentMessage =
  | { type: 'CONTENT_GET_STATE' }
  | { type: 'CONTENT_SET_ZOOM'; zoom: number }
  | { type: 'CONTENT_RESET_ZOOM' };

export type ContentResponse =
  | {
      ok: true;
      data: {
        isAxure: boolean;
        urlKey: string;
        zoom: ZoomLevel;
      };
    }
  | { ok: false; error: string };

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<RuntimeMessage>;
  if (candidate.type === 'GET_ZOOM' || candidate.type === 'RESET_ZOOM') {
    return typeof candidate.urlKey === 'string' && candidate.urlKey.length > 0;
  }

  if (candidate.type === 'SET_ZOOM') {
    return (
      typeof candidate.urlKey === 'string' &&
      candidate.urlKey.length > 0 &&
      typeof candidate.zoom === 'number'
    );
  }

  return false;
}
