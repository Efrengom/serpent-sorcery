import { EFFECTS, VIEW } from './config';
import { TAU } from './math';
import type { Floater, Particle, World } from './world';

/** Adds a particle, recycling the oldest one when the cap is reached. */
function push(world: World, p: Particle): void {
  if (world.particles.length >= EFFECTS.maxParticles) {
    world.particles[Math.floor(world.rng() * world.particles.length)] = p;
  } else {
    world.particles.push(p);
  }
}

export function burst(
  world: World,
  x: number,
  y: number,
  color: string,
  count: number,
  speed: number,
  opts: { size?: number; life?: number; kind?: Particle['kind']; drag?: number; dir?: number; spread?: number } = {},
): void {
  const rng = world.rng;
  for (let i = 0; i < count; i++) {
    const a = opts.dir !== undefined ? opts.dir + (rng() - 0.5) * (opts.spread ?? 1) : rng() * TAU;
    const s = speed * (0.35 + rng() * 0.65);
    const life = (opts.life ?? 0.5) * (0.6 + rng() * 0.6);
    push(world, {
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life,
      max: life,
      size: (opts.size ?? 3) * (0.6 + rng() * 0.8),
      color,
      drag: opts.drag ?? 3,
      kind: opts.kind ?? 'spark',
    });
  }
}

export function floater(
  world: World,
  x: number,
  y: number,
  text: string,
  color: string,
  opts: { size?: number; life?: number; screen?: boolean; vy?: number; damageNumber?: boolean } = {},
): void {
  const f: Floater = {
    x,
    y,
    text,
    color,
    life: opts.life ?? 0.9,
    max: opts.life ?? 0.9,
    size: opts.size ?? 16,
    vy: opts.vy ?? -40,
    screen: opts.screen ?? false,
  };
  if (opts.damageNumber) {
    let count = 0;
    for (const o of world.floaters) if (o.size <= 14 && !o.screen) count++;
    if (count >= EFFECTS.maxDamageNumbers) return;
  }
  if (world.floaters.length >= EFFECTS.maxFloaters) world.floaters.shift();
  world.floaters.push(f);
}

export function addShake(world: World, amount: number): void {
  world.shake = Math.min(1, world.shake + amount);
}

export function updateEffects(world: World, dt: number): void {
  const ps = world.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) {
      ps[i] = ps[ps.length - 1];
      ps.pop();
      continue;
    }
    const d = Math.exp(-p.drag * dt);
    p.vx *= d;
    p.vy *= d;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  const fs = world.floaters;
  for (let i = fs.length - 1; i >= 0; i--) {
    const f = fs[i];
    f.life -= dt;
    f.y += f.vy * dt;
    f.vy *= Math.exp(-2 * dt);
    if (f.life <= 0) fs.splice(i, 1);
  }
  for (let i = world.arcs.length - 1; i >= 0; i--) {
    world.arcs[i].life -= dt;
    if (world.arcs[i].life <= 0) world.arcs.splice(i, 1);
  }
  world.shake = Math.max(0, world.shake - dt * 2.6);
  world.hurtFlash = Math.max(0, world.hurtFlash - dt * 2.2);
  if (world.banner) {
    world.banner.t += dt;
    if (world.banner.t >= world.banner.max) world.banner = null;
  }
}

export function shakeOffset(world: World, time: number): { x: number; y: number } {
  const s = world.shake * world.shake * VIEW.maxShake;
  if (s < 0.05) return { x: 0, y: 0 };
  return { x: Math.sin(time * 91.3) * s, y: Math.cos(time * 77.7) * s };
}
