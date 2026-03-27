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

import { CONFIG, TILES as T, VEHICLES } from "./config.js";
import { distance, randomInt } from "./utils.js";

export class GameMap {
    /**
     * @param {number} [width]           map width (defaults to CONFIG.MAP_WIDTH)
     * @param {number} [height]          map height (defaults to CONFIG.MAP_HEIGHT)
     * @param {number} [villageDensity]  multiplier for village generation (default 1.0)
     */
    constructor(width, height, villageDensity) {
        this.width = width ?? CONFIG.MAP_WIDTH;
        this.height = height ?? CONFIG.MAP_HEIGHT;
        /** Village density multiplier (0.5 = sparse, 1.0 = normal, 1.5 = dense). */
        this.villageDensity = villageDensity ?? 1.0;
        /** Flat Uint8 array – index with `y * width + x`. */
        this.tiles = new Uint8Array(this.width * this.height);
        /** Per-tile hit-points (0 = full health / not destructible). */
        this.hp = new Float32Array(this.width * this.height);
        /** Max HP per tile (for damage fraction calculation). */
        this.maxHp = new Uint8Array(this.width * this.height);
        /** Seed for the noise functions (new island every game). */
        this.seed = Math.floor(Math.random() * 2147483647);
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
                case T.HILL:
                    h = CONFIG.HILL_HP;
                    break;
                case T.ROCK:
                    h = CONFIG.ROCK_HP;
                    break;
                case T.BLDG_SMALL:
                    h = CONFIG.BLDG_SMALL_HP;
                    break;
                case T.BLDG_MEDIUM:
                    h = CONFIG.BLDG_MEDIUM_HP;
                    break;
                case T.BLDG_LARGE:
                    h = CONFIG.BLDG_LARGE_HP;
                    break;
            }
            this.hp[i] = h;
            this.maxHp[i] = h;
        }
    }

    /** Is this tile type a solid obstacle (hill, rock, building, or base structure)? */
    isSolid(tileType) {
        return (
            tileType === T.HILL ||
            tileType === T.ROCK ||
            tileType === T.BLDG_SMALL ||
            tileType === T.BLDG_MEDIUM ||
            tileType === T.BLDG_LARGE ||
            tileType === T.BASE_STRUCTURE
        );
    }

    /** Can a tank stand at continuous world position (wx, wy)? */
    isPassable(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return t === T.GRASS || t === T.DARK_GRASS || t === T.SAND || t === T.DIRT || t === T.PAVED;
    }

    /** Is this a road tile? Buildings must not be placed on roads. */
    isRoad(gx, gy) {
        const t = this.getTile(gx, gy);
        return t === T.DIRT || t === T.PAVED;
    }

    /** Does this tile stop a bullet? */
    blocksProjectile(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return (
            t === T.HILL ||
            t === T.ROCK ||
            t === T.BLDG_SMALL ||
            t === T.BLDG_MEDIUM ||
            t === T.BLDG_LARGE ||
            t === T.BASE_STRUCTURE
        );
    }

    /**
     * Count projectile-blocking tiles within a radius of a world position.
     * Used by AI to evaluate how much cover a position offers.
     *
     * @param {number} wx  world X
     * @param {number} wy  world Y
     * @param {number} radius  search radius in tiles (default 3)
     * @returns {number}  count of blocking tiles in the area
     */
    countCoverTiles(wx, wy, radius = 3) {
        const gx = Math.floor(wx);
        const gy = Math.floor(wy);
        const r = Math.ceil(radius);
        let count = 0;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                if (this.blocksProjectile(gx + dx + 0.5, gy + dy + 0.5)) count++;
            }
        }
        return count;
    }

    /**
     * Apply one hit of damage to the tile at (gx, gy).
     * @returns {boolean} true if the tile was destroyed.
     */
    damageTile(gx, gy, damage = 1.0) {
        const i = gy * this.width + gx;
        if (this.hp[i] <= 0) return false; // not destructible
        this.hp[i] -= damage;
        if (this.hp[i] <= 0) {
            // Destroyed → replace with grass
            this.tiles[i] = T.GRASS;
            this.hp[i] = 0;
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
            case T.HILL:
                return CONFIG.TILE_DEPTH;
            case T.ROCK:
                return Math.round(CONFIG.TILE_DEPTH * 0.6);
            case T.BLDG_SMALL:
                return 14;
            case T.BLDG_MEDIUM:
                return 22;
            case T.BLDG_LARGE:
                return 32;
            case T.BASE_STRUCTURE:
                return 0; // entity renders the 3D height
            default:
                return 0;
        }
    }

    /**
     * Build two base compounds on opposite sides of the island.
     *
     * Each compound is 10×10 tiles with walls around the perimeter,
     * a 2-tile entrance gap facing the enemy, watch towers flanking
     * the gap, and a 1×2 HQ tent in the centre.
     *
     * @returns {[CompoundLayout, CompoundLayout]}  layout data for
     *          game.js to create entity objects from.
     */
    /**
     * @param {string} [baseType='compound']  'compound' = walls+towers+HQ,
     *                                        'hq_only'  = just HQ building
     */
    buildBaseCompounds(baseType) {
        const cx = this.width / 2,
            cy = this.height / 2;
        const maxR = Math.min(this.width, this.height) / 2 - 1;
        const compoundR = 7; // half-extent needed for 10x10 compound + buffer

        // Scale spatial parameters from island radius
        const clearR = Math.round(maxR * 0.25); // clear terrain radius around base
        const pathHW = Math.max(3, Math.round(maxR * 0.06)); // path half-width

        // Place bases by searching inward from the coast on opposite sides.
        // This adapts automatically to any map size or island shape.
        const baseAngle = Math.PI * 1.25; // SW → NE diagonal
        const p1 = this._findCoastalSpot(cx, cy, maxR, baseAngle, compoundR);
        const p2 = this._findCoastalSpot(cx, cy, maxR, baseAngle + Math.PI, compoundR);

        // Clear large areas (remove hills, rocks, buildings)
        this._clearAroundBase(Math.floor(p1.x), Math.floor(p1.y), clearR);
        this._clearAroundBase(Math.floor(p2.x), Math.floor(p2.y), clearR);

        // Determine entrance directions (face each other)
        const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const angle2 = Math.atan2(p1.y - p2.y, p1.x - p2.x);
        const dir1 = this._angleToCardinal(angle1);
        const dir2 = this._angleToCardinal(angle2);

        // Stamp compounds onto the map
        const layout1 = this._stampCompound(Math.floor(p1.x), Math.floor(p1.y), dir1, baseType);
        const layout2 = this._stampCompound(Math.floor(p2.x), Math.floor(p2.y), dir2, baseType);

        // Carve a wide path between the two bases
        this._clearPath(p1, p2, pathHW);

        // Connect each compound entrance to the road network
        this._connectCompoundToRoad(layout1);
        this._connectCompoundToRoad(layout2);

        return [layout1, layout2];
    }

    /**
     * Search inward from the coast along `angle` to find a spot with
     * enough dry land for a compound.  Only rejects water tiles — hills
     * and buildings are ignored because _clearAroundBase removes them.
     *
     * Works for any map size because it walks from the actual island
     * edge rather than using a fixed offset from the centre.
     */
    _findCoastalSpot(cx, cy, maxR, angle, clearRadius) {
        const inset = clearRadius + 5; // stay inside the coast
        for (let r = maxR - inset; r > clearRadius + 5; r -= 1) {
            const gx = Math.round(cx + Math.cos(angle) * r);
            const gy = Math.round(cy + Math.sin(angle) * r);
            if (gx < clearRadius || gx >= this.width - clearRadius) continue;
            if (gy < clearRadius || gy >= this.height - clearRadius) continue;
            if (this._areaOnLand(gx, gy, clearRadius)) {
                return { x: gx + 0.5, y: gy + 0.5 };
            }
        }
        // Fallback: search outward from a safe interior position
        return this._findClearSpot(
            Math.round(cx + Math.cos(angle) * maxR * 0.4),
            Math.round(cy + Math.sin(angle) * maxR * 0.4),
            clearRadius,
        );
    }

    /** True if every tile in a square of radius `r` is on land (not water). */
    _areaOnLand(gx, gy, r) {
        for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
                const t = this.getTile(gx + dx, gy + dy);
                if (t === T.DEEP_WATER || t === T.SHALLOW_WATER) return false;
            }
        return true;
    }

    /** Pick a cardinal direction from an angle. */
    _angleToCardinal(angle) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "E" : "W";
        return dy > 0 ? "S" : "N";
    }

    /**
     * Stamp a 10×10 compound centred at grid (cx, cy).
     * Returns layout data (tile positions for each structure type).
     */
    _stampCompound(cx, cy, dir, baseType) {
        const SIZE = 10;
        const ox = cx - 5,
            oy = cy - 5;
        const hqOnly = baseType === "hq_only";

        // Fill compound area with sand (force land — overwrite water too)
        for (let dy = 0; dy < SIZE; dy++) {
            for (let dx = 0; dx < SIZE; dx++) {
                this.setTile(ox + dx, oy + dy, T.SAND);
            }
        }

        const walls = [];
        const towers = [];

        if (!hqOnly) {
            // Helper: classify a perimeter tile on the entrance side.
            // Returns 'gap', 'tower', or 'wall'.
            const entranceRole = (dx, dy) => {
                let edgePos = -1;
                if (dir === "N" && dy === 0) edgePos = dx;
                else if (dir === "S" && dy === SIZE - 1) edgePos = dx;
                else if (dir === "W" && dx === 0) edgePos = dy;
                else if (dir === "E" && dx === SIZE - 1) edgePos = dy;
                else return "wall"; // not the entrance side
                if (edgePos === 4 || edgePos === 5) return "gap";
                if (edgePos === 3 || edgePos === 6) return "tower";
                return "wall";
            };

            // Place perimeter structures
            for (let dy = 0; dy < SIZE; dy++) {
                for (let dx = 0; dx < SIZE; dx++) {
                    if (dx > 0 && dx < SIZE - 1 && dy > 0 && dy < SIZE - 1) continue;
                    const role = entranceRole(dx, dy);
                    const gx = ox + dx,
                        gy = oy + dy;
                    if (role === "gap") {
                        this.setTile(gx, gy, T.DIRT); // entrance road
                    } else if (role === "tower") {
                        towers.push({ gx, gy });
                        this.setTile(gx, gy, T.BASE_STRUCTURE);
                    } else {
                        walls.push({ gx, gy });
                        this.setTile(gx, gy, T.BASE_STRUCTURE);
                    }
                }
            }
        }

        // HQ placement — 1×2, perpendicular to entrance direction
        let hqTiles;
        if (dir === "E" || dir === "W") {
            hqTiles = [
                { gx: ox + 4, gy: oy + 4 },
                { gx: ox + 4, gy: oy + 5 },
            ];
        } else {
            hqTiles = [
                { gx: ox + 4, gy: oy + 4 },
                { gx: ox + 5, gy: oy + 4 },
            ];
        }
        for (const t of hqTiles) this.setTile(t.gx, t.gy, T.BASE_STRUCTURE);

        // HQ centre in world space (midpoint of two tile centres)
        const hqCenter = {
            x: (hqTiles[0].gx + hqTiles[1].gx) / 2 + 0.5,
            y: (hqTiles[0].gy + hqTiles[1].gy) / 2 + 0.5,
        };

        return {
            walls,
            towers,
            hqTiles,
            hqCenter,
            center: { x: ox + 5, y: oy + 5 },
            dir,
            ox,
            oy,
        };
    }

    /**
     * Connect a compound entrance to the nearest road tile.
     */
    _connectCompoundToRoad(layout) {
        const { ox, oy, dir } = layout;
        let ex, ey;
        if (dir === "N") {
            ex = ox + 4;
            ey = oy - 1;
        } else if (dir === "S") {
            ex = ox + 5;
            ey = oy + 10;
        } else if (dir === "E") {
            ex = ox + 10;
            ey = oy + 4;
        } else {
            ex = ox - 1;
            ey = oy + 5;
        }

        // Find nearest road tile
        let bestX = -1,
            bestY = -1,
            bestD = Infinity;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (!this.isRoad(x, y)) continue;
                const d = Math.hypot(x - ex, y - ey);
                if (d < bestD) {
                    bestD = d;
                    bestX = x;
                    bestY = y;
                }
            }
        }
        if (bestX >= 0) {
            this._layDirtRoad({ x: ex, y: ey }, { x: bestX, y: bestY });
        }
    }

    /**
     * Pick a random spawn point inside a compound's interior.
     * @param {number} cx  compound centre grid X
     * @param {number} cy  compound centre grid Y
     */
    getBaseSpawnPoint(cx, cy) {
        const s = VEHICLES.tank.size * 0.85;
        const ox = Math.floor(cx) - 5,
            oy = Math.floor(cy) - 5;

        for (let attempt = 0; attempt < 100; attempt++) {
            // Random tile inside the 8×8 interior
            const gx = ox + 1 + Math.floor(Math.random() * 8);
            const gy = oy + 1 + Math.floor(Math.random() * 8);
            const wx = gx + 0.5,
                wy = gy + 0.5;
            if (
                this.isPassable(wx - s, wy - s) &&
                this.isPassable(wx + s, wy - s) &&
                this.isPassable(wx - s, wy + s) &&
                this.isPassable(wx + s, wy + s)
            ) {
                return { x: wx, y: wy };
            }
        }
        return { x: cx + 0.5, y: cy + 0.5 };
    }

    /**
     * Remove hills/rocks in a large circle around a base, replacing
     * them with grass.  Keeps the area navigable for bots.
     */
    _clearAroundBase(gx, gy, r) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r * r) continue;
                const tx = gx + dx,
                    ty = gy + dy;
                const t = this.getTile(tx, ty);
                if (this.isSolid(t) && t !== T.BASE_STRUCTURE) {
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
        const dx = p2.x - p1.x,
            dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) return;
        const px = -dy / len,
            py = dx / len; // perpendicular

        const steps = Math.ceil(len * 2); // oversample for no gaps
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const cx = p1.x + dx * t;
            const cy = p1.y + dy * t;
            for (let w = -hw; w <= hw; w++) {
                const gx = Math.floor(cx + px * w);
                const gy = Math.floor(cy + py * w);
                const tile = this.getTile(gx, gy);
                if (tile === T.BASE_STRUCTURE) {
                } else if (this.isSolid(tile)) {
                    this.setTile(gx, gy, T.GRASS);
                } else if (tile === T.DEEP_WATER || tile === T.SHALLOW_WATER) {
                    this.setTile(gx, gy, T.SAND);
                }
            }
        }
    }

    /** Search outward from (tx,ty) for a spot with `r` tiles of clear grass. */
    _findClearSpot(tx, ty, r) {
        const maxRing = Math.max(12, Math.round(Math.min(this.width, this.height) * 0.2));
        for (let ring = 0; ring < maxRing; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const gx = tx + dx,
                        gy = ty + dy;
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
            for (let dx = -r; dx <= r; dx++) if (!this.isPassable(gx + dx + 0.5, gy + dy + 0.5)) return false;
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
                if (dx * dx + dy * dy > R * R) continue; // circular
                const tx = gx + dx,
                    ty = gy + dy;
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
            const x = randomInt(6, this.width - 7) + 0.5;
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
        const w = this.width,
            h = this.height;
        const cx = w / 2,
            cy = h / 2;
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

        if (d > islandEdge) return T.DEEP_WATER;
        if (d > islandEdge - 1.8) return T.SHALLOW_WATER;
        if (d > islandEdge - 3.5) return T.SAND;

        const grassN = this._fbm(gx * 0.12, gy * 0.12, 2, 300);
        return grassN > 0.52 ? T.DARK_GRASS : T.GRASS;
    }

    /* ── Village placement ────────────────────────────────── */

    /**
     * Place village clusters (min 14 tiles apart), connect with dirt
     * roads, then scatter roadside buildings along the connecting roads.
     */
    _placeVillages(cx, cy, maxR) {
        // Scale village density with map size and density multiplier
        const mapScale = Math.min(this.width, this.height) / 64;
        const density = this.villageDensity;
        const MIN_VILLAGE_DIST = Math.max(6, Math.round((14 * mapScale) / density));
        const villageCentres = [];
        const attempts = Math.round((20 + Math.floor(this._hash(77, 88) * 10)) * mapScale * mapScale * density);

        // Step 1: pick village positions, enforcing minimum separation
        for (let i = 0; i < attempts; i++) {
            const angle = this._hash(i * 11, 100) * Math.PI * 2;
            const dist = 5 + this._hash(i * 17, 200) * (maxR - 12);
            const vx = Math.round(cx + Math.cos(angle) * dist);
            const vy = Math.round(cy + Math.sin(angle) * dist);

            if (!this.isPassable(vx + 0.5, vy + 0.5)) continue;
            if (distance(vx, vy, cx, cy) > maxR - 6) continue;

            // Enforce minimum distance from every existing village
            let tooClose = false;
            for (const vc of villageCentres) {
                if (distance(vx, vy, vc.x, vc.y) < MIN_VILLAGE_DIST) {
                    tooClose = true;
                    break;
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
            let bestI = -1,
                bestJ = -1,
                bestD = Infinity;
            for (const ci of connected) {
                for (const ri of remaining) {
                    const d = distance(
                        villageCentres[ci].x,
                        villageCentres[ci].y,
                        villageCentres[ri].x,
                        villageCentres[ri].y,
                    );
                    if (d < bestD) {
                        bestD = d;
                        bestI = ci;
                        bestJ = ri;
                    }
                }
            }
            if (bestJ < 0) break;
            const a = villageCentres[bestI],
                b = villageCentres[bestJ];
            this._layDirtRoad(a, b);
            roadSegments.push({ a, b });
            connected.push(bestJ);
            remaining.delete(bestJ);
        }

        // Step 3: scatter a few buildings along the dirt roads between villages
        for (let seg = 0; seg < roadSegments.length; seg++) {
            this._scatterRoadsideBuildings(roadSegments[seg].a, roadSegments[seg].b, seg);
        }
    }

    /**
     * Lay a 1-tile-wide dirt road between two points using only
     * cardinal steps (up/down/left/right).  Every tile shares a
     * full edge with the next — no diagonal-only connections.
     */
    _layDirtRoad(a, b) {
        let x = Math.floor(a.x),
            y = Math.floor(a.y);
        const gx = Math.floor(b.x),
            gy = Math.floor(b.y);

        while (x !== gx || y !== gy) {
            const tile = this.getTile(x, y);
            if (tile === T.GRASS || tile === T.DARK_GRASS) {
                this.setTile(x, y, T.DIRT);
            }
            // Step one tile: pick the axis with the larger remaining gap.
            // When equal, use a hash for a natural wobble instead of
            // always favouring the same axis.
            const dx = gx - x,
                dy = gy - y;
            if (Math.abs(dx) > Math.abs(dy)) {
                x += dx > 0 ? 1 : -1;
            } else if (Math.abs(dy) > Math.abs(dx)) {
                y += dy > 0 ? 1 : -1;
            } else {
                // Equal — random pick for variety
                if (this._hash(x * 31 + y * 47, 1050) > 0.5) x += dx > 0 ? 1 : -1;
                else y += dy > 0 ? 1 : -1;
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
        const dx = b.x - a.x,
            dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 8) return; // too short, skip

        const ux = dx / len,
            uy = dy / len; // road direction
        const px = -uy,
            py = ux; // perpendicular

        const count = 2 + Math.floor(this._hash(seed * 67, 1100) * 4);
        for (let i = 0; i < count; i++) {
            // Position along the road (skip first/last 20% to stay away from villages)
            const t = 0.2 + this._hash(seed * 13 + i * 47, 1200) * 0.6;
            const cx = a.x + dx * t;
            const cy = a.y + dy * t;

            // Offset 1–2 tiles to one side
            const side = this._hash(seed * 19 + i * 31, 1300) > 0.5 ? 1 : -1;
            const off = 1 + Math.floor(this._hash(seed * 23 + i * 37, 1400) * 1.5);
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
            const px = road.dy !== 0 ? 1 : 0; // perpendicular
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
                    if (sizeRoll < 0.45) bldgType = T.BLDG_SMALL;
                    else if (sizeRoll < 0.8) bldgType = T.BLDG_MEDIUM;
                    else bldgType = T.BLDG_LARGE;

                    this.setTile(bx, by, bldgType);

                    // Large buildings extend along the road
                    if (bldgType === T.BLDG_LARGE) {
                        const ex = bx + road.dx,
                            ey = by + road.dy;
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
        const ix = Math.floor(x),
            iy = Math.floor(y);
        const fx = x - ix,
            fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v00 = this._hash(ix + off, iy);
        const v10 = this._hash(ix + 1 + off, iy);
        const v01 = this._hash(ix + off, iy + 1);
        const v11 = this._hash(ix + 1 + off, iy + 1);
        const top = v00 + (v10 - v00) * sx;
        const bot = v01 + (v11 - v01) * sx;
        return top + (bot - top) * sy;
    }

    /** Fractal Brownian Motion – layered noise for natural textures. */
    _fbm(x, y, octaves, off) {
        let value = 0,
            amp = 1,
            freq = 1,
            total = 0;
        for (let i = 0; i < octaves; i++) {
            value += this._noise(x * freq, y * freq, off + i * 997) * amp;
            total += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return value / total;
    }
}
