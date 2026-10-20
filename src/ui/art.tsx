import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { SpellId } from '../game/config';
import { buildPixelFloor } from '../game/pixel/floor';
import { PX } from '../game/pixel/palette';
import { segmentFill, segmentOutline, wizardHead } from '../game/pixel/sprites';
import { blit } from '../game/pixel/bake';

/** True when the pixel-art style is active; menus and HUD switch their art from this. */
export const PixelArtContext = createContext(false);
export const usePixelArt = () => useContext(PixelArtContext);

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
} satisfies Record<string, Bitmap>;

export type IconName = keyof typeof ICONS;

/** Crisp pixel icon rendered as SVG squares; `scale` is CSS pixels per icon pixel. */
export function PixelIcon({ name, scale = 3, className }: { name: IconName; scale?: number; className?: string }) {
  const icon: Bitmap = ICONS[name];
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
  potency: 'star',
  multibolt: 'fork',
  pierce: 'pierce',
  chains: 'lightning',
  novaRadius: 'ring',
  haste: 'hourglass',
  vitality: 'heart',
  magnet: 'crystal',
  regen: 'plus',
  restore: 'potion',
  // permanent upgrades
  health: 'heart',
  damage: 'star',
  pickup: 'crystal',
  wisdom: 'eye',
};

/** Upgrade/meta glyph: the original symbol in classic style, a pixel icon in pixel style. */
export function UpgradeGlyph({ id, glyph }: { id: string; glyph: string }) {
  const pixel = usePixelArt();
  if (pixel && UPGRADE_ICON[id]) return <PixelIcon name={UPGRADE_ICON[id]} scale={4} className="card-glyph-px" />;
  return <span className="card-glyph">{glyph}</span>;
}

/** Arcane Shard currency symbol. */
export function Shard({ scale = 2 }: { scale?: number }) {
  const pixel = usePixelArt();
  return pixel ? <PixelIcon name="shard" scale={scale} className="shard-px" /> : <>✧</>;
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

/** The real game sprites, slithering on a tiny canvas that CSS scales up with crisp pixels. */
export function PixelTitleSerpent() {
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
      for (let i = 0; i < N - 1; i++) blit(ctx, segmentFill(radius(i), i % 4 === 2 ? 'stripe' : 'body'), pts[i].x, pts[i].y);
      const head = pts[N - 1];
      const prev = pts[N - 2];
      const heading = Math.atan2(head.y - prev.y, head.x - prev.x);
      const dir = ((Math.round((heading / (Math.PI * 2)) * 16) % 16) + 16) % 16;
      const sway = Math.max(-1, Math.min(1, Math.round(Math.sin(t * 3.2) * 1.3)));
      blit(ctx, wizardHead('player', dir, sway), head.x, head.y);
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
  }, []);
  return <canvas ref={ref} width={150} height={44} className="pixel-title-serpent" aria-hidden="true" />;
}

/** Data URL of the pixel arena floor, used as the menu backdrop in pixel style. */
let floorUrl: string | null = null;
export function pixelFloorUrl(): string {
  if (!floorUrl) floorUrl = buildPixelFloor().canvas.toDataURL();
  return floorUrl;
}
