/**
 * Tile-based island map with noise-driven procedural generation.
 *
 * Each game gets a unique island.  The coastline, hill placement, and
 * rock cover are all derived from layered value-noise so the result
 * feels organic.
 *
 * Hills are **traversable** (they slow tanks down but don't block them).
 * Rocks block both movement and projectiles – they're the cover.
 */

import { CONFIG, TILES as T } from './config.js';
import { distance, randomInt } from './utils.js';

export class GameMap {
    constructor() {
        this.width  = CONFIG.MAP_WIDTH;
        this.height = CONFIG.MAP_HEIGHT;
        /** Flat Uint8 array – index with `y * width + x`. */
        this.tiles  = new Uint8Array(this.width * this.height);
        /** Per-tile hit-points (0 = full health / not destructible). */
        this.hp     = new Uint8Array(this.width * this.height);
        /** Max HP per tile (for damage fraction calculation). */
        this.maxHp  = new Uint8Array(this.width * this.height);
        /** Seed for the noise functions (new island every game). */
        this.seed   = Math.floor(Math.random() * 2147483647);
        this.generate();
    }

    /* ═══════════════════════════════════════════════════════ *
     *  Public helpers                                         *
     * ═══════════════════════════════════════════════════════ */

    getTile(gx, gy) {
        if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return T.DEEP_WATER;
        return this.tiles[gy * this.width + gx];
    }

    setTile(gx, gy, type) {
        if (gx >= 0 && gx < this.width && gy >= 0 && gy < this.height) {
            const i = gy * this.width + gx;
            this.tiles[i] = type;
            // Initialise HP for destructible tiles
            const h = type === T.HILL ? CONFIG.HILL_HP
                    : type === T.ROCK ? CONFIG.ROCK_HP : 0;
            this.hp[i]    = h;
            this.maxHp[i] = h;
        }
    }

    /** Can a tank stand at continuous world position (wx, wy)? */
    isPassable(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return t === T.GRASS || t === T.DARK_GRASS || t === T.SAND;
    }

    /** Does this tile stop a bullet? (hills and rocks) */
    blocksProjectile(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return t === T.HILL || t === T.ROCK;
    }

    /**
     * Apply one hit of damage to the tile at (gx, gy).
     * @returns {boolean} true if the tile was destroyed.
     */
    damageTile(gx, gy) {
        const i = gy * this.width + gx;
        if (this.hp[i] <= 0) return false;        // not destructible
        this.hp[i]--;
        if (this.hp[i] <= 0) {
            // Destroyed → replace with grass
            this.tiles[i] = T.GRASS;
            this.hp[i]    = 0;
            this.maxHp[i] = 0;
            return true;
        }
        return false;
    }

    /** Fraction of HP remaining (1 = full, 0 = about to break). */
    getDamageFraction(gx, gy) {
        const i = gy * this.width + gx;
        if (this.maxHp[i] === 0) return 1;
        return this.hp[i] / this.maxHp[i];
    }

    /** Pixel-height of a tile type (for isometric elevation). */
    tileHeight(tileType) {
        if (tileType === T.HILL) return CONFIG.TILE_DEPTH;
        if (tileType === T.ROCK) return Math.round(CONFIG.TILE_DEPTH * 0.6);
        return 0;
    }

    /** Find a random passable spawn point, far from (ax, ay). */
    getSpawnPoint(ax, ay, minDist = 10) {
        for (let attempt = 0; attempt < 300; attempt++) {
            const x = randomInt(6, this.width  - 7) + 0.5;
            const y = randomInt(6, this.height - 7) + 0.5;
            const t = this.getTile(Math.floor(x), Math.floor(y));
            // Prefer flat ground for spawning
            if (t !== T.GRASS && t !== T.DARK_GRASS) continue;
            if (ax !== undefined && distance(x, y, ax, ay) < minDist) continue;
            return { x, y };
        }
        return { x: this.width / 2, y: this.height / 2 };
    }

    /* ═══════════════════════════════════════════════════════ *
     *  Procedural generation                                  *
     * ═══════════════════════════════════════════════════════ */

    generate() {
        const w = this.width, h = this.height;
        const cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) / 2 - 1;

        for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
                const tile = this._tileAt(gx, gy, cx, cy, maxR);
                this.setTile(gx, gy, tile);
            }
        }

        // Guarantee a few open clearings so players aren't boxed in.
        this._carveClearings(cx, cy, maxR);
    }

    /** Decide the tile type for a single grid cell. */
    _tileAt(gx, gy, cx, cy, maxR) {
        const d = distance(gx, gy, cx, cy);

        // ── Island mask (distance + noise wobble) ──
        const coastNoise = this._fbm(gx * 0.06, gy * 0.06, 3, /* offset */ 0) - 0.5;
        const islandEdge = maxR + coastNoise * 8;

        if (d > islandEdge)           return T.DEEP_WATER;
        if (d > islandEdge - 1.8)     return T.SHALLOW_WATER;
        if (d > islandEdge - 3.5)     return T.SAND;

        // ── Interior (grass / hills / rocks) ──
        const interiorDist = islandEdge - d;     // how far inside the island

        // Hill noise – broad, rolling
        const hillN = this._fbm(gx * 0.07, gy * 0.07, 4, /* offset */ 100);
        if (interiorDist > 3 && hillN > 0.58)    return T.HILL;

        // Rock noise – tighter, sparser
        const rockN = this._fbm(gx * 0.14, gy * 0.14, 3, /* offset */ 200);
        if (interiorDist > 2.5 && rockN > 0.68)  return T.ROCK;

        // Grass variation
        const grassN = this._fbm(gx * 0.12, gy * 0.12, 2, /* offset */ 300);
        return grassN > 0.52 ? T.DARK_GRASS : T.GRASS;
    }

    /** Carve a few circular clearings of flat grass. */
    _carveClearings(cx, cy, maxR) {
        const count = 5 + Math.floor(this._hash(42, 99) * 4);
        for (let i = 0; i < count; i++) {
            const angle = this._hash(i * 7, 1234) * Math.PI * 2;
            const dist  = 4 + this._hash(i * 13, 5678) * (maxR - 10);
            const r     = 2 + this._hash(i * 19, 9012) * 2.5;
            const ox = Math.round(cx + Math.cos(angle) * dist);
            const oy = Math.round(cy + Math.sin(angle) * dist);
            for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
                for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
                    if (dx * dx + dy * dy > r * r) continue;
                    const t = this.getTile(ox + dx, oy + dy);
                    if (t === T.HILL || t === T.ROCK) {
                        this.setTile(ox + dx, oy + dy, T.GRASS);
                    }
                }
            }
        }
    }

    /* ═══════════════════════════════════════════════════════ *
     *  Noise primitives                                       *
     * ═══════════════════════════════════════════════════════ */

    /** Integer hash → [0, 1). Deterministic for a given seed + position. */
    _hash(x, y) {
        let h = (x * 374761393 + y * 668265263 + this.seed) | 0;
        h = ((h ^ (h >>> 13)) * 1274126177) | 0;
        h = (h ^ (h >>> 16)) | 0;
        return (h & 0x7fffffff) / 0x7fffffff;
    }

    /** Smooth value noise via bilinear interpolation + smoothstep. */
    _noise(x, y, off) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v00 = this._hash(ix     + off, iy);
        const v10 = this._hash(ix + 1 + off, iy);
        const v01 = this._hash(ix     + off, iy + 1);
        const v11 = this._hash(ix + 1 + off, iy + 1);
        const top = v00 + (v10 - v00) * sx;
        const bot = v01 + (v11 - v01) * sx;
        return top + (bot - top) * sy;
    }

    /** Fractal Brownian Motion – layered noise for natural textures. */
    _fbm(x, y, octaves, off) {
        let value = 0, amp = 1, freq = 1, total = 0;
        for (let i = 0; i < octaves; i++) {
            value += this._noise(x * freq, y * freq, off + i * 997) * amp;
            total += amp;
            amp   *= 0.5;
            freq  *= 2;
        }
        return value / total;
    }
}
