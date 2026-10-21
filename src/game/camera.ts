import { CAMERA } from './config';
import type { Rect } from './maps/types';

/**
 * The view onto a map: centred a little ahead of the serpent's head, easing after it and
 * stopping at the map's edges. Gameplay uses it too: foes spawn just outside it and only start
 * attacks inside it.
 */
export interface Camera {
  /** Centre of the view, in world units. */
  x: number;
  y: number;
  /** Size of the view in world units (set by the renderer from the window). */
  viewW: number;
  viewH: number;
}

export function createCamera(x: number, y: number): Camera {
  return { x, y, viewW: CAMERA.maxViewWidth, viewH: CAMERA.viewHeight };
}

/** Keeps the view inside the map (or centred on a map smaller than the view). */
export function clampCamera(cam: Camera, width: number, height: number): void {
  cam.x = cam.viewW >= width ? width / 2 : Math.max(cam.viewW / 2, Math.min(width - cam.viewW / 2, cam.x));
  cam.y = cam.viewH >= height ? height / 2 : Math.max(cam.viewH / 2, Math.min(height - cam.viewH / 2, cam.y));
}

/**
 * Follows the head. With `steady` (the Steady camera option) the view stays centred on the head
 * with no lookahead or easing. Big jumps (a teleport, a new map) snap instead of easing.
 */
export function updateCamera(
  cam: Camera,
  head: { x: number; y: number; heading: number },
  width: number,
  height: number,
  dt: number,
  steady: boolean,
): void {
  const ahead = steady ? 0 : CAMERA.lookahead;
  const tx = head.x + Math.cos(head.heading) * ahead;
  const ty = head.y + Math.sin(head.heading) * ahead;
  if (steady || Math.hypot(tx - cam.x, ty - cam.y) > CAMERA.snapDistance) {
    cam.x = tx;
    cam.y = ty;
  } else {
    const k = 1 - Math.exp(-dt / CAMERA.ease);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }
  clampCamera(cam, width, height);
}

/** The visible area in world units, grown by `margin` on every side. */
export function viewRect(cam: Camera, margin = 0): Rect {
  return {
    x0: cam.x - cam.viewW / 2 - margin,
    y0: cam.y - cam.viewH / 2 - margin,
    x1: cam.x + cam.viewW / 2 + margin,
    y1: cam.y + cam.viewH / 2 + margin,
  };
}

export function inView(cam: Camera, x: number, y: number, margin = 0): boolean {
  return Math.abs(x - cam.x) <= cam.viewW / 2 + margin && Math.abs(y - cam.y) <= cam.viewH / 2 + margin;
}
