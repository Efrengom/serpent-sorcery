import { GESTURE } from './config';
import type { Pt } from './gesture';

export interface InputCallbacks {
  onEscape(): void;
  onToggleMute(): void;
  onToggleArt(): void;
  /** Return false to refuse the gesture (e.g. while paused). */
  onGestureStart(screen: Pt): boolean;
  onGestureEnd(points: Pt[]): void;
  onGestureCancel(): void;
  onFocusLost(): void;
  onResize(): void;
  onUserGesture(): void;
}

const MOVE_KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * Keyboard + pointer input. Keys are tracked as held state; the drawing gesture is
 * captured in CSS pixels relative to the canvas. Pointer-down is only accepted on the
 * canvas itself, so clicks on DOM interface elements never start a sigil.
 */
export class InputManager {
  private held = new Set<'up' | 'down' | 'left' | 'right'>();
  /** Keys pressed since the last simulation step, so a tap shorter than a frame still steers. */
  private tapped = new Set<'up' | 'down' | 'left' | 'right'>();
  private drawing = false;
  private pointerId = -1;
  points: Pt[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cb: InputCallbacks,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  /** WASD/arrow vector; opposite keys cancel out. (0,0) means keep heading. */
  direction(): { x: number; y: number } {
    const on = (d: 'up' | 'down' | 'left' | 'right') => this.held.has(d) || this.tapped.has(d);
    const x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    const y = (on('down') ? 1 : 0) - (on('up') ? 1 : 0);
    return { x, y };
  }

  /** Called after each simulation step; held keys keep applying, finished taps are dropped. */
  endStep(): void {
    this.tapped.clear();
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** Releases every held key and abandons any unfinished gesture. */
  clearAll(): void {
    this.held.clear();
    this.tapped.clear();
    this.cancelGesture();
  }

  cancelGesture(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.points = [];
    if (this.pointerId >= 0 && this.canvas.hasPointerCapture?.(this.pointerId)) {
      try {
        this.canvas.releasePointerCapture(this.pointerId);
      } catch {
        // Capture may already be gone; nothing to do.
      }
    }
    this.pointerId = -1;
    this.cb.onGestureCancel();
  }

  /** Converts a client coordinate to CSS pixels relative to the canvas. */
  toCanvas(clientX: number, clientY: number): Pt {
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? this.canvas.clientWidth / rect.width : 1;
    const sy = rect.height > 0 ? this.canvas.clientHeight / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.cb.onUserGesture();
    if (e.code === 'Escape') {
      if (!e.repeat) this.cb.onEscape();
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyM' && !e.repeat) {
      this.cb.onToggleMute();
      return;
    }
    if (e.code === 'KeyP' && !e.repeat) {
      this.cb.onToggleArt();
      return;
    }
    const dir = MOVE_KEYS[e.code];
    // Arrow keys on a focused form control (the volume sliders) adjust it instead of steering.
    const target = e.target as HTMLElement | null;
    if (dir && target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (dir) {
      // Repeats re-assert held state, so a key still down after a pause resumes steering.
      this.held.add(dir);
      this.tapped.add(dir);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const dir = MOVE_KEYS[e.code];
    if (dir) this.held.delete(dir);
  };

  private onBlur = () => {
    this.clearAll();
    this.cb.onFocusLost();
  };

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.onBlur();
  };

  private onResize = () => {
    this.clearAll();
    this.cb.onResize();
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent) => {
    this.cb.onUserGesture();
    if (e.button !== 0) return;
    if (this.drawing) this.cancelGesture();
    const p = this.toCanvas(e.clientX, e.clientY);
    if (!this.cb.onGestureStart(p)) return;
    e.preventDefault();
    this.drawing = true;
    this.pointerId = e.pointerId;
    this.points = [p];
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Not fatal: window-level move/up listeners still track the stroke.
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [e];
    for (const ev of list) {
      if (this.points.length >= GESTURE.maxPoints) break;
      const p = this.toCanvas(ev.clientX, ev.clientY);
      const last = this.points[this.points.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= GESTURE.minPointSpacing) this.points.push(p);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    const p = this.toCanvas(e.clientX, e.clientY);
    const last = this.points[this.points.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) this.points.push(p);
    const pts = this.points;
    this.drawing = false;
    this.points = [];
    this.pointerId = -1;
    this.cb.onGestureEnd(pts);
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.cancelGesture();
  };
}
