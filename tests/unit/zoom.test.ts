import { describe, expect, it } from 'vitest';
import { adjustZoom, clampZoom, toZoomLevel } from '../../src/shared/zoom';

describe('zoom utilities', () => {
  it('clamps zoom boundaries', () => {
    expect(clampZoom(10)).toBe(50);
    expect(clampZoom(500)).toBe(400);
    expect(clampZoom(350)).toBe(350);
    expect(clampZoom(110)).toBe(110);
  });

  it('snaps to nearest 10 and enforces limits', () => {
    expect(toZoomLevel(103)).toBe(100);
    expect(toZoomLevel(106)).toBe(110);
    expect(toZoomLevel(49)).toBe(50);
    expect(toZoomLevel(240)).toBe(240);
    expect(toZoomLevel(450)).toBe(400);
  });

  it('adjusts relative zoom safely', () => {
    expect(adjustZoom(100, 10)).toBe(110);
    expect(adjustZoom(50, -10)).toBe(50);
    expect(adjustZoom(400, 10)).toBe(400);
  });
});
