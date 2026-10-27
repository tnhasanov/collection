/** Deterministic PRNG (mulberry32) so the synthetic dataset is reproducible. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    money: (min: number, max: number, step = 1) => {
      const v = min + Math.floor((next() * (max - min)) / step) * step;
      return v.toFixed(2);
    },
    float: (min: number, max: number, digits = 3) => Number((min + next() * (max - min)).toFixed(digits)),
  };
}
export type Rng = ReturnType<typeof createRng>;
