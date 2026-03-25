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

    /**
     * Find two tower positions on opposite sides of the island.
     * Creates a circular sand base (radius 5) around each one,
     * clearing all terrain features.
     * @returns {[{x,y},{x,y}]}
     */
    findTowerPositions() {
        const cx = this.width / 2, cy = this.height / 2;
        const off = Math.min(this.width, this.height) * 0.28;
        const p1 = this._findClearSpot(Math.round(cx - off), Math.round(cy - off), 3);
        const p2 = this._findClearSpot(Math.round(cx + off), Math.round(cy + off), 3);
        // Sand base circles
        this._createBase(Math.floor(p1.x), Math.floor(p1.y));
        this._createBase(Math.floor(p2.x), Math.floor(p2.y));
        // Clear terrain around each base (larger radius, grass not sand)
        this._clearAroundBase(Math.floor(p1.x), Math.floor(p1.y), 10);
        this._clearAroundBase(Math.floor(p2.x), Math.floor(p2.y), 10);
        // Carve a wide path between the two bases
        this._clearPath(p1, p2, 3);
        return [p1, p2];
    }

    /**
     * Pick a random spawn point inside a tower's sand base.
     * Checks that the full tank collision box is passable so the
     * tank can never spawn stuck against water or terrain.
     */
    getBaseSpawnPoint(towerX, towerY) {
        const s = CONFIG.TANK_SIZE * 0.85;          // collision half-extent
        const minR = CONFIG.TOWER_RADIUS + CONFIG.TANK_SIZE + 0.2; // avoid tower
        const maxR = 5 - s - 0.3;                  // stay inside sand circle

        for (let attempt = 0; attempt < 100; attempt++) {
            const a = Math.random() * Math.PI * 2;
            const r = minR + Math.random() * (maxR - minR);
            const x = towerX + Math.cos(a) * r;
            const y = towerY + Math.sin(a) * r;
            // Check all four corners of the tank's collision box
            if (this.isPassable(x - s, y - s) &&
                this.isPassable(x + s, y - s) &&
                this.isPassable(x - s, y + s) &&
                this.isPassable(x + s, y + s)) {
                return { x, y };
            }
        }
        return { x: towerX + 2, y: towerY + 2 };
    }

    /**
     * Remove hills/rocks in a large circle around a base, replacing
     * them with grass.  Keeps the area navigable for bots.
     */
    _clearAroundBase(gx, gy, r) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r * r) continue;
                const tx = gx + dx, ty = gy + dy;
                const t = this.getTile(tx, ty);
                if (t === T.HILL || t === T.ROCK) {
                    this.setTile(tx, ty, T.GRASS);
                }
            }
        }
    }

    /**
     * Carve a straight passable corridor of half-width `hw` tiles
     * between two points.  Removes hills/rocks → grass, and
     * converts water → sand so the path is always walkable.
     */
    _clearPath(p1, p2, hw) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) return;
        const px = -dy / len, py = dx / len;   // perpendicular

        const steps = Math.ceil(len * 2);       // oversample for no gaps
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const cx = p1.x + dx * t;
            const cy = p1.y + dy * t;
            for (let w = -hw; w <= hw; w++) {
                const gx = Math.floor(cx + px * w);
                const gy = Math.floor(cy + py * w);
                const tile = this.getTile(gx, gy);
                if (tile === T.HILL || tile === T.ROCK) {
                    this.setTile(gx, gy, T.GRASS);
                } else if (tile === T.DEEP_WATER || tile === T.SHALLOW_WATER) {
                    this.setTile(gx, gy, T.SAND);
                }
            }
        }
    }

    /** Search outward from (tx,ty) for a spot with `r` tiles of clear grass. */
    _findClearSpot(tx, ty, r) {
        for (let ring = 0; ring < 12; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const gx = tx + dx, gy = ty + dy;
                    if (this._areaPassable(gx, gy, r)) {
                        return { x: gx + 0.5, y: gy + 0.5 };
                    }
                }
            }
        }
        return { x: tx + 0.5, y: ty + 0.5 };
    }

    _areaPassable(gx, gy, r) {
        for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++)
                if (!this.isPassable(gx + dx + 0.5, gy + dy + 0.5)) return false;
        return true;
    }

    /**
     * Stamp a circular sand base around (gx, gy).
     * Radius 5: everything inside becomes sand, all terrain removed.
     */
    _createBase(gx, gy) {
        const R = 5;
        for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
                if (dx * dx + dy * dy > R * R) continue;   // circular
                const tx = gx + dx, ty = gy + dy;
                const t = this.getTile(tx, ty);
                // Only overwrite land tiles (not water)
                if (t === T.GRASS || t === T.DARK_GRASS ||
                    t === T.HILL  || t === T.ROCK || t === T.SAND) {
                    this.setTile(tx, ty, T.SAND);
                }
            }
        }
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
