/**
 * Rebindable keys. Every action has two slots holding `KeyboardEvent.code` values (physical keys,
 * so the layout of letters doesn't matter). Escape is reserved: it always pauses and backs out of
 * menus, so it fills the pause action's first slot and can't be bound to anything else.
 */

export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'ultimate' | 'pause' | 'mute';
export const KEY_ACTIONS: KeyAction[] = ['up', 'down', 'left', 'right', 'ultimate', 'pause', 'mute'];
export const MOVE_ACTIONS = ['up', 'down', 'left', 'right'] as const;
export type MoveAction = (typeof MOVE_ACTIONS)[number];

export const KEY_ACTION_NAMES: Record<KeyAction, string> = {
  up: 'Steer up',
  down: 'Steer down',
  left: 'Steer left',
  right: 'Steer right',
  ultimate: 'Cast ultimate',
  pause: 'Pause',
  mute: 'Mute sound',
};

/** Two keys per action; null is an empty slot. */
export type KeyBindings = Record<KeyAction, [string | null, string | null]>;

export const RESERVED_KEY = 'Escape';

export const DEFAULT_BINDINGS: KeyBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  ultimate: ['Space', 'KeyQ'],
  pause: [RESERVED_KEY, null],
  mute: ['KeyM', null],
};

export function copyBindings(b: KeyBindings): KeyBindings {
  const out = {} as KeyBindings;
  for (const a of KEY_ACTIONS) out[a] = [b[a][0], b[a][1]];
  return out;
}

/** The pause action's first slot always holds Escape. */
export function isLockedSlot(action: KeyAction, slot: 0 | 1): boolean {
  return action === 'pause' && slot === 0;
}

/** Looks up which action a key code triggers. */
export function bindingMap(b: KeyBindings): Map<string, KeyAction> {
  const map = new Map<string, KeyAction>();
  for (const a of KEY_ACTIONS) {
    for (const code of b[a]) if (code && !map.has(code)) map.set(code, a);
  }
  return map;
}

export interface BindOutcome {
  bindings: KeyBindings;
  /** The action the key was taken from, when it was already in use elsewhere. */
  movedFrom: KeyAction | null;
}

/**
 * Puts `code` in one slot. A key does one thing, so if it was bound elsewhere it moves here and
 * the old slot is left empty. Returns null for Escape or the locked pause slot.
 */
export function bindKey(b: KeyBindings, action: KeyAction, slot: 0 | 1, code: string): BindOutcome | null {
  if (code === RESERVED_KEY || isLockedSlot(action, slot) || !validCode(code)) return null;
  const next = copyBindings(b);
  let movedFrom: KeyAction | null = null;
  for (const a of KEY_ACTIONS) {
    for (const s of [0, 1] as const) {
      if (next[a][s] === code && !(a === action && s === slot)) {
        next[a][s] = null;
        if (a !== action) movedFrom = a;
      }
    }
  }
  next[action][slot] = code;
  return { bindings: next, movedFrom };
}

export function clearKey(b: KeyBindings, action: KeyAction, slot: 0 | 1): KeyBindings {
  if (isLockedSlot(action, slot)) return b;
  const next = copyBindings(b);
  next[action][slot] = null;
  return next;
}

/** Steering directions left without any key. */
export function unboundMoves(b: KeyBindings): MoveAction[] {
  return MOVE_ACTIONS.filter((a) => !b[a][0] && !b[a][1]);
}

function validCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(v);
}

/**
 * Validates saved bindings slot by slot. Missing actions get their defaults unless those keys
 * are already taken; duplicates keep their first use; Escape stays in the pause slot only.
 */
export function sanitizeBindings(input: unknown): KeyBindings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return copyBindings(DEFAULT_BINDINGS);
  const o = input as Record<string, unknown>;
  const out = {} as KeyBindings;
  const used = new Set<string>([RESERVED_KEY]);
  const missing: KeyAction[] = [];
  for (const a of KEY_ACTIONS) {
    const v = o[a];
    if (!Array.isArray(v)) {
      missing.push(a);
      out[a] = [null, null];
      continue;
    }
    out[a] = [null, null];
    for (const s of [0, 1] as const) {
      if (isLockedSlot(a, s)) continue;
      const code = v[s];
      if (validCode(code) && !used.has(code)) {
        out[a][s] = code;
        used.add(code);
      }
    }
  }
  for (const a of missing) {
    for (const s of [0, 1] as const) {
      const code = DEFAULT_BINDINGS[a][s];
      if (code && !isLockedSlot(a, s) && !used.has(code)) {
        out[a][s] = code;
        used.add(code);
      }
    }
  }
  out.pause[0] = RESERVED_KEY;
  return out;
}

const NAMED: Record<string, string> = {
  Escape: 'Esc',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Meta',
  MetaRight: 'R Meta',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
  PageUp: 'Pg Up',
  PageDown: 'Pg Down',
  Insert: 'Ins',
  Delete: 'Del',
};

/** A short label for a key code: KeyW → W, ArrowUp → ↑, Numpad8 → Num 8. */
export function keyLabel(code: string | null): string {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** Label of an action's first bound key, for hints like "Pause (Esc)". */
export function primaryKeyLabel(b: KeyBindings, action: KeyAction): string {
  return keyLabel(b[action][0] ?? b[action][1]);
}
