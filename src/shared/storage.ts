import { DEFAULT_ZOOM, STORAGE_PREFIX } from './constants';
import type { ZoomLevel, ZoomState } from './types';
import { toZoomLevel } from './zoom';

function toStorageKey(urlKey: string): string {
  return `${STORAGE_PREFIX}${urlKey}`;
}

function getStorageValue<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(result[key] as T | undefined);
    });
  });
}

function setStorageValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function removeStorageValue(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

export async function getZoomState(urlKey: string): Promise<ZoomState | null> {
  const key = toStorageKey(urlKey);
  const stored = await getStorageValue<Partial<ZoomState>>(key);

  if (!stored || typeof stored.zoom !== 'number') {
    return null;
  }

  return {
    urlKey,
    zoom: toZoomLevel(stored.zoom),
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : Date.now()
  };
}

export async function setZoomState(urlKey: string, zoom: ZoomLevel): Promise<ZoomState> {
  const state: ZoomState = {
    urlKey,
    zoom: toZoomLevel(zoom),
    updatedAt: Date.now()
  };

  await setStorageValue(toStorageKey(urlKey), state);
  return state;
}

export async function resetZoomState(urlKey: string): Promise<ZoomState> {
  await removeStorageValue(toStorageKey(urlKey));

  return {
    urlKey,
    zoom: DEFAULT_ZOOM as ZoomLevel,
    updatedAt: Date.now()
  };
}
