/* Deterministic pseudo-random utilities.
   Seeding by ticker (and sometimes date) makes the synthesised dataset stable
   across reloads and internally consistent — the same request always yields the
   same numbers, which is what separates a credible mock from noise. */

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: string) {
    this.next = mulberry32(hashString(seed));
  }
  /** uniform [0,1) */
  u(): number {
    return this.next();
  }
  /** uniform in [min,max] */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  /** approx standard normal via sum of uniforms (Irwin–Hall) */
  normal(mean = 0, sd = 1): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return mean + (s - 3) / 1.732 * sd;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
