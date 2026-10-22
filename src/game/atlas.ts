import { buildLayout, MAPS, mapArea, type MapLayout } from './maps';
import type { MapId } from './maps/types';
import { MINIMAP_HAZARDS, MINIMAP_STYLE } from './minimap';
import { hexRgb } from './pixel/bake';
import { clearanceAt } from './terrain';

/** Width of an atlas picture in canvas pixels; the height follows the map's shape. */
const WIDTH = 176;

/** A map not yet reached shows only its outline, in near-black. */
const SILHOUETTE = { floor: '#120b1f', stone: '#2a2140', edge: '#3a3058' };

/** Layouts are built once per map (with a fixed seed), the first time the atlas is shown. */
const layouts = new Map<MapId, MapLayout>();
function layoutOf(id: MapId): MapLayout {
  let map = layouts.get(id);
  if (!map) {
    map = buildLayout(MAPS[id], 1);
    layouts.set(id, map);
  }
  return map;
}

/**
 * Paints a map's picture for the setup screen's atlas onto `canvas`: its layout coloured as the
 * minimap shows it, with hazards and landmarks; or, for a map the player hasn't reached, just its
 * silhouette.
 */
export function drawAtlasPicture(canvas: HTMLCanvasElement, id: MapId, known: boolean): void {
  const map = layoutOf(id);
  const per = map.width / WIDTH;
  const w = WIDTH;
  const h = Math.round(map.height / per);
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return;
  const style = known ? (MINIMAP_STYLE[mapArea(id)] ?? MINIMAP_STYLE[0]) : SILHOUETTE;
  const [floor, stone, edge] = [style.floor, style.stone, style.edge].map(hexRgb);
  const zones = known ? (['lava', 'bramble', 'ice'] as const).flatMap((k) => (map.zones[k] ? [{ index: map.zones[k]!, rgb: hexRgb(MINIMAP_HAZARDS[k]) }] : [])) : [];
  const img = g.createImageData(w, h);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const x = (u + 0.5) * per;
      const y = (v + 0.5) * per;
      const d = clearanceAt(map.index, x, y);
      const wet = zones.find((z) => clearanceAt(z.index, x, y) < 0);
      const [r, gg, b] = wet ? wet.rgb : d >= 0 ? floor : d > -per ? edge : stone;
      const i = (v * w + u) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (!known) return;
  // Landmarks as small bright marks, the start ringed.
  g.fillStyle = MINIMAP_STYLE[mapArea(id)]?.landmark ?? '#ffffff';
  for (const l of map.landmarks) g.fillRect(Math.round(l.x / per) - 1, Math.round(l.y / per) - 1, 3, 3);
  g.strokeStyle = g.fillStyle;
  g.lineWidth = 1;
  g.strokeRect(Math.round(map.start.x / per) - 3.5, Math.round(map.start.y / per) - 3.5, 7, 7);
}
