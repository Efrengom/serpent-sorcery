import { useEffect, useMemo, useRef } from 'react';
import type { SpellId } from '../game/config';
import { buildLayout } from '../game/maps';
import { RUINS } from '../game/maps/ruins';
import { pixelFloorPicture } from '../game/pixel/floor';
import { PX } from '../game/pixel/palette';
import { segmentFill, segmentOutline, wizardHead } from '../game/pixel/sprites';
import { blit } from '../game/pixel/bake';
import { RELICS, type RelicId } from '../game/relics';
import type { WizardId } from '../game/wizards';

// ---------------------------------------------------------------- bitmap icons

type Bitmap = { rows: string[]; colors: Record<string, string> };

const ICONS = {
  shard: {
    rows: ['...k...', '..kwk..', '.kwyyk.', 'kwyyydk', 'kyyyddk', '.kyydk.', '..kdk..', '...k...'],
    colors: { k: PX.ink, w: PX.gold2, y: PX.gold1, d: PX.gold0 },
  },
  heart: {
    rows: ['.kk...kk.', 'kwrk.krrk', 'kwrrkrrdk', 'krrrrrrdk', '.krrrrdk.', '..krrdk..', '...kdk...', '....k....'],
    colors: { k: PX.ink, w: PX.hurt2, r: PX.hurt1, d: PX.hurt0 },
  },
  star: {
    rows: ['....k....', '...kwk...', '...kyk...', '.kkkykkk.', 'kwyyyyydk', '.kkkykkk.', '...kdk...', '...kdk...', '....k....'],
    colors: { k: PX.ink, w: PX.gold2, y: PX.gold1, d: PX.gold0 },
  },
  fork: {
    rows: ['w...w...w', 'c...c...c', '.c..c..c.', '..c.c.c..', '...ccc...', '....c....', '....c....', '...ccc...'],
    colors: { c: PX.cyan2, w: PX.cyan3 },
  },
  pierce: {
    rows: ['....m..c.', '....m..cc', 'ccccmcccw', '....m..cc', '....m..c.'],
    colors: { m: PX.golem3, c: PX.cyan2, w: PX.cyan3 },
  },
  lightning: {
    rows: ['...wgg.', '..ggg..', '.ggg...', 'gggggg.', '...ggg.', '..ggg..', '.gg....', 'g......'],
    colors: { g: PX.green2, w: PX.green3 },
  },
  ring: {
    rows: ['...yyy...', '.yy...yy.', '.y.....y.', 'y...w...y', 'y..www..y', 'y...w...y', '.y.....y.', '.yy...yy.', '...yyy...'],
    colors: { y: PX.gold1, w: PX.gold3 },
  },
  hourglass: {
    rows: ['mmmmmmm', '.myyym.', '..myk..', '...m...', '..m.m..', '.myyym.', 'mmmmmmm'],
    colors: { m: PX.golem3, y: PX.gold1, k: PX.gold0 },
  },
  plus: {
    rows: ['..kkk..', '..kgk..', 'kkkgkkk', 'kgggggk', 'kkkgkkk', '..kgk..', '..kkk..'],
    colors: { k: PX.ink, g: PX.green2 },
  },
  crystal: {
    rows: ['...k...', '..kwk..', '.kwppk.', 'kwpppdk', 'kpppddk', '.kppdk.', '..kdk..', '...k...'],
    colors: { k: PX.ink, w: PX.xp2, p: PX.xp1, d: PX.xp0 },
  },
  potion: {
    rows: ['..kkk..', '..kwk..', '..kwk..', '.kpppk.', 'kpwpppk', 'kpppppk', 'kppppdk', '.kkkkk.'],
    colors: { k: PX.ink, w: PX.white, p: PX.portal2, d: PX.portal1 },
  },
  eye: {
    rows: ['..kkkkk..', '.kwwvwwk.', 'kwwvkvwwk', '.kwwvwwk.', '..kkkkk..'],
    colors: { k: PX.ink, w: PX.eye, v: PX.purple2 },
  },
  soundOn: {
    rows: ['...w.....', '..ww..w..', 'www.w..w.', 'w...w.w.w', 'w...w.w.w', 'www.w..w.', '..ww..w..', '...w.....'],
    colors: { w: PX.eye },
  },
  soundOff: {
    rows: ['...w.....', '..ww.....', 'www.w.r.r', 'w...w..r.', 'w...w..r.', 'www.w.r.r', '..ww.....', '...w.....'],
    colors: { w: PX.eye, r: PX.hurt1 },
  },
  pause: {
    rows: ['ww.ww', 'ww.ww', 'ww.ww', 'ww.ww', 'ww.ww', 'ww.ww'],
    colors: { w: PX.eye },
  },
  // Fullscreen: four corners opening out; and back to a window: the corners folding in.
  fullscreen: {
    rows: ['www...www', 'w.......w', 'w.......w', '.........', '.........', '.........', 'w.......w', 'w.......w', 'www...www'],
    colors: { w: PX.eye },
  },
  windowed: {
    rows: ['..w...w..', '..w...w..', 'www...www', '.........', '.........', '.........', 'www...www', '..w...w..', '..w...w..'],
    colors: { w: PX.eye },
  },
  triangle: {
    rows: ['....w....', '...wcw...', '...c.c...', '..c...c..', '..c...c..', '.c.....c.', '.c.....c.', 'ccccccccc'],
    colors: { c: PX.ward1, w: PX.ward2 },
  },
  snowflake: {
    rows: ['....w....', '.w..i..w.', '..w.i.w..', '...iii...', 'wiiiwiiiw', '...iii...', '..w.i.w..', '.w..i..w.', '....w....'],
    colors: { i: PX.ice2, w: PX.ice3 },
  },
  coil: {
    rows: ['..ttttt..', '.t.....t.', 't..kkk..t', 't.k...k.t', 't.k.r.k.t', 't..kkk..t', '.t.....t.', '..ttt.tt.', '......t..'],
    colors: { t: PX.teal2, k: PX.teal1, r: PX.hurt1 },
  },
  skull: {
    rows: ['.kkkkk.', 'kwwwwwk', 'kwkwkwk', 'kwwwwwk', '.kwwwk.', '.kwkwk.', '..kkk..'],
    colors: { k: PX.ink, w: PX.hurt2 },
  },
  // The Grimoire: a reroll's circling arrow, a banish's cross, four cards, a waystone and a primed burst.
  // Three quarters of a ring turning clockwise, its arrowhead pointing down at the upper right.
  reroll: {
    rows: [
      '....kkkkk.....',
      '...kwwwwwk....',
      '..kwyyyyywk...',
      '.kwyykkkwykkk.',
      'kwyyk.kwyywwwk',
      'kwyk...kwyyyk.',
      'kwyk....kwyk..',
      'kwyk.....kk...',
      'kwywk.........',
      '.kwywkkk......',
      '..kwywwwk.....',
      '...kwyyyk.....',
      '....kkkk......',
    ],
    colors: { k: PX.ink, y: PX.gold1, w: PX.gold3 },
  },
  banish: {
    rows: ['kk.....kk', 'krk...krk', '.krk.krk.', '..krkrk..', '...krk...', '..krkrk..', '.krk.krk.', 'krk...krk', 'kk.....kk'],
    colors: { k: PX.ink, r: PX.hurt1 },
  },
  cards: {
    rows: ['kkkk.kkkk', 'kwpk.kwpk', 'kppk.kppk', 'kkkk.kkkk', '.........', 'kkkk.kkkk', 'kwpk.kwpk', 'kppk.kppk', 'kkkk.kkkk'],
    colors: { k: PX.ink, w: PX.gold3, p: PX.gold1 },
  },
  waystone: {
    rows: ['...kkk...', '..kpppk..', '.kpwwwpk.', '.kpw.wpk.', '.kpw.wpk.', '.kpw.wpk.', 'kkpwwwpkk', 'kmmmmmmmk', 'kkkkkkkkk'],
    colors: { k: PX.ink, p: PX.portal2, w: PX.portal1, m: PX.golem3 },
  },
  burst: {
    rows: ['....y....', '.y..y..y.', '..y.w.y..', '...www...', 'yywwwwwyy', '...www...', '..y.w.y..', '.y..y..y.', '....y....'],
    colors: { y: PX.gold1, w: PX.gold3 },
  },
} satisfies Record<string, Bitmap>;

export type IconName = keyof typeof ICONS;

/** Crisp pixel icon rendered as SVG squares; `scale` is CSS pixels per icon pixel. */
export function PixelIcon({ name, scale = 3, className }: { name: IconName; scale?: number; className?: string }) {
  return <BitmapIcon icon={ICONS[name]} scale={scale} className={className} />;
}

function BitmapIcon({ icon, scale, className }: { icon: Bitmap; scale: number; className?: string }) {
  const w = Math.max(...icon.rows.map((r) => r.length));
  const h = icon.rows.length;
  const rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < icon.rows[y].length; x++) {
      const fill = icon.colors[icon.rows[y][x]];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    }
  }
  return (
    <svg className={`pixel-icon ${className ?? ''}`} width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

const UPGRADE_ICON: Record<string, IconName> = {
  // A shrine's pacts and a merchant's wares
  'site:blood': 'heart',
  'site:haste': 'hourglass',
  'site:plenty': 'crystal',
  'site:glass': 'pierce',
  'site:stone': 'plus',
  'site:draught': 'potion',
  'site:tome': 'eye',
  'site:quickening': 'hourglass',
  'site:empower': 'star',
  'site:swiftscale': 'fork',
  potency: 'star',
  multibolt: 'fork',
  pierce: 'pierce',
  chains: 'lightning',
  novaRadius: 'ring',
  haste: 'hourglass',
  vitality: 'heart',
  magnet: 'crystal',
  regen: 'plus',
  wardRunes: 'triangle',
  deepFrost: 'snowflake',
  restore: 'potion',
  'over-power': 'star',
  'over-vigor': 'heart',
  'over-focus': 'hourglass',
  // the Grimoire
  reroll1: 'reroll',
  reroll2: 'reroll',
  banish1: 'banish',
  banish2: 'banish',
  fourthCard: 'cards',
  'way:hollows': 'waystone',
  'way:catacombs': 'waystone',
  'way:ember': 'waystone',
  ultReady: 'burst',
  // permanent upgrades
  health: 'heart',
  damage: 'star',
  pickup: 'crystal',
  wisdom: 'eye',
};

/** Upgrade/meta glyph: its pixel icon, or the plain symbol for one without an icon. */
export function UpgradeGlyph({ id, glyph }: { id: string; glyph: string }) {
  if (UPGRADE_ICON[id]) return <PixelIcon name={UPGRADE_ICON[id]} scale={4} className="card-glyph-px" />;
  return <span className="card-glyph">{glyph}</span>;
}

/** Mixes a hex colour toward white (t > 0) or black (t < 0). */
function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = t > 0 ? 255 : 0;
  const mix = (c: number) => Math.round(c + (to - c) * Math.abs(t));
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

const RELIC_GRID = 16;
const relicBitmaps = new Map<RelicId, Bitmap>();

/**
 * Relics whose shape is too fine to snap to the grid on its own, drawn by hand (16×16 like the rest).
 * The Gambler's Die: a bone-white die showing three, lit on its upper-left and shaded lower-right.
 * The Frenzied Heart: a red heart with a bright bolt zig-zagging across it.
 */
const RELIC_PIXELS: Partial<Record<RelicId, Bitmap>> = {
  gamblersDie: {
    rows: [
      '................',
      '................',
      '...kkkkkkkkkk...',
      '..kwwwwwwwwwck..',
      '..kwppcccccccdk.',
      '..kwppcccccccdk.',
      '..kwcccccccccdk.',
      '..kwcccppccccdk.',
      '..kwcccppccccdk.',
      '..kwcccccccccdk.',
      '..kwccccccppcdk.',
      '..kwccccccppcdk.',
      '..kcddddddddddk.',
      '...kkkkkkkkkkk..',
      '................',
      '................',
    ],
    colors: { k: PX.ink, w: '#ffffff', c: RELICS.gamblersDie.color, d: '#a89c86', p: PX.hurt0 },
  },
  frenziedHeart: {
    rows: [
      '................',
      '................',
      '..kkkk...kkkk...',
      '.kwwwwk.kwwwwk..',
      'kwccccwkwccccwk.',
      'kwcccccwcbbccdk.',
      'kwccccccbbcccdk.',
      'kwccccbbbbbccdk.',
      '.kwccccbbcccdk..',
      '..kwccbbcccdk...',
      '...kwbbcccdk....',
      '....kwcccdk.....',
      '.....kwcdk......',
      '......kwk.......',
      '.......k........',
      '................',
    ],
    colors: { k: PX.ink, w: '#ff9a80', c: RELICS.frenziedHeart.color, d: '#a8281a', b: PX.gold3 },
  },
};

/**
 * A relic's vector shape snapped to a 16×16 grid: solid colour inside, lit on its upper-left
 * edges and shaded on its lower-right, with an ink outline round it.
 */
function relicBitmap(id: RelicId): Bitmap {
  const cached = RELIC_PIXELS[id] ?? relicBitmaps.get(id);
  if (cached) return cached;
  const G = RELIC_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = G;
  const ctx = canvas.getContext('2d')!;
  // One pixel of padding all round leaves room for the outline.
  ctx.translate(1, 1);
  ctx.scale((G - 2) / 24, (G - 2) / 24);
  ctx.fill(new Path2D(RELICS[id].icon), 'evenodd');
  const data = ctx.getImageData(0, 0, G, G).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < G && y < G && data[(y * G + x) * 4 + 3] >= 110;
  const rows: string[] = [];
  for (let y = 0; y < G; y++) {
    let row = '';
    for (let x = 0; x < G; x++) {
      if (on(x, y)) row += !on(x - 1, y) || !on(x, y - 1) ? 'w' : !on(x + 1, y) || !on(x, y + 1) ? 'd' : 'c';
      else row += on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1) ? 'k' : '.';
    }
    rows.push(row);
  }
  const color = RELICS[id].color;
  const bitmap = { rows, colors: { k: PX.ink, c: color, w: tint(color, 0.45), d: tint(color, -0.35) } };
  relicBitmaps.set(id, bitmap);
  return bitmap;
}

/** A relic's icon in its own colour: its vector shape in pixels. */
export function RelicIcon({ id, size = 24 }: { id: RelicId; size?: number }) {
  return <BitmapIcon icon={relicBitmap(id)} scale={Math.max(1, Math.round(size / RELIC_GRID))} className="relic-icon" />;
}

/** A serpent coiled around a foe, for Constrict. */
export function CoilIcon({ size = 26 }: { size?: number }) {
  return <PixelIcon name="coil" scale={Math.max(2, Math.round(size / 9))} />;
}

/** Arcane Shard currency symbol. */
export function Shard({ scale = 2 }: { scale?: number }) {
  return <PixelIcon name="shard" scale={scale} className="shard-px" />;
}

// ---------------------------------------------------------------- pixel sigils

function sigilPixels(spell: SpellId): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push([x, y]);
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) add(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n));
  };
  if (spell === 'bolt') line(1, 10, 10, 1);
  else if (spell === 'lightning') {
    line(1, 1, 5, 10);
    line(6, 10, 10, 1);
  } else if (spell === 'ward') {
    line(5, 1, 10, 10);
    line(10, 10, 1, 10);
    line(1, 10, 5, 1);
  } else if (spell === 'frost') {
    line(0, 3, 3, 10);
    line(3, 10, 6, 2);
    line(6, 2, 10, 9);
  } else {
    for (let i = 0; i <= 48; i++) {
      const a = -Math.PI / 2 + (i / 48) * Math.PI * 2;
      add(Math.round(5.5 + Math.cos(a) * 4.6), Math.round(5.5 + Math.sin(a) * 4.6));
    }
  }
  return out;
}

/** Sample sigil drawn pixel by pixel; `animate` replays the stroke like a hand drawing it. */
export function PixelSigil({ spell, size, animate }: { spell: SpellId; size: number; animate: boolean }) {
  const pts = useMemo(() => sigilPixels(spell), [spell]);
  return (
    <svg
      className={`pixel-sigil${animate ? ' pixel-sigil-animate' : ''}`}
      width={size}
      height={size}
      viewBox="-1 -1 14 14"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {pts.map(([x, y], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={i === 0 ? '#ffffff' : 'currentColor'}
          style={animate ? { animationDelay: `${(i / pts.length) * 1.3}s` } : undefined}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- title screen pieces

/** A wizard's serpent, small and static, in its pixel sprites. */
export function WizardPortrait({ id }: { id: WizardId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: 6 + i * 4.2, y: 17 + Math.sin(i * 0.9) * 3 }));
    for (let i = 0; i < pts.length; i++) blit(ctx, segmentOutline(2 + Math.round(i / 2)), pts[i].x, pts[i].y);
    for (let i = 0; i < pts.length; i++) blit(ctx, segmentFill(2 + Math.round(i / 2), i % 4 === 2 ? 'stripe' : 'body', id), pts[i].x, pts[i].y);
    blit(ctx, wizardHead('player', 0, 0, 'normal', id), 36, 17);
    ctx.fillStyle = PX.eye;
    ctx.fillRect(38, 14, 2, 2);
    ctx.fillRect(38, 19, 2, 2);
  }, [id]);
  return <canvas ref={ref} width={52} height={30} className="wizard-portrait px" aria-hidden="true" />;
}

/** The real game sprites, slithering on a tiny canvas that CSS scales up with crisp pixels. */
export function PixelTitleSerpent({ wizard = 'arcanist' }: { wizard?: WizardId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const N = 26;
    const draw = (now: number) => {
      const t = now / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const pts = Array.from({ length: N }, (_, i) => ({
        x: 14 + i * 4.6,
        y: canvas.height / 2 + 2 + Math.sin(i * 0.38 - t * 3) * 7,
      }));
      const radius = (i: number) => Math.max(2, Math.round(2 + (i / (N - 1)) * 3.5));
      for (let i = 0; i < N - 1; i++) blit(ctx, segmentOutline(radius(i)), pts[i].x, pts[i].y);
      for (let i = 0; i < N - 1; i++) blit(ctx, segmentFill(radius(i), i % 4 === 2 ? 'stripe' : 'body', wizard), pts[i].x, pts[i].y);
      const head = pts[N - 1];
      const prev = pts[N - 2];
      const heading = Math.atan2(head.y - prev.y, head.x - prev.x);
      const dir = ((Math.round((heading / (Math.PI * 2)) * 16) % 16) + 16) % 16;
      const sway = Math.max(-1, Math.min(1, Math.round(Math.sin(t * 3.2) * 1.3)));
      blit(ctx, wizardHead('player', dir, sway, 'normal', wizard), head.x, head.y);
      ctx.fillStyle = PX.eye;
      for (const side of [-1, 1]) {
        const a = heading + side * 0.62;
        ctx.fillRect(Math.round(head.x + Math.cos(a) * 3.7) - 1, Math.round(head.y + Math.sin(a) * 3.7) - 1, 2, 2);
      }
      ctx.fillStyle = PX.ink;
      for (const side of [-1, 1]) {
        const a = heading + side * 0.62;
        ctx.fillRect(Math.round(head.x + Math.cos(a) * 3.7), Math.round(head.y + Math.sin(a) * 3.7) - 1, 1, 1);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [wizard]);
  return <canvas ref={ref} width={150} height={44} className="pixel-title-serpent" aria-hidden="true" />;
}

/** Data URL of the Rune Plaza's pixel floor, used as the menus' backdrop. */
let floorUrl: string | null = null;
export function pixelFloorUrl(): string {
  if (!floorUrl) {
    const map = buildLayout(RUINS, 1);
    const plaza = map.landmarks.find((l) => l.kind === 'plaza') ?? map.start;
    floorUrl = pixelFloorPicture(map, 0, plaza.x, plaza.y, 560, 320).toDataURL();
  }
  return floorUrl;
}
