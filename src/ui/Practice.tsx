import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { audio } from '../game/audio';
import { castTier, type CastTier } from '../game/cast';
import { CLEAN_CAST, GESTURE } from '../game/config';
import { analyzeStroke, recognize, SIGIL_KINDS, type Pt, type SigilKind, type StrokeAnalysis } from '../game/gesture';
import { COLORS } from '../game/palette';
import { cornerMarks, measurements, reportAttempt, SHAPE_NAMES, SHAPE_TIPS, shapeOverlay, type AttemptOutcome } from '../game/practice';
import { SIGIL_TO_SPELL, SPELL_COLORS } from '../game/spells';
import { SigilIcon, SPELL_UI } from './SigilIcon';

const PIXEL_FONT = "'Silkscreen', 'Courier New', monospace";
const NEUTRAL = '#dcd0ff';
const FIT = '#ffd45e';
const CORNER = '#ff7ad9';
const HISTORY = 14;

interface Attempt {
  outcome: AttemptOutcome;
  tier: CastTier | null;
}

/** Faint example of each sigil for the guide, in a -0.5..0.5 box; the first point is where to start. */
const GUIDES: Record<SigilKind, Pt[]> = {
  line: [
    { x: -0.45, y: 0.45 },
    { x: 0.45, y: -0.45 },
  ],
  vee: [
    { x: -0.38, y: -0.42 },
    { x: 0, y: 0.45 },
    { x: 0.38, y: -0.42 },
  ],
  circle: Array.from({ length: 41 }, (_, i) => ({ x: Math.sin((i / 40) * Math.PI * 2) * 0.45, y: -Math.cos((i / 40) * Math.PI * 2) * 0.45 })),
  triangle: [
    { x: 0, y: -0.45 },
    { x: 0.48, y: 0.4 },
    { x: -0.48, y: 0.4 },
    { x: 0, y: -0.45 },
  ],
  zigzag: [
    { x: -0.5, y: -0.3 },
    { x: -0.17, y: 0.42 },
    { x: 0.17, y: -0.42 },
    { x: 0.5, y: 0.3 },
  ],
};

function strokeColor(kind: SigilKind | null): string {
  return kind ? SPELL_COLORS[SIGIL_TO_SPELL[kind]] : NEUTRAL;
}

/** A place to draw sigils with no run at stake, showing how the recognizer reads each stroke. */
export function PracticeScreen({ onBack, onPlay }: { onBack(): void; onPlay(): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ points: Pt[]; pointer: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [target, setTarget] = useState<SigilKind | null>(null);
  const [live, setLive] = useState<{ kind: SigilKind; tier: CastTier } | null>(null);
  const [last, setLast] = useState<{ raw: Pt[]; analysis: StrokeAnalysis } | null>(null);
  const [history, setHistory] = useState<Attempt[]>([]);

  const report = useMemo(() => (last ? reportAttempt(last.analysis, target) : null), [last, target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  // Keep the canvas backing store matched to its on-screen size.
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const fit = () => setSize({ w: pad.clientWidth, h: pad.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pad);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'square';
    const font = (px: number) => `800 ${px}px ${PIXEL_FONT}`;
    const label = (text: string, x: number, y: number, color: string) => {
      ctx.font = font(12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,6,20,0.9)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    const path = (pts: Pt[], closed = false) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      if (closed) ctx.closePath();
    };
    const drawing = stroke.current;

    // Guide: a faint example of the chosen sigil, with a dot where it starts.
    if (target && !drawing && !last) {
      const s = Math.min(size.w, size.h) * 0.5;
      const pts = GUIDES[target].map((p) => ({ x: size.w / 2 + p.x * s, y: size.h / 2 + p.y * s }));
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = 'rgba(220,208,255,0.22)';
      ctx.lineWidth = 6;
      path(pts);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(220,208,255,0.4)';
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (drawing) {
      const color = live ? strokeColor(live.kind) : NEUTRAL;
      ctx.strokeStyle = color;
      ctx.lineWidth = live?.tier === 'perfect' ? 7 : 5;
      path(drawing.points);
      ctx.stroke();
      return;
    }
    if (!last || !report) return;

    const a = last.analysis;
    const color = report.outcome === 'hit' ? strokeColor(report.kind) : COLORS.unclear;
    // What was drawn, faint, then the points the recognizer actually read.
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    path(last.raw);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (report.outcome === 'tiny') return;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    path(a.points);
    ctx.stroke();
    ctx.fillStyle = color;
    for (const p of a.points) ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);

    // The shape the recognizer fitted for the sigil in focus.
    const first = a.points[0];
    const end = a.points[a.points.length - 1];
    const focus = report.focus;
    if (focus === 'circle' || focus === 'triangle') {
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      path([first, end]);
      ctx.stroke();
      ctx.setLineDash([]);
      const gap = Math.hypot(end.x - first.x, end.y - first.y);
      if (gap > 24) label('gap', (first.x + end.x) / 2, (first.y + end.y) / 2 - 12, '#ffffff');
    }
    const fit = focus ? shapeOverlay(a, focus) : null;
    if (fit) {
      ctx.setLineDash([12, 8]);
      ctx.strokeStyle = FIT;
      ctx.lineWidth = 2.5;
      if (fit.type === 'circle') {
        ctx.beginPath();
        ctx.arc(fit.center.x, fit.center.y, fit.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = FIT;
        ctx.fillRect(fit.center.x - 3, fit.center.y - 3, 6, 6);
      } else {
        path(fit.points, fit.closed);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Sharp corners, with the angle inside each bend.
    for (const c of cornerMarks(a)) {
      const r = 7;
      ctx.fillStyle = CORNER;
      ctx.strokeStyle = 'rgba(10,6,20,0.9)';
      ctx.lineWidth = 2;
      path([
        { x: c.at.x, y: c.at.y - r },
        { x: c.at.x + r, y: c.at.y },
        { x: c.at.x, y: c.at.y + r },
        { x: c.at.x - r, y: c.at.y },
      ], true);
      ctx.fill();
      ctx.stroke();
      label(`${c.degrees}°`, c.at.x + 22, c.at.y - 12, CORNER);
    }

    // Start and end.
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8cff6a';
    ctx.beginPath();
    ctx.arc(first.x, first.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    label('start', first.x, first.y - 20, '#8cff6a');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(end.x - 5, end.y - 5, 10, 10);
    if (Math.hypot(end.x - first.x, end.y - first.y) > 36) label('end', end.x, end.y + 20, '#ffffff');
  }, [size, target, last, report, live]);

  useEffect(() => paint(), [paint]);

  // While drawing: repaint every frame and read the stroke a few times a second, like the game.
  const paintRef = useRef(paint);
  paintRef.current = paint;
  const raf = useRef(0);
  const loop = useCallback(() => {
    let nextRead = 0;
    const tick = (now: number) => {
      const s = stroke.current;
      if (!s) return;
      if (now >= nextRead && s.points.length > 3) {
        nextRead = now + CLEAN_CAST.liveInterval * 1000;
        const r = recognize(s.points);
        setLive(r.kind ? { kind: r.kind, tier: castTier(r.kind, r.score) } : null);
      }
      paintRef.current();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const toLocal = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    audio.unlock();
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = { points: [toLocal(e)], pointer: e.pointerId };
    setLast(null);
    setLive(null);
    loop();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = stroke.current;
    if (!s || e.pointerId !== s.pointer) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of events.length > 0 ? events : [native]) {
      if (s.points.length >= GESTURE.maxPoints) break;
      const p = toLocal(ev);
      const prev = s.points[s.points.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) >= GESTURE.minPointSpacing) s.points.push(p);
    }
  };

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const s = stroke.current;
    if (!s || e.pointerId !== s.pointer) return;
    stroke.current = null;
    cancelAnimationFrame(raf.current);
    setLive(null);
    if (cancelled) {
      paintRef.current();
      return;
    }
    const raw = [...s.points, toLocal(e)];
    const analysis = analyzeStroke(raw);
    const attempt = reportAttempt(analysis, target);
    setLast({ raw, analysis });
    if (attempt.outcome !== 'tiny') {
      setHistory((h) => [...h.slice(-(HISTORY - 1)), { outcome: attempt.outcome, tier: attempt.tier }]);
      audio.play(attempt.outcome !== 'hit' ? 'unclear' : attempt.tier === 'perfect' ? 'perfect' : 'select');
    }
  };

  const hits = history.filter((h) => h.outcome === 'hit');
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i].outcome === 'hit'; i--) streak++;
  const a = last?.analysis ?? null;

  return (
    <div className="screen practice">
      <h2 className="screen-title">Sigil Practice</h2>
      <p className="screen-sub">Draw in the box. The recognizer shows what it read and why — nothing here costs a thing.</p>
      <div className="practice-targets" role="radiogroup" aria-label="Sigil to practise">
        <button role="radio" aria-checked={target === null} className={`practice-target${target === null ? ' on' : ''}`} onClick={() => setTarget(null)}>
          Any sigil
        </button>
        {SIGIL_KINDS.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={target === k}
            className={`practice-target${target === k ? ' on' : ''}`}
            data-kind={k}
            style={{ '--spell': SPELL_UI[SIGIL_TO_SPELL[k]].color } as CSSProperties}
            onClick={() => {
              setTarget(k);
              setLast(null);
              setHistory([]);
            }}
          >
            <SigilIcon spell={SIGIL_TO_SPELL[k]} size={24} />
            {SHAPE_NAMES[k]}
          </button>
        ))}
      </div>
      <div className="practice-grid">
        <div className="practice-pad" ref={padRef}>
          <canvas
            ref={canvasRef}
            className="practice-canvas"
            aria-label="Drawing pad: hold the left mouse button and draw a sigil"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
            onContextMenu={(e) => e.preventDefault()}
          />
          {!last && !stroke.current && <span className="practice-hint">{target ? `Draw a ${SHAPE_NAMES[target]} — start at the dot` : 'Hold the left mouse button and draw'}</span>}
          <div className="practice-legend" aria-hidden="true">
            <span className="lg-start">start</span>
            <span className="lg-end">end</span>
            <span className="lg-corner">sharp corner</span>
            <span className="lg-fit">shape found</span>
          </div>
        </div>
        <aside className="practice-panel">
          <div className={`practice-verdict ${report?.outcome ?? 'idle'}`} aria-live="polite">
            {report ? (
              <>
                <b className="verdict-head" style={{ color: report.outcome === 'hit' ? strokeColor(report.kind) : undefined }}>
                  {report.headline}
                </b>
                {report.outcome === 'hit' && report.tier && <span className={`tier-chip ${report.tier}`}>{report.tier}</span>}
                <span className="verdict-detail">{report.detail}</span>
              </>
            ) : live ? (
              <>
                <b className="verdict-head" style={{ color: strokeColor(live.kind) }}>
                  Reading: {SHAPE_NAMES[live.kind]}
                </b>
                <span className="verdict-detail">Release to see the full reading.</span>
              </>
            ) : (
              <>
                <b className="verdict-head">{target ? `Practise the ${SHAPE_NAMES[target]}` : 'Draw any sigil'}</b>
                <span className="verdict-detail">{target ? SHAPE_TIPS[target] : 'Each sigil below shows its score, or what it was missing.'}</span>
              </>
            )}
          </div>
          <ul className="practice-shapes">
            {SIGIL_KINDS.map((k) => {
              const spell = SIGIL_TO_SPELL[k];
              const check = a && a.recognition.reason !== 'tiny' ? a.checks[k] : null;
              const passed = check && !check.miss;
              const toBar = (v: number) => `${Math.max(0, Math.min(1, (v - 0.5) / 0.5)) * 100}%`;
              return (
                <li
                  key={k}
                  className={`shape-row${(report ? report.focus : target) === k ? ' focus' : ''}${check ? (passed ? ' passed' : ' missed') : ''}`}
                  data-kind={k}
                  style={{ '--spell': SPELL_UI[spell].color } as CSSProperties}
                >
                  <SigilIcon spell={spell} size={26} />
                  <span className="shape-name">{SHAPE_NAMES[k]}</span>
                  <span className="shape-bar" title="Score from 0.5 (just readable) to 1; ticks mark Clean and Perfect">
                    <i style={{ width: passed ? toBar(check.score) : '0%' }} />
                    <b className="tick" style={{ left: toBar(CLEAN_CAST.clean[k]) }} />
                    <b className="tick perfect" style={{ left: toBar(CLEAN_CAST.perfect[k]) }} />
                  </span>
                  <span className="shape-score">{!check ? '' : passed ? check.score.toFixed(2) : '✗'}</span>
                  <span className="shape-note">{!check ? SHAPE_TIPS[k] : passed ? castTier(k, check.score) : check.miss}</span>
                </li>
              );
            })}
          </ul>
          {a && a.recognition.features && (
            <details className="practice-measure">
              <summary>Measurements</summary>
              <dl>
                {measurements(a).map((m) => (
                  <div key={m.label} title={m.about}>
                    <dt>{m.label}</dt>
                    <dd>{m.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <div className="practice-history">
            <span className="history-chips" aria-label="Recent attempts">
              {history.map((h, i) => (
                <i key={i} className={h.outcome === 'hit' ? (h.tier ?? 'rough') : 'missed'} title={h.outcome === 'hit' ? h.tier ?? '' : 'missed'} />
              ))}
            </span>
            <span className="history-sum">
              {history.length === 0
                ? 'Recent attempts show here.'
                : `${hits.length} of ${history.length} cast${target ? ` as ${SHAPE_NAMES[target]}` : ''} · ${hits.filter((h) => h.tier === 'perfect').length} perfect · streak ${streak}`}
            </span>
          </div>
        </aside>
      </div>
      <div className="menu-buttons row">
        <button className="btn" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
        <button className="btn primary" onClick={onPlay}>
          Play
        </button>
      </div>
    </div>
  );
}
