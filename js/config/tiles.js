/**
 * Tile types and their gameplay semantics.
 *
 * `TILES` is the stable integer enum the tile grid stores; `TILE_PROPS`
 * is the data table of per-tile *semantics*, indexed by that id.  All the
 * "what does this tile do?" questions (passable? solid? road? water?
 * building? height? hit-points?) are answered by one table lookup, so
 * adding a tile type is a new `TILES` id + a new `TILE_PROPS` row — no
 * switch statements in the map/render/AI code.
 */

import { CONFIG } from "./constants.js";

export const TILES = {
    DEEP_WATER: 0,
    SHALLOW_WATER: 1,
    SAND: 2,
    GRASS: 3,
    DARK_GRASS: 4,
    HILL: 5,
    ROCK: 6,
    DIRT: 7, // dirt track (rural spurs)
    BLDG_SMALL: 8, // 1-tile cottage / shed
    BLDG_MEDIUM: 9, // taller house
    BLDG_LARGE: 10, // 2-storey building
    BASE_STRUCTURE: 11, // base compound tile (impassable, blocks projectiles)
    BRIDGE_STONE: 12, // stone bridge over water (passable, 2-lane)
    FIELD: 13, // ploughed farmer field (passable, purely cosmetic)
    TREE: 14, // hedgerow scrub — opaque sight cover, passable, bullets pass through
    BARN: 15, // farm building (acts like other buildings)
    SILO: 16, // farm silo (acts like other buildings)
    BRIDGE_WOOD: 17, // wooden bridge over water (same, different look)
    TARMAC: 18, // tarmac road (arteries + town streets), dashed centre line
};

/**
 * Per-tile semantics, indexed by the `TILES` id.
 *
 *   passable  — a vehicle can stand here (movement/pathfinding).
 *   solid     — blocks movement and projectiles (obstacle/cover).
 *   opaque    — blocks line of sight (sight cover); independent of
 *               movement — tree lines are opaque but passable.
 *   road      — a road tile (buildings must not be placed on it).
 *   water     — water (never passable, but not "solid" cover).
 *   building  — a destructible building (cover for squads).
 *   height    — isometric elevation in screen pixels (0 = flat).
 *   hp        — destructible hit-points (0 = not destructible).
 */
export const TILE_PROPS = Object.freeze([
    /* 0 DEEP_WATER    */ {
        passable: false,
        solid: false,
        opaque: false,
        road: false,
        water: true,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 1 SHALLOW_WATER */ {
        passable: false,
        solid: false,
        opaque: false,
        road: false,
        water: true,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 2 SAND          */ {
        passable: true,
        solid: false,
        opaque: false,
        road: false,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 3 GRASS         */ {
        passable: true,
        solid: false,
        opaque: false,
        road: false,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 4 DARK_GRASS    */ {
        passable: true,
        solid: false,
        opaque: false,
        road: false,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 5 HILL          */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: false,
        height: CONFIG.TILE_DEPTH,
        hp: CONFIG.HILL_HP,
    },
    /* 6 ROCK          */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: false,
        height: Math.round(CONFIG.TILE_DEPTH * 0.6),
        hp: CONFIG.ROCK_HP,
    },
    /* 7 DIRT          */ {
        passable: true,
        solid: false,
        opaque: false,
        road: true,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 8 BLDG_SMALL    */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: true,
        height: 14,
        hp: CONFIG.BLDG_SMALL_HP,
    },
    /* 9 BLDG_MEDIUM  */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: true,
        height: 22,
        hp: CONFIG.BLDG_MEDIUM_HP,
    },
    /* 10 BLDG_LARGE   */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: true,
        height: 32,
        hp: CONFIG.BLDG_LARGE_HP,
    },
    /* 11 BASE_STRUCTURE */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 12 BRIDGE_STONE   */ {
        passable: true,
        solid: false,
        opaque: false,
        road: true,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 13 FIELD          */ {
        passable: true,
        solid: false,
        opaque: false,
        road: false,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 14 TREE           */ {
        passable: true, // vehicles drive through tree lines
        solid: false, // …and bullets pass — sight-only cover
        opaque: true, // but you can't SEE through them
        road: false,
        water: false,
        building: false,
        height: 8, // low scrub — joins the depth pass, slightly occludes units behind
        hp: 0,
    },
    /* 15 BARN           */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: true,
        height: 17,
        hp: CONFIG.BLDG_MEDIUM_HP,
    },
    /* 16 SILO           */ {
        passable: false,
        solid: true,
        opaque: true,
        road: false,
        water: false,
        building: true,
        height: 26,
        hp: CONFIG.BLDG_SMALL_HP,
    },
    /* 17 BRIDGE_WOOD    */ {
        passable: true,
        solid: false,
        opaque: false,
        road: true,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
    /* 18 TARMAC         */ {
        passable: true,
        solid: false,
        opaque: false,
        road: true,
        water: false,
        building: false,
        height: 0,
        hp: 0,
    },
]);

/**
 * Per-tile *visual* semantics, indexed by the `TILES` id (the render-only
 * companion to `TILE_PROPS`).  `draw` selects the draw kind; `color` /
 * `top|left|right` are keys into the render `PALETTE`; `variation` is the
 * per-channel colour jitter for flat tiles; `mapColor` is the minimap fill.
 * The tile renderer (`js/render/tiles.js`) and the minimap both read this
 * table, so a new tile type is one `TILES` id + one `TILE_PROPS` row + one
 * `TILE_VISUALS` row — no draw switch or colour table to edit.
 */
export const TILE_VISUALS = Object.freeze([
    /* 0 DEEP_WATER    */ { draw: "water", color: "deepWater", mapColor: "#1a3252" },
    /* 1 SHALLOW_WATER */ { draw: "water", color: "shallowWater", mapColor: "#265a80" },
    /* 2 SAND          */ { draw: "flat", color: "sand", variation: { r: 3, g: 3, b: 2 }, mapColor: "#c8b490" },
    /* 3 GRASS         */ { draw: "flat", color: "grass", variation: { r: 4, g: 4, b: 3 }, mapColor: "#487c3c" },
    /* 4 DARK_GRASS    */ { draw: "flat", color: "darkGrass", variation: { r: 3, g: 3, b: 2 }, mapColor: "#3a6c2a" },
    /* 5 HILL          */ {
        draw: "elevated",
        top: "hillTop",
        left: "hillLeft",
        right: "hillRight",
        mapColor: "#8c7350",
    },
    /* 6 ROCK          */ {
        draw: "elevated",
        top: "rockTop",
        left: "rockLeft",
        right: "rockRight",
        mapColor: "#808080",
    },
    /* 7 DIRT          */ {
        draw: "road",
        mapColor: "#9b8260",
        road: { surface: "dirt", kerb: null, dash: null, verge: null, width: 9 },
    },
    /* 8 BLDG_SMALL    */ { draw: "building", mapColor: "#b4a08c" },
    /* 9 BLDG_MEDIUM  */ { draw: "building", mapColor: "#a0a0b0" },
    /* 10 BLDG_LARGE   */ { draw: "building", mapColor: "#707080" },
    /* 11 BASE_STRUCTURE */ { draw: "none", mapColor: "#000" },
    /* 12 BRIDGE_STONE   */ { draw: "bridge", mapColor: "#9a948a" },
    /* 13 FIELD          */ { draw: "field", color: "field", mapColor: "#a89058" },
    /* 14 TREE           */ { draw: "bush", mapColor: "#2a5424" },
    /* 15 BARN           */ { draw: "building", mapColor: "#a05038" },
    /* 16 SILO           */ { draw: "building", mapColor: "#909098" },
    /* 17 BRIDGE_WOOD    */ { draw: "bridge", mapColor: "#8a6c48" },
    /* 18 TARMAC         */ {
        draw: "road",
        mapColor: "#55555c",
        road: { surface: "tarmac", kerb: "tarmacKerb", dash: "roadDash", verge: "verge", width: 13 },
    },
]);
