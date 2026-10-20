/**
 * Turns shape descriptions into crisp pixel sprites (no anti-aliasing).
 * Shapes are rasterized at pixel centres, get a 1px outline, and are rim-lit from the top-left:
 * a pixel whose up-left neighbour lies outside its region is "lit", down-right is "shade".
 */

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Anchor in sprite pixels; blit() places the anchor on the target point. */
  ox: number;
  oy: number;
}

export type Edge = 'lit' | 'shade' | null;

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const rgbCache = new Map<string, [number, number, number]>();
export function hexRgb(hex: string): [number, number, number] {
  let v = rgbCache.get(hex);
  if (!v) {
    const h = hex.replace('#', '');
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    rgbCache.set(hex, v);
  }
  return v;
}

export function bakeShape(
  size: number,
  regionAt: (x: number, y: number) => string | null,
  colorOf: (region: string, edge: Edge) => string,
  outline: string | null,
): Sprite {
  const c = size / 2;
  const grid: (string | null)[] = new Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) grid[j * size + i] = regionAt(i + 0.5 - c, j + 0.5 - c);
  }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= size || j >= size ? null : grid[j * size + i]);
  const canvas = createCanvas(size, size);
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = at(i, j);
      let color: string | null = null;
      if (r) {
        const edge: Edge = at(i - 1, j - 1) !== r ? 'lit' : at(i + 1, j + 1) !== r ? 'shade' : null;
        color = colorOf(r, edge);
      } else if (outline && (at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1))) {
        color = outline;
      }
      if (color) {
        const [rr, gg, bb] = hexRgb(color);
        const k = (j * size + i) * 4;
        img.data[k] = rr;
        img.data[k + 1] = gg;
        img.data[k + 2] = bb;
        img.data[k + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return { canvas, ox: c, oy: c };
}

/** Hand-authored sprite from text rows; '.' is transparent, other characters map to colours. */
export function gridSprite(rows: string[], colors: Record<string, string>, ox?: number, oy?: number): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = createCanvas(w, h);
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const col = colors[rows[y][x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return { canvas, ox: ox ?? Math.floor(w / 2), oy: oy ?? Math.floor(h / 2) };
}

/** Draws a sprite with its anchor snapped to the low-res pixel grid. */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number): void {
  ctx.drawImage(s.canvas, Math.round(x - s.ox), Math.round(y - s.oy));
}

/** 4x4 ordered-dither threshold in [0, 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer(x: number, y: number): number {
  return BAYER[(y & 3) * 4 + (x & 3)] / 16;
}
