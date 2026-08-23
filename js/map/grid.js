/**
 * TileGrid — the map's data layer.
 *
 * Owns the flat typed arrays (tile type, per-tile hit-points) and answers
 * every *tile-property* question via the `TILE_PROPS` data table.  Spatial
 * queries (line-of-sight, passability boxes, cover searches) live in
 * `queries.js`; procedural generation and base-compound layout live in
 * `generation.js` / `compounds.js`.  `GameMap` (js/map.js) composes these
 * over this class.
 */

import { CONFIG, MAP_STYLES, TILES as T, TILE_PROPS } from "../config.js";

export class TileGrid {
    /**
     * @param {number} [width]           map width (defaults to CONFIG.MAP_WIDTH)
     * @param {number} [height]          map height (defaults to CONFIG.MAP_HEIGHT)
     * @param {number} [villageDensity]  multiplier for village generation (default 1.0)
     * @param {string} [style]           biome key in `MAP_STYLES` (default "island")
     */
    constructor(width, height, villageDensity, style) {
        this.width = width ?? CONFIG.MAP_WIDTH;
        this.height = height ?? CONFIG.MAP_HEIGHT;
        /** Village density multiplier (0.5 = sparse, 1.0 = normal, 1.5 = dense). */
        this.villageDensity = villageDensity ?? 1.0;
        /** Biome key (see `MAP_STYLES` in config). */
        this.style = style ?? "island";
        /** Flat Uint8 array – index with `y * width + x`. */
        this.tiles = new Uint8Array(this.width * this.height);
        /** Per-tile hit-points (0 = full health / not destructible). */
        this.hp = new Float32Array(this.width * this.height);
        /** Max HP per tile (for damage fraction calculation). */
        this.maxHp = new Uint8Array(this.width * this.height);
        /** Seed for the noise functions (new island every game). */
        this.seed = Math.floor(Math.random() * 2147483647);
    }

    getTile(gx, gy) {
        if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return T.DEEP_WATER;
        return this.tiles[gy * this.width + gx];
    }

    setTile(gx, gy, type) {
        if (gx >= 0 && gx < this.width && gy >= 0 && gy < this.height) {
            const i = gy * this.width + gx;
            this.tiles[i] = type;
            // Initialise HP for destructible tiles from the data table.
            const h = TILE_PROPS[type]?.hp ?? 0;
            this.hp[i] = h;
            this.maxHp[i] = h;
        }
    }

    /** Is this tile type a solid obstacle (hill, rock, building, or base structure)? */
    isSolid(tileType) {
        return TILE_PROPS[tileType]?.solid ?? false;
    }

    /** Can a vehicle stand at continuous world position (wx, wy)? */
    isPassable(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return TILE_PROPS[t]?.passable ?? false;
    }

    /** Is this a road tile? Buildings must not be placed on roads. */
    isRoad(gx, gy) {
        const t = this.getTile(gx, gy);
        return TILE_PROPS[t]?.road ?? false;
    }

    /** Is this tile type water? */
    isWaterTile(tileType) {
        return TILE_PROPS[tileType]?.water ?? false;
    }

    /** Is this tile type a destructible building? */
    isBuildingTile(tileType) {
        return TILE_PROPS[tileType]?.building ?? false;
    }

    /** Is (gx, gy) a building tile that has not been destroyed yet? */
    isIntactBuilding(gx, gy) {
        const t = this.getTile(gx, gy);
        return this.isBuildingTile(t) && this.hp[gy * this.width + gx] > 0;
    }

    /** Does this tile stop a bullet? */
    blocksProjectile(wx, wy) {
        const t = this.getTile(Math.floor(wx), Math.floor(wy));
        return TILE_PROPS[t]?.solid ?? false;
    }

    /** Pixel-height of a tile type (for isometric elevation). */
    tileHeight(tileType) {
        return TILE_PROPS[tileType]?.height ?? 0;
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
            // Destroyed → the biome's destroyed-tile fallback.
            const style = MAP_STYLES[this.style] ?? MAP_STYLES.island;
            this.tiles[i] = style.destroyedTile ?? T.GRASS;
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
}
