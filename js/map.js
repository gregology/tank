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
        this.hp     = new Float32Array(this.width * this.height);
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
            let h = 0;
            switch (type) {
                case T.HILL:        h = CONFIG.HILL_HP; break;
                case T.ROCK:        h = CONFIG.ROCK_HP; break;
                case T.BLDG_SMALL:  h = CONFIG.BLDG_SMALL_HP; break;
                case T.BLDG_MEDIUM: h = CONFIG.BLDG_MEDIUM_HP; break;
                case T.BLDG_LARGE:  h = CONFIG.BLDG_LARGE_HP; break;
            }
            this.hp[i]    = h;
            this.maxHp[i] = h;
        }
    }

    /** Is this tile type a solid obstacle (hill, rock, or building)? */
    isSolid(tileType) {
        return tileType === T.HILL || tileType === T.ROCK
            || tileType === T.BLDG_SMALL || tileType === T.BLDG_MEDIUM
            || tileType === T.BLDG_LARGE;
    }

    /** Can a tank stand at continuous world position (wx, wy)? */
    isPassable(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return t === T.GRASS || t === T.DARK_GRASS || t === T.SAND
            || t === T.DIRT || t === T.PAVED;
    }

    /** Is this a road tile? Buildings must not be placed on roads. */
    isRoad(gx, gy) {
        const t = this.getTile(gx, gy);
        return t === T.DIRT || t === T.PAVED;
    }

    /** Does this tile stop a bullet? */
    blocksProjectile(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return t === T.HILL || t === T.ROCK
            || t === T.BLDG_SMALL || t === T.BLDG_MEDIUM || t === T.BLDG_LARGE;
    }

    /**
     * Apply one hit of damage to the tile at (gx, gy).
     * @returns {boolean} true if the tile was destroyed.
     */
    damageTile(gx, gy, damage = 1.0) {
        const i = gy * this.width + gx;
        if (this.hp[i] <= 0) return false;        // not destructible
        this.hp[i] -= damage;
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
        switch (tileType) {
            case T.HILL:        return CONFIG.TILE_DEPTH;
            case T.ROCK:        return Math.round(CONFIG.TILE_DEPTH * 0.6);
            case T.BLDG_SMALL:  return 14;
            case T.BLDG_MEDIUM: return 22;
            case T.BLDG_LARGE:  return 32;
            default:            return 0;
        }
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
                if (this.isSolid(t)) {
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
                if (this.isSolid(tile)) {
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
                if (t !== T.DEEP_WATER && t !== T.SHALLOW_WATER) {
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

        // Pass 1: lay down water / sand / grass
        for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
                this.setTile(gx, gy, this._baseTile(gx, gy, cx, cy, maxR));
            }
        }

        // Pass 2: scatter village clusters across the island
        this._placeVillages(cx, cy, maxR);
    }

    /** Water / sand / grass only — no structures. */
    _baseTile(gx, gy, cx, cy, maxR) {
        const d = distance(gx, gy, cx, cy);
        const coastNoise = this._fbm(gx * 0.06, gy * 0.06, 3, 0) - 0.5;
        const islandEdge = maxR + coastNoise * 8;

        if (d > islandEdge)           return T.DEEP_WATER;
        if (d > islandEdge - 1.8)     return T.SHALLOW_WATER;
        if (d > islandEdge - 3.5)     return T.SAND;

        const grassN = this._fbm(gx * 0.12, gy * 0.12, 2, 300);
        return grassN > 0.52 ? T.DARK_GRASS : T.GRASS;
    }

    /* ── Village placement ────────────────────────────────── */

    /**
     * Place village clusters (min 14 tiles apart), connect with dirt
     * roads, then scatter roadside buildings along the connecting roads.
     */
    _placeVillages(cx, cy, maxR) {
        const MIN_VILLAGE_DIST = 14;
        const villageCentres = [];
        const attempts = 20 + Math.floor(this._hash(77, 88) * 10);

        // Step 1: pick village positions, enforcing minimum separation
        for (let i = 0; i < attempts; i++) {
            const angle = this._hash(i * 11, 100) * Math.PI * 2;
            const dist  = 5 + this._hash(i * 17, 200) * (maxR - 12);
            const vx = Math.round(cx + Math.cos(angle) * dist);
            const vy = Math.round(cy + Math.sin(angle) * dist);

            if (!this.isPassable(vx + 0.5, vy + 0.5)) continue;
            if (distance(vx, vy, cx, cy) > maxR - 6) continue;

            // Enforce minimum distance from every existing village
            let tooClose = false;
            for (const vc of villageCentres) {
                if (distance(vx, vy, vc.x, vc.y) < MIN_VILLAGE_DIST) {
                    tooClose = true; break;
                }
            }
            if (tooClose) continue;

            this._stampVillage(vx, vy, i);
            villageCentres.push({ x: vx, y: vy });
        }

        // Step 2: connect villages with dirt roads (nearest-neighbour chain)
        if (villageCentres.length < 2) return;
        const connected = [0];
        const remaining = new Set(villageCentres.keys());
        remaining.delete(0);

        const roadSegments = [];
        while (remaining.size > 0) {
            let bestI = -1, bestJ = -1, bestD = Infinity;
            for (const ci of connected) {
                for (const ri of remaining) {
                    const d = distance(villageCentres[ci].x, villageCentres[ci].y,
                                       villageCentres[ri].x, villageCentres[ri].y);
                    if (d < bestD) { bestD = d; bestI = ci; bestJ = ri; }
                }
            }
            if (bestJ < 0) break;
            const a = villageCentres[bestI], b = villageCentres[bestJ];
            this._layDirtRoad(a, b);
            roadSegments.push({ a, b });
            connected.push(bestJ);
            remaining.delete(bestJ);
        }

        // Step 3: scatter a few buildings along the dirt roads between villages
        for (let seg = 0; seg < roadSegments.length; seg++) {
            this._scatterRoadsideBuildings(roadSegments[seg].a,
                roadSegments[seg].b, seg);
        }
    }

    /**
     * Lay a 1-tile-wide dirt road between two points using only
     * cardinal steps (up/down/left/right).  Every tile shares a
     * full edge with the next — no diagonal-only connections.
     */
    _layDirtRoad(a, b) {
        let x = Math.floor(a.x), y = Math.floor(a.y);
        const gx = Math.floor(b.x), gy = Math.floor(b.y);

        while (x !== gx || y !== gy) {
            const tile = this.getTile(x, y);
            if (tile === T.GRASS || tile === T.DARK_GRASS) {
                this.setTile(x, y, T.DIRT);
            }
            // Step one tile: pick the axis with the larger remaining gap.
            // When equal, use a hash for a natural wobble instead of
            // always favouring the same axis.
            const dx = gx - x, dy = gy - y;
            if (Math.abs(dx) > Math.abs(dy)) {
                x += dx > 0 ? 1 : -1;
            } else if (Math.abs(dy) > Math.abs(dx)) {
                y += dy > 0 ? 1 : -1;
            } else {
                // Equal — random pick for variety
                if (this._hash(x * 31 + y * 47, 1050) > 0.5)
                    x += dx > 0 ? 1 : -1;
                else
                    y += dy > 0 ? 1 : -1;
            }
        }
        // Final tile
        const tile = this.getTile(x, y);
        if (tile === T.GRASS || tile === T.DARK_GRASS) {
            this.setTile(x, y, T.DIRT);
        }
    }

    /**
     * Scatter a few isolated buildings alongside a dirt road between
     * two villages.  Gives the roads a lived-in feel without creating
     * a full village.
     */
    _scatterRoadsideBuildings(a, b, seed) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 8) return;  // too short, skip

        const ux = dx / len, uy = dy / len;     // road direction
        const px = -uy, py = ux;                 // perpendicular

        const count = 2 + Math.floor(this._hash(seed * 67, 1100) * 4);
        for (let i = 0; i < count; i++) {
            // Position along the road (skip first/last 20% to stay away from villages)
            const t = 0.2 + this._hash(seed * 13 + i * 47, 1200) * 0.6;
            const cx = a.x + dx * t;
            const cy = a.y + dy * t;

            // Offset 1–2 tiles to one side
            const side = this._hash(seed * 19 + i * 31, 1300) > 0.5 ? 1 : -1;
            const off  = 1 + Math.floor(this._hash(seed * 23 + i * 37, 1400) * 1.5);
            const bx = Math.round(cx + px * side * off);
            const by = Math.round(cy + py * side * off);

            if (this.isRoad(bx, by)) continue;
            if (!this.isPassable(bx + 0.5, by + 0.5)) continue;

            // Roadside buildings are mostly small
            const sizeRoll = this._hash(seed * 29 + i * 41, 1500);
            const bldgType = sizeRoll < 0.6 ? T.BLDG_SMALL : T.BLDG_MEDIUM;
            this.setTile(bx, by, bldgType);
        }
    }

    /**
     * Stamp a single village at (vx, vy).
     *
     * 1. Lay 1–2 paved roads through the village
     * 2. Place buildings along both sides — NEVER on a road tile
     */
    _stampVillage(vx, vy, seed) {
        const roadCount = this._hash(seed * 31, 400) > 0.4 ? 2 : 1;

        const roads = [];
        for (let r = 0; r < roadCount; r++) {
            const dirRoll = this._hash(seed * 11 + r * 71, 410);
            let dx, dy;
            if (r === 0) {
                dx = dirRoll < 0.5 ? 1 : 0;
                dy = dx === 0 ? 1 : 0;
            } else {
                dx = roads[0].dy !== 0 ? 1 : 0;
                dy = dx === 0 ? 1 : 0;
            }
            const halfLen = 3 + Math.floor(this._hash(seed * 17 + r * 43, 420) * 4);
            roads.push({ dx, dy, halfLen });
        }

        // Step 1: lay PAVED roads
        for (const road of roads) {
            for (let s = -road.halfLen; s <= road.halfLen; s++) {
                const rx = vx + road.dx * s;
                const ry = vy + road.dy * s;
                if (this.isPassable(rx + 0.5, ry + 0.5)) {
                    this.setTile(rx, ry, T.PAVED);
                }
            }
        }

        // Step 2: place buildings along roads (never ON a road)
        for (const road of roads) {
            const px = road.dy !== 0 ? 1 : 0;   // perpendicular
            const py = road.dx !== 0 ? 1 : 0;

            for (let s = -road.halfLen; s <= road.halfLen; s++) {
                const rx = vx + road.dx * s;
                const ry = vy + road.dy * s;

                for (const side of [-1, 1]) {
                    const skip = this._hash(seed * 7 + s * 13 + side * 37, 500 + side);
                    if (skip < 0.45) continue;

                    const offset = 1 + Math.floor(this._hash(seed * 3 + s * 19 + side * 41, 550) * 1.5);
                    const bx = rx + px * side * offset;
                    const by = ry + py * side * offset;

                    // NEVER place on a road tile
                    if (this.isRoad(bx, by)) continue;
                    if (!this.isPassable(bx + 0.5, by + 0.5)) continue;

                    const sizeRoll = this._hash(seed * 23 + s * 37 + side * 53, 600);
                    let bldgType;
                    if      (sizeRoll < 0.45) bldgType = T.BLDG_SMALL;
                    else if (sizeRoll < 0.80) bldgType = T.BLDG_MEDIUM;
                    else                      bldgType = T.BLDG_LARGE;

                    this.setTile(bx, by, bldgType);

                    // Large buildings extend along the road
                    if (bldgType === T.BLDG_LARGE) {
                        const ex = bx + road.dx, ey = by + road.dy;
                        if (!this.isRoad(ex, ey) && this.isPassable(ex + 0.5, ey + 0.5))
                            this.setTile(ex, ey, T.BLDG_LARGE);
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
