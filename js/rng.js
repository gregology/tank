/**
 * Deterministic randomness for the whole game.
 *
 * One match = one seed.  `Game` owns a master mulberry32 stream for
 * shared rolls (spawn jitter, vehicle picks, cosmetic timers) and derives
 * independent per-bot streams via `deriveSeed`, so one bot's consumption
 * can never shift another bot's decisions.  Given the same seed and the
 * same settings, a match is bit-for-bit reproducible — the foundation the
 * headless simulator and the tuning sweeps build on.
 */

/** mulberry32 PRNG: tiny, fast, good enough for gameplay simulation. */
export function mulberry32(seed) {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Derive an independent stream seed from a master seed and a numeric salt
 * (e.g. a tank's playerNumber).  Keeping streams separate means adding a
 * roll to one consumer never perturbs the others.
 */
export function deriveSeed(seed, salt) {
    return (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 0x85ebca6b, 0xc2b2ae35)) | 0;
}
