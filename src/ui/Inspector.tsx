import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { PIXEL_ART, SIM } from '../game/config';
import {
  createStage,
  defaultOptions,
  focusOf,
  hitCircles,
  hitSubject,
  killSubject,
  landmarksOf,
  resetStage,
  showsSerpent,
  stepStage,
  STATUS_NAMES,
  SUBJECT_GROUPS,
  SUBJECTS,
  type FoeStatus,
  type Stage,
  type StageOptions,
  type Subject,
} from '../game/inspect';
import { MAP_ORDER, MAPS } from '../game/maps';
import type { MapId } from '../game/maps/types';
import { TAU, type Vec } from '../game/math';
import { DEFAULT_VIEW, type ViewOptions } from '../game/options';
import { RELIC_IDS, RELICS, type RelicId } from '../game/relics';
import { Renderer } from '../game/render';
import type { EliteKind, GestureView } from '../game/world';
import { RelicIcon, relicArt } from './art';
import type { Bitmap } from './shopIcons';
import './inspector.css';

/**
 * Development only (open the game with ?inspector): every sprite and effect on its own, without
 * playing. Pick a subject on the left; the middle shows it drawn by the game's own renderer,
 * idle or live; the right has what it is and ways to pose it. Drag to pan, scroll to zoom.
 * Relics are icons, so the middle draws them as the menus do instead, over the stage.
 */

const P = PIXEL_ART.worldPerPixel;
const ZOOMS = [1, 2, 3, 4, 6, 8, 12];
const SPEEDS = [0.25, 0.5, 1, 2];
const SPEED_NAMES: Record<number, string> = { 0.25: '¼', 0.5: '½' };
const BACKDROPS = { floor: null, dark: '#0a0614', light: '#8c86a0' } as const;
type Backdrop = keyof typeof BACKDROPS;
/** Relics' icons: 16×16, drawn 1× in the HUD and pause list and 3× on cards. */
const ICON_ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24];
/** Behind a relic, the floor's place is taken by a relic card's colour. */
const ICON_BACKDROPS: Record<Backdrop, string> = { floor: '#2a1a40', dark: BACKDROPS.dark, light: BACKDROPS.light };
type IconPixel = { x: number; y: number; ch: string; color: string | null };
const NO_GESTURE: GestureView = { active: false, points: [], target: null, lock: null, fade: null, reading: null };
const ELITE_NAMES: Record<EliteKind, string> = { shielded: 'Shielded', swift: 'Swift', splitting: 'Splitting' };
const TURN = TAU / 16;

/** Options that change what is placed, so the subject is put back fresh when one changes. */
const PLACED: (keyof StageOptions)[] = ['live', 'elite', 'evolved', 'variant', 'spent', 'length'];
/** Options a live subject only takes when it is placed (an idle one holds them every step). */
const PLACED_LIVE: (keyof StageOptions)[] = ['statuses', 'enraged', 'phase'];

function subjectFromHash(): Subject {
  const id = decodeURIComponent(location.hash.slice(1));
  return SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
}

export default function Inspector() {
  const [subject, setSubject] = useState<Subject>(subjectFromHash);
  const [options, setOptions] = useState<StageOptions>(defaultOptions);
  const [floor, setFloor] = useState<MapId | null>(null);
  const [zoom, setZoom] = useState(3);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [backdrop, setBackdrop] = useState<Backdrop>('floor');
  const [view, setView] = useState<ViewOptions>({ ...DEFAULT_VIEW, minimap: false });
  const [boxes, setBoxes] = useState(false);
  const [grid, setGrid] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [iconZoom, setIconZoom] = useState(8);
  const [pixel, setPixel] = useState<IconPixel | null>(null);
  const icon = subject.relic ?? null;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const stageRef = useRef<Stage | null>(null);
  /** The view's offset from what it follows, in world units (dragging pans). */
  const pan = useRef<Vec>({ x: 0, y: 0 });
  const loop = useRef({ playing, speed, boxes, grid, icon: !!icon });
  loop.current = { playing, speed, boxes, grid, icon: !!icon };
  /** Steps waiting to run while paused (the Step button). */
  const pendingSteps = useRef(0);
  /** The options the stage has now (the state above only redraws the panel). */
  const optionsRef = useRef(options);

  // A new subject or floor gets a new stage (and the panel redraws for it: a floor's landmarks).
  const map = floor ?? subject.map;
  const [, setBuilt] = useState(0);
  useEffect(() => {
    stageRef.current = createStage(subject, { ...optionsRef.current }, map);
    setBuilt((n) => n + 1);
  }, [subject, map]);

  // A new subject starts with the usual options, its own floor and the view on it; live or idle carries over.
  const choose = useCallback((s: Subject) => {
    const next = { ...defaultOptions(), live: optionsRef.current.live };
    optionsRef.current = next;
    setOptions(next);
    setSubject(s);
    setFloor(null);
    setPixel(null);
    pan.current = { x: 0, y: 0 };
    history.replaceState(null, '', `#${encodeURIComponent(s.id)}`);
  }, []);

  /** Changes options, putting the subject back when the change needs it. */
  const patch = useCallback((p: Partial<StageOptions>) => {
    const next = { ...optionsRef.current, ...p };
    optionsRef.current = next;
    setOptions(next);
    const st = stageRef.current;
    if (!st) return;
    st.options = next;
    const keys = Object.keys(p) as (keyof StageOptions)[];
    if (keys.some((k) => PLACED.includes(k) || (next.live && PLACED_LIVE.includes(k)))) resetStage(st);
  }, []);

  useEffect(() => {
    document.title = `${subject.name} · Inspector`;
  }, [subject]);

  // Console handle for checking the inspector by script: the stage, and running it for a while.
  useEffect(() => {
    const handle = window as unknown as { __inspector?: unknown };
    handle.__inspector = {
      stage: () => stageRef.current,
      run: (seconds: number) => {
        const st = stageRef.current;
        if (st) for (let t = 0; t < seconds; t += SIM.step) stepStage(st, SIM.step);
      },
    };
    return () => {
      delete handle.__inspector;
    };
  }, []);

  // The renderer, the frame loop and the canvas size.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const overlay = overlayRef.current!;
    const r = new Renderer(canvas);
    rendererRef.current = r;
    r.pixelScale = 3;
    r.resize();
    const fit = () => {
      r.resize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      overlay.width = Math.round(canvas.clientWidth * dpr);
      overlay.height = Math.round(canvas.clientHeight * dpr);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    fit();
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let viewTime = 0;
    const frame = (now: number) => {
      const dt = Math.min(SIM.maxFrame, (now - last) / 1000);
      last = now;
      const st = stageRef.current;
      // A relic's icon covers the stage, so nothing is run or drawn under it.
      if (st && !loop.current.icon) {
        const { playing, speed } = loop.current;
        let run = 0;
        if (playing) {
          acc += dt * speed;
          while (acc >= SIM.step && run < SIM.maxSubSteps) {
            stepStage(st, SIM.step);
            acc -= SIM.step;
            run++;
          }
          if (run >= SIM.maxSubSteps) acc = 0;
        } else {
          for (; pendingSteps.current > 0; pendingSteps.current--, run++) stepStage(st, SIM.step);
        }
        viewTime += run * SIM.step;
        const cam = st.world.camera;
        const f = focusOf(st);
        cam.x = f.x + pan.current.x;
        cam.y = f.y + pan.current.y;
        cam.viewW = r.viewW;
        cam.viewH = r.viewH;
        r.render(st.world, NO_GESTURE, viewTime, showsSerpent(st));
        drawOverlay(overlay, r, st, loop.current.boxes, loop.current.grid);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.pixelScale = zoom;
    r.resize();
  }, [zoom]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.backdrop = BACKDROPS[backdrop];
  }, [backdrop]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.view = view;
  }, [view]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? SUBJECTS.filter((s) => s.name.toLowerCase().includes(q) || s.group.toLowerCase().includes(q)) : SUBJECTS;
  }, [query]);

  const step = useCallback(() => {
    setPlaying(false);
    pendingSteps.current += 2;
  }, []);

  const zoomBy = useCallback(
    (d: number) => {
      const along = (list: number[]) => (z: number) => list[Math.max(0, Math.min(list.length - 1, list.indexOf(z) + d))];
      if (icon) setIconZoom(along(ICON_ZOOMS));
      else setZoom(along(ZOOMS));
    },
    [icon],
  );

  // Keys: arrows pick, Space plays, the rest are on their buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = stageRef.current;
      const at = shown.indexOf(subject);
      const act: Record<string, () => void> = {
        ArrowDown: () => shown.length > 0 && choose(shown[(at + 1) % shown.length]),
        ArrowUp: () => shown.length > 0 && choose(shown[(at - 1 + shown.length) % shown.length]),
        Space: () => setPlaying((p) => !p),
        Period: step,
        Equal: () => zoomBy(1),
        Minus: () => zoomBy(-1),
        KeyL: () => subject.features.live && patch({ live: !options.live }),
        KeyH: () => st && hitSubject(st),
        KeyX: () => st && killSubject(st),
        KeyR: () => st && resetStage(st),
        KeyB: () => setBoxes((b) => !b),
        KeyG: () => setGrid((g) => !g),
        Digit0: () => (pan.current = { x: 0, y: 0 }),
      };
      const fn = act[e.code];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, subject, options.live, choose, patch, step, zoomBy]);

  // Drag to pan; the readout follows the pointer.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    if (!r) return;
    const box = e.currentTarget.getBoundingClientRect();
    setCursor(r.screenToWorld({ x: e.clientX - box.left, y: e.clientY - box.top }));
    if (!drag.current) return;
    pan.current = { x: pan.current.x - (e.clientX - drag.current.x) / r.scale, y: pan.current.y - (e.clientY - drag.current.y) / r.scale };
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const f = subject.features;
  const st = stageRef.current;
  const toggleStatus = (s: FoeStatus) => patch({ statuses: options.statuses.includes(s) ? options.statuses.filter((x) => x !== s) : [...options.statuses, s] });

  return (
    <div className="inspector">
      <aside className="insp-list">
        <div className="insp-brand">Inspector</div>
        <input className="insp-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search subjects" />
        <nav>
          {SUBJECT_GROUPS.map((g) => {
            const items = shown.filter((s) => s.group === g);
            if (items.length === 0) return null;
            return (
              <section key={g}>
                <h3>{g}</h3>
                {items.map((s) => (
                  <button key={s.id} className={s === subject ? 'on' : ''} data-subject={s.id} onClick={() => choose(s)}>
                    {s.name}
                  </button>
                ))}
              </section>
            );
          })}
        </nav>
      </aside>

      <main className="insp-stage">
        <canvas
          ref={canvasRef}
          className="insp-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={() => (pan.current = { x: 0, y: 0 })}
          onWheel={(e) => zoomBy(e.deltaY < 0 ? 1 : -1)}
        />
        <canvas ref={overlayRef} className="insp-overlay" aria-hidden="true" />
        {icon && (
          <div className="insp-icons" style={{ background: ICON_BACKDROPS[backdrop] }}>
            {icon === 'all' ? (
              <RelicSheet zoom={iconZoom} grid={grid} onPick={(id) => choose(SUBJECTS.find((s) => s.relic === id)!)} />
            ) : (
              <RelicView id={icon} zoom={iconZoom} grid={grid} pixel={pixel} onPixel={setPixel} onZoom={zoomBy} />
            )}
          </div>
        )}
        <div className="insp-status">
          <span>{subject.name}</span>
          {!icon && <span>{MAPS[map].name}</span>}
          <span>{icon ? iconZoom : zoom}× zoom</span>
          {!icon && !playing && <span className="insp-paused">Paused</span>}
          {!icon && cursor && (
            <span>
              x {Math.round(cursor.x)} y {Math.round(cursor.y)} · art px {Math.floor(cursor.x / P)}, {Math.floor(cursor.y / P)}
            </span>
          )}
          {icon && pixel && (
            <span>
              art px {pixel.x}, {pixel.y} · {pixel.color ? `${pixel.ch} ${pixel.color}` : 'clear'}
            </span>
          )}
        </div>
      </main>

      <aside className="insp-panel">
        <h2>{subject.name}</h2>
        <div className="insp-group">{subject.group}</div>
        <dl className="insp-notes">
          {subject.notes.map(([k, v], i) =>
            k ? (
              <div key={i}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ) : (
              <p key={i}>{v}</p>
            ),
          )}
          {icon && icon !== 'all' && (
            <div>
              <dt>Pixels</dt>
              <dd>{relicArt(icon).source}</dd>
            </div>
          )}
        </dl>

        {icon && (
          <>
            <Section title="View">
              <Choice value={iconZoom} options={ICON_ZOOMS.map((z) => [z, `${z}×`])} onPick={setIconZoom} />
              <Choice<Backdrop> value={backdrop} options={[['floor', 'Card'], ['dark', 'Dark'], ['light', 'Light']]} onPick={setBackdrop} />
              <div className="insp-row">
                <Btn on={grid} onClick={() => setGrid((g) => !g)} keyHint="G">
                  Pixel grid
                </Btn>
              </div>
              <p className="insp-hint">The game draws relics at 1× (the HUD, the pause list) and 3× (cards). The grid shows from 4×.</p>
            </Section>
            {icon !== 'all' && (
              <Section title="Palette">
                <Palette bitmap={relicArt(icon).bitmap} active={pixel?.ch ?? null} />
              </Section>
            )}
            <p className="insp-keys">↑ ↓ pick · + − or scroll to zoom · G grid</p>
          </>
        )}

        {f.live && (
          <Section title="Behaviour" hint="L">
            <Choice value={options.live} options={[[false, 'Idle'], [true, 'Live']]} onPick={(v) => patch({ live: v })} />
            <p className="insp-hint">
              {options.live
                ? subject.serpent === 'live'
                  ? 'Its own logic runs, hunting a serpent that circles and can’t be hurt.'
                  : 'Everything runs as in play.'
                : 'Nothing thinks or moves; only its animation runs.'}
            </p>
          </Section>
        )}

        {!icon && (
          <Section title="Time">
            <div className="insp-row">
              <Btn onClick={() => setPlaying((p) => !p)} keyHint="Space">
                {playing ? 'Pause' : 'Play'}
              </Btn>
              <Btn onClick={step} keyHint=".">
                Step
              </Btn>
            </div>
            <Choice value={speed} options={SPEEDS.map((s) => [s, `${SPEED_NAMES[s] ?? s}×`])} onPick={setSpeed} />
          </Section>
        )}

        {!icon && (
          <Section title="View">
            <Choice value={zoom} options={ZOOMS.map((z) => [z, `${z}×`])} onPick={setZoom} />
            <Choice<Backdrop> value={backdrop} options={[['floor', 'Floor'], ['dark', 'Dark'], ['light', 'Light']]} onPick={setBackdrop} />
            <Choice value={map} options={MAP_ORDER.map((m) => [m, MAPS[m].name.replace(/^The /, '')])} onPick={(m) => setFloor(m)} />
            <div className="insp-row">
              <Btn on={boxes} onClick={() => setBoxes((b) => !b)} keyHint="B">
                Hitboxes
              </Btn>
              <Btn on={grid} onClick={() => setGrid((g) => !g)} keyHint="G">
                Pixel grid
              </Btn>
            </div>
            <div className="insp-row">
              <Btn on={view.safeWarnings} onClick={() => setView((v) => ({ ...v, safeWarnings: !v.safeWarnings }))}>
                Safe warnings
              </Btn>
              <Btn on={view.reduceFlashing} onClick={() => setView((v) => ({ ...v, reduceFlashing: !v.reduceFlashing }))}>
                Less flashing
              </Btn>
            </div>
            <div className="insp-row">
              <Btn on={view.shake > 0} onClick={() => setView((v) => ({ ...v, shake: v.shake > 0 ? 0 : 1 }))}>
                Shake
              </Btn>
              <Btn onClick={() => (pan.current = { x: 0, y: 0 })} keyHint="0">
                Recenter
              </Btn>
            </div>
          </Section>
        )}

        {(f.hit || f.kill || f.heading || f.live || subject.every) && (
          <Section title="Subject">
            {f.heading && (
              <div className="insp-row">
                <Btn onClick={() => patch({ heading: (options.heading - TURN + TAU) % TAU })}>⟲ Turn</Btn>
                <Btn onClick={() => patch({ heading: (options.heading + TURN) % TAU })}>Turn ⟳</Btn>
                <Btn on={options.spin} onClick={() => patch({ spin: !options.spin })}>
                  Spin
                </Btn>
              </div>
            )}
            <div className="insp-row">
              {f.hit && (
                <Btn onClick={() => st && hitSubject(st)} keyHint="H">
                  Hit
                </Btn>
              )}
              {f.kill && (
                <Btn onClick={() => st && killSubject(st)} keyHint="X">
                  {subject.group === 'Objects' ? 'Break' : 'Kill'}
                </Btn>
              )}
              <Btn onClick={() => st && resetStage(st)} keyHint="R">
                Reset
              </Btn>
            </div>
          </Section>
        )}

        {f.elites.length > 0 && (
          <Section title="Elite">
            <Choice value={options.elite} options={[[null, 'None'], ...f.elites.map((k): [EliteKind, string] => [k, ELITE_NAMES[k]])]} onPick={(v) => patch({ elite: v })} />
          </Section>
        )}

        {f.statuses.length > 0 && (
          <Section title="Status">
            <div className="insp-row wrap">
              {f.statuses.map((s) => (
                <Btn key={s} on={options.statuses.includes(s)} onClick={() => toggleStatus(s)}>
                  {STATUS_NAMES[s]}
                </Btn>
              ))}
            </div>
            <p className="insp-hint">{options.live ? 'Live, a status starts as it is placed and wears off.' : 'Idle, a status holds until turned off.'}</p>
          </Section>
        )}

        {f.enrage && (
          <Section title="Enraged">
            <Choice value={options.enraged} options={[[false, 'Calm'], [true, 'Enraged']]} onPick={(v) => patch({ enraged: v })} />
          </Section>
        )}

        {f.phases > 0 && (
          <Section title="Phase">
            <Choice value={options.phase} options={Array.from({ length: f.phases }, (_, i): [number, string] => [i, ['Arcane', 'Frost', 'Fire'][i] ?? `${i + 1}`])} onPick={(v) => patch({ phase: v })} />
          </Section>
        )}

        {f.variants > 0 && (
          <Section title="Variant">
            <Choice value={options.variant} options={Array.from({ length: f.variants }, (_, i): [number, string] => [i, `${i + 1}`])} onPick={(v) => patch({ variant: v })} />
          </Section>
        )}

        {f.evolution && (
          <Section title="Form">
            <Choice value={options.evolved} options={[[false, 'Base'], [true, f.evolution]]} onPick={(v) => patch({ evolved: v })} />
          </Section>
        )}

        {f.spent && (
          <Section title="State">
            <Choice value={options.spent} options={[[false, 'Fresh'], [true, 'Spent']]} onPick={(v) => patch({ spent: v })} />
          </Section>
        )}

        {f.length && (
          <Section title="Length">
            <Choice value={options.length} options={[8, 24, 48, 72].map((n): [number, string] => [n, `${n}`])} onPick={(v) => patch({ length: v })} />
          </Section>
        )}

        {subject.group === 'Floors' && st && (
          <Section title="Landmarks">
            <div className="insp-row wrap">
              {landmarksOf(st).map((l, i) => (
                <Btn key={i} onClick={() => (pan.current = { x: l.x - st.center.x, y: l.y - st.center.y })}>
                  {l.name}
                </Btn>
              ))}
            </div>
          </Section>
        )}

        {!icon && <p className="insp-keys">↑ ↓ pick · Space play · . step · + − zoom · drag to pan, double-click to recenter</p>}
      </aside>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="insp-section">
      <h4>
        {title}
        {hint && <kbd>{hint}</kbd>}
      </h4>
      {children}
    </section>
  );
}

function Btn({ on, onClick, keyHint, children }: { on?: boolean; onClick(): void; keyHint?: string; children: ReactNode }) {
  return (
    <button className={`insp-btn${on ? ' on' : ''}`} onClick={onClick} title={keyHint ? `Key: ${keyHint}` : undefined}>
      {children}
    </button>
  );
}

function Choice<T>({ value, options, onPick }: { value: T; options: [T, string][]; onPick(v: T): void }) {
  return (
    <div className="insp-row wrap">
      {options.map(([v, label]) => (
        <Btn key={String(v)} on={v === value} onClick={() => onPick(v)}>
          {label}
        </Btn>
      ))}
    </div>
  );
}

/** A relic's icon at the zoom, with the art-pixel grid over it from 4× up. */
function BigIcon({
  id,
  zoom,
  grid,
  children,
  ...on
}: { id: RelicId; zoom: number; grid: boolean; children?: ReactNode } & Pick<HTMLAttributes<HTMLSpanElement>, 'onPointerMove' | 'onPointerLeave'>) {
  return (
    <span className={`insp-big${grid && zoom >= 4 ? ' grid' : ''}`} style={{ '--z': `${zoom}px` } as CSSProperties} {...on}>
      <RelicIcon id={id} size={16 * zoom} />
      {children}
    </span>
  );
}

/** One relic: large, the pointer reading out the pixel under it, then as the game shows it. */
function RelicView({
  id,
  zoom,
  grid,
  pixel,
  onPixel,
  onZoom,
}: {
  id: RelicId;
  zoom: number;
  grid: boolean;
  pixel: IconPixel | null;
  onPixel(p: IconPixel | null): void;
  onZoom(d: number): void;
}) {
  const r = RELICS[id];
  const { bitmap } = relicArt(id);
  const read = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - box.left) / zoom);
    const y = Math.floor((e.clientY - box.top) / zoom);
    const ch = bitmap.rows[y]?.[x];
    onPixel(ch === undefined ? null : { x, y, ch, color: bitmap.colors[ch] ?? null });
  };
  return (
    <div className="insp-relic" onWheel={(e) => onZoom(e.deltaY < 0 ? 1 : -1)}>
      <BigIcon id={id} zoom={zoom} grid={grid} onPointerMove={read} onPointerLeave={() => onPixel(null)}>
        {pixel && <span className="insp-pick" style={{ left: pixel.x * zoom, top: pixel.y * zoom, width: zoom, height: zoom }} />}
      </BigIcon>
      <div className="insp-ingame">
        <figure>
          <div className="insp-card" style={{ '--relic': r.color } as CSSProperties}>
            <RelicIcon id={id} size={48} />
            <b>{r.name}</b>
            <small>{r.map ? `Relic of the ${MAPS[r.map].name}` : 'Relic'}</small>
          </div>
          <figcaption>Relic choice · 3×</figcaption>
        </figure>
        <figure>
          <span className="insp-chip">
            <RelicIcon id={id} size={16} />
          </span>
          <figcaption>HUD · 1×</figcaption>
        </figure>
        <figure>
          <div className="insp-listing">
            <RelicIcon id={id} size={16} />
            <span>
              <b>{r.name}</b> {r.description}
            </span>
          </div>
          <figcaption>Pause list · 1×</figcaption>
        </figure>
      </div>
    </div>
  );
}

/** Every relic side by side: at the zoom, then 3× and 1× as the game draws them. */
function RelicSheet({ zoom, grid, onPick }: { zoom: number; grid: boolean; onPick(id: RelicId): void }) {
  return (
    <div className="insp-sheet" style={{ '--z': `${zoom}px` } as CSSProperties}>
      {RELIC_IDS.map((id) => (
        <button key={id} className="insp-sheet-cell" data-relic={id} title={RELICS[id].description} onClick={() => onPick(id)}>
          <BigIcon id={id} zoom={zoom} grid={grid} />
          <span className="insp-sheet-small">
            <RelicIcon id={id} size={48} />
            <span className="insp-chip">
              <RelicIcon id={id} size={16} />
            </span>
          </span>
          <span className="insp-sheet-name">{RELICS[id].name}</span>
        </button>
      ))}
    </div>
  );
}

/** Each colour in a bitmap, most used first, with its letter and how many pixels use it. */
function Palette({ bitmap, active }: { bitmap: Bitmap; active: string | null }) {
  const counts = new Map<string, number>();
  for (const row of bitmap.rows) for (const ch of row) if (bitmap.colors[ch]) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return (
    <ul className="insp-palette">
      {[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([ch, n]) => (
          <li key={ch} className={ch === active ? 'on' : undefined}>
            <span className="insp-swatch" style={{ background: bitmap.colors[ch] }} />
            <code>{ch}</code>
            <span>{bitmap.colors[ch]}</span>
            <span className="insp-count">{n} px</span>
          </li>
        ))}
    </ul>
  );
}

/** Hitboxes and the art-pixel grid, over the game's canvas. */
function drawOverlay(canvas: HTMLCanvasElement, r: Renderer, st: Stage, boxes: boolean, grid: boolean): void {
  const g = canvas.getContext('2d')!;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (grid) {
    const cell = P * r.scale;
    if (cell >= 4) {
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1 / dpr;
      g.beginPath();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (let x = r.ox % cell; x < w; x += cell) {
        g.moveTo(x, 0);
        g.lineTo(x, h);
      }
      for (let y = r.oy % cell; y < h; y += cell) {
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();
    }
  }
  if (boxes) {
    g.lineWidth = 1.5;
    for (const c of hitCircles(st)) {
      const p = r.worldToScreen(c);
      g.strokeStyle = c.color;
      g.beginPath();
      g.arc(p.x, p.y, Math.max(1, c.r * r.scale), 0, TAU);
      g.stroke();
    }
  }
}
