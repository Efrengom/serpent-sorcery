/**
 * Deterministic hash of integer coordinates to [0, 1). Floors are painted in chunks, so every
 * random detail is keyed by its world position (not drawn from a running generator) and comes
 * out the same whichever chunk paints it: no seams.
 */
export function hash2(a: number, b: number, salt = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(salt | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
