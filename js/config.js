/**
 * Central configuration for the entire game.
 * Tweak values here to tune gameplay, visuals, and controls.
 */

export const TILES = {
    DEEP_WATER: 0,
    SHALLOW_WATER: 1,
    SAND: 2,
    GRASS: 3,
    DARK_GRASS: 4,
    HILL: 5,
    ROCK: 6,
    DIRT: 7, // dirt road (between villages)
    PAVED: 8, // paved road (inside villages)
    BLDG_SMALL: 9, // 1-tile cottage / shed
    BLDG_MEDIUM: 10, // taller house
    BLDG_LARGE: 11, // 2-storey building
    BASE_STRUCTURE: 12, // base compound tile (impassable, blocks projectiles)
};

export const CONFIG = {
    // ── Display ──────────────────────────────────────────────
    TILE_WIDTH: 64,
    TILE_HEIGHT: 32,
    TILE_DEPTH: 20, // pixel height of elevated tiles

    // ── Map ──────────────────────────────────────────────────
    MAP_WIDTH: 100,
    MAP_HEIGHT: 100,

    // ── Shared vehicle defaults ──────────────────────────────
    TANK_REVERSE_FACTOR: 0.4, // backward speed multiplier
    TANK_BARREL_LENGTH: 0.52, // barrel tip distance from centre (world-units)
    CAMERA_LOOK_AHEAD: 3.5, // world-units offset in the facing direction
    CAMERA_SMOOTHING: 2.5, // lower = smoother/slower follow
    TANK_RESPAWN_TIME: 2.0, // seconds before respawn

    // ── Directional armour ───────────────────────────────────
    HIT_FRONT_ARC: Math.PI / 4, // ±45° from forward = 90° front cone
    HIT_REAR_ARC: Math.PI / 4, // ±45° from backward = 90° rear cone
    // Side zones fill the remaining 90° on each side.

    // ── Terrain ──────────────────────────────────────────────
    HILL_HP: 3, // shots to destroy a hill tile
    ROCK_HP: 7, // shots to destroy a rock tile
    BLDG_SMALL_HP: 3,
    BLDG_MEDIUM_HP: 5,
    BLDG_LARGE_HP: 8,

    // ── Bullet ───────────────────────────────────────────────
    BULLET_RADIUS: 3, // screen-pixel radius
    BULLET_LIFETIME: 3.0,

    // ── AI Roles (team mode) ─────────────────────────────────
    SNIPER_FIRE_RANGE: 15, // preferred distance from enemy tower
    SNIPER_MIN_RANGE: 10, // won't get closer than this
    SNIPER_ENGAGE_RANGE: 6, // only fights enemies this close
    DEFENDER_PATROL_RADIUS: 10, // patrol radius around friendly tower
    DEFENDER_ENGAGE_RANGE: 18, // intercepts enemies this close to tower
    SCOUT_FLANK_OFFSET: 20, // perpendicular offset for flanking route
    SNIPER_FLANK_OFFSET: 15, // perpendicular offset for sniper flanking route

    // Position scoring weights: { cover, flank, range, los }
    // Each role scores candidate positions with these weights.
    // 0 = don't care, higher = more important.
    SNIPER_POSITION_WEIGHTS: { cover: 3, flank: 2, range: 2, los: 4 },
    SCOUT_POSITION_WEIGHTS: { cover: 0, flank: 5, range: 0, los: 0 },
    POSITION_COVER_RADIUS: 3, // tile radius to count cover around a candidate
    POSITION_SAMPLES: 24, // number of candidate positions to evaluate

    // ── Particles ────────────────────────────────────────────
    MAX_PARTICLES: 300,

    // ── Scoring ──────────────────────────────────────────────
    WIN_SCORE: 10,

    // ── Controls ─────────────────────────────────────────────
    PLAYER1_KEYS: {
        forward: "KeyW",
        backward: "KeyS",
        left: "KeyA",
        right: "KeyD",
        turretLeft: "KeyQ",
        turretRight: "KeyE",
        fire: "Space",
    },
    PLAYER2_KEYS: {
        forward: "ArrowUp",
        backward: "ArrowDown",
        left: "ArrowLeft",
        right: "ArrowRight",
        turretLeft: "Comma",
        turretRight: "Period",
        fire: "Enter",
    },
};

/**
 * Game mode definitions.
 *
 * Each mode describes:
 *   category: 'duel' | 'skirmish' | 'battle' — determines which
 *             game options are shown on the pre-game settings screen
 *   teams:    [[humans, bots], [humans, bots]]  — team 1 (red) and team 2 (blue)
 *   split:    true = split screen (requires 2 humans total)
 *   bases:    true = towers + tower-destruction win condition
 *             false = score-based win condition (first to WIN_SCORE kills)
 *   vehicles: array of allowed vehicle type keys from VEHICLES
 *             Humans always spawn as the first entry; bots pick randomly
 *             using spawnWeight from the allowed subset.
 *   defaults: optional overrides for GAME_OPTIONS default indices/values
 *             (e.g. { mapSize: 0 } to default to Small for duels)
 */
export const MODE_DEFS = {
    duel_split: {
        category: "duel",
        teams: [
            [1, 0],
            [1, 0],
        ],
        split: true,
        bases: false,
        vehicles: ["tank"],
        defaults: { mapSize: 0 },
    },
    duel_bot: {
        category: "duel",
        teams: [
            [1, 0],
            [0, 1],
        ],
        split: false,
        bases: false,
        vehicles: ["tank"],
        defaults: { mapSize: 0 },
    },
    skirmish_coop: {
        category: "skirmish",
        teams: [
            [2, 0],
            [0, 2],
        ],
        split: true,
        bases: false,
        vehicles: ["tank"],
        defaults: { mapSize: 0 },
    },
    battle_split: {
        category: "battle",
        teams: [
            [1, 4],
            [1, 4],
        ],
        split: true,
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg"],
    },
    battle_coop: {
        category: "battle",
        teams: [
            [2, 3],
            [0, 5],
        ],
        split: true,
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg"],
    },
    battle_solo: {
        category: "battle",
        teams: [
            [1, 4],
            [0, 5],
        ],
        split: false,
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg"],
    },
};

/* ═══════════════════════════════════════════════════════════ *
 *  Pre-game options                                           *
 *                                                             *
 *  GAME_OPTIONS     — master list of every option, defined    *
 *                     once with type, labels, and defaults    *
 *  CATEGORY_OPTIONS — which options each mode category shows  *
 *  resolveSettings() — merge defaults + user overrides into   *
 *                      a flat object with concrete values     *
 * ═══════════════════════════════════════════════════════════ */

/**
 * Available game options.  Each defines its UI type, labels, allowed
 * values, and a global default.
 *
 * 'enum' type:
 *   choices[]       — { label, value } pairs shown in the UI
 *   defaultIndex    — index into choices[] used when no override exists
 *
 * 'range' type:
 *   min, max, step  — numeric range
 *   default         — initial value when no override exists
 */
export const GAME_OPTIONS = [
    {
        key: "mapSize",
        label: "MAP SIZE",
        type: "enum",
        choices: [
            { label: "Small  (64\u00d764)", value: { w: 64, h: 64 } },
            { label: "Medium (100\u00d7100)", value: { w: 100, h: 100 } },
            { label: "Large  (140\u00d7140)", value: { w: 140, h: 140 } },
        ],
        defaultIndex: 1,
    },
    {
        key: "buildingDensity",
        label: "BUILDING DENSITY",
        type: "enum",
        choices: [
            { label: "Sparse", value: 0.5 },
            { label: "Normal", value: 1.0 },
            { label: "Dense", value: 1.5 },
        ],
        defaultIndex: 1,
    },
    {
        key: "baseType",
        label: "BASE TYPE",
        type: "enum",
        choices: [
            { label: "HQ Only", value: "hq_only" },
            { label: "Compound", value: "compound" },
        ],
        defaultIndex: 1,
    },
    {
        key: "teamSize",
        label: "TEAM SIZE",
        type: "range",
        min: 2,
        max: 16,
        step: 1,
        default: 5,
    },
];

/** Which options are shown per mode category. */
export const CATEGORY_OPTIONS = {
    duel: ["mapSize", "buildingDensity"],
    skirmish: ["mapSize", "buildingDensity"],
    battle: ["mapSize", "buildingDensity", "baseType", "teamSize"],
};

/** Look up an option definition by key. */
function _optionDef(key) {
    return GAME_OPTIONS.find((o) => o.key === key);
}

/**
 * Build the initial option indices/values for a mode, merging:
 *   1. global GAME_OPTIONS defaults
 *   2. per-mode MODE_DEFS[mode].defaults overrides
 *
 * Returns a Map<string, number> where:
 *   enum  options → current choice index
 *   range options → current numeric value
 */
export function getDefaultOptionValues(mode) {
    const def = MODE_DEFS[mode];
    const category = def?.category ?? "duel";
    const keys = CATEGORY_OPTIONS[category] ?? [];
    const modeDefaults = def?.defaults ?? {};
    const values = new Map();

    for (const key of keys) {
        const opt = _optionDef(key);
        if (!opt) continue;
        if (key in modeDefaults) {
            values.set(key, modeDefaults[key]);
        } else if (opt.type === "enum") {
            values.set(key, opt.defaultIndex);
        } else {
            values.set(key, opt.default);
        }
    }
    return values;
}

/**
 * Resolve a Map<string, index/value> into a flat settings object
 * with concrete gameplay values.
 *
 * Example output:
 *   { mapSize: { w: 100, h: 100 }, buildingDensity: 1.0,
 *     baseType: 'compound', teamSize: 5 }
 */
export function resolveSettings(optionValues) {
    const settings = {};
    for (const [key, val] of optionValues) {
        const opt = _optionDef(key);
        if (!opt) continue;
        if (opt.type === "enum") {
            settings[key] = opt.choices[val].value;
        } else {
            settings[key] = val;
        }
    }
    return settings;
}

/**
 * Per-vehicle-type stats.  Every gameplay value that varies between
 * vehicle types lives here.  The game reads VEHICLES[tank.vehicleType]
 * at runtime — adding a new vehicle is just a new entry in this table.
 *
 * roleWeights:    per-vehicle role distribution for team mode AI.
 *                 Higher weight = more likely.  0 = never assigned.
 *                 Drones are always cavalry; IFVs lean toward scout.
 *                 SPGs lean toward sniper (long-range indirect fire).
 *
 * targetPriority: per-vehicle preference for engaging different target
 *                 types.  Higher = more desirable.  0 = never engage.
 *                 Keys are vehicle type names + 'base' for towers.
 *                 AI uses  weight / distance  to score candidates, so
 *                 a nearby low-priority target can still beat a distant
 *                 high-priority one.  Adding a new vehicle type only
 *                 requires a new entry here with its own targetPriority.
 *
 * armour:         data-driven damage model.  Every vehicle declares:
 *   hp               total damage required to destroy the vehicle
 *   subsystemThreshold  accumulated damage at which the first subsystem
 *                       is knocked out (null = no subsystem phase, damage
 *                       goes straight to destruction)
 *   rearInstantKill  if true, a full-damage (>=1.0) rear hit kills
 *                    instantly regardless of remaining HP
 *   subsystems       map of hit-zone name -> subsystem key:
 *                       "turret"     -> turretDisabled
 *                       "leftTrack"  -> leftTrackDisabled
 *                       "rightTrack" -> rightTrackDisabled
 *                    Zones not listed deal damage but disable nothing.
 *
 * The applyHit() method in tank.js reads this table generically --
 * adding a new vehicle or tweaking durability is purely a config change.
 */
export const VEHICLES = {
    tank: {
        speed: 3.0,
        rotationSpeed: 3.5,
        turretSpeed: 2.0,
        size: 0.45,
        bulletSpeed: 9.0,
        bulletDamage: 3.0,
        bulletCooldown: 0.45,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 3, sniper: 2, defender: 1, scout: 1 },
        targetPriority: { spg: 10, tank: 10, drone: 0, ifv: 2, baseWall: 5, baseTower: 10, baseHQ: 10 },
        armour: {
            hp: 6,
            subsystemThreshold: 3,
            rearInstantKill: true,
            subsystems: {
                front: "turret",
                side_left: "leftTrack",
                side_right: "rightTrack",
            },
        },
    },
    ifv: {
        speed: 4.5,
        rotationSpeed: 4.0,
        turretSpeed: 0,
        size: 0.45,
        bulletSpeed: 13.0,
        bulletDamage: 0.25,
        bulletCooldown: 0.15,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 2, sniper: 2, defender: 1, scout: 5 },
        targetPriority: { spg: 5, tank: 2, drone: 10, ifv: 3, baseWall: 3, baseTower: 5, baseHQ: 10 },
        armour: {
            hp: 3,
            subsystemThreshold: 2,
            rearInstantKill: false,
            subsystems: {
                side_left: "leftTrack",
                side_right: "rightTrack",
            },
        },
    },
    drone: {
        speed: 6.0,
        rotationSpeed: 5.0,
        turretSpeed: 0,
        size: 0.1,
        bulletSpeed: 0,
        bulletDamage: 0,
        bulletCooldown: 0,
        blastRadius: 2.5,
        blastDamage: 7.5,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 1, sniper: 0, defender: 0, scout: 0 },
        targetPriority: { spg: 10, tank: 5, drone: 0, ifv: 2, baseWall: 0, baseTower: 0, baseHQ: 10 },
        armour: {
            hp: 0.1,
            subsystemThreshold: null,
            rearInstantKill: false,
            subsystems: {},
        },
    },
    spg: {
        speed: 2.0,
        rotationSpeed: 2.0,
        turretSpeed: 1.0,
        size: 0.5,
        bulletSpeed: 7.0,
        bulletDamage: 3.0,
        bulletCooldown: 3.0,
        chargeRate: 8.0,
        minRange: 4.0,
        maxRange: 25.0,
        arcHeight: 40,
        splashRadius: 1.5,
        spawnWeight: 3,
        cameraLookAhead: 10.0,
        roleWeights: { cavalry: 0, sniper: 5, defender: 0, scout: 0 },
        targetPriority: { spg: 5, tank: 0, drone: 0, ifv: 0, baseWall: 0, baseTower: 10, baseHQ: 10 },
        armour: {
            hp: 3,
            subsystemThreshold: 2,
            rearInstantKill: true,
            subsystems: {
                front: "turret",
                side_left: "leftTrack",
                side_right: "rightTrack",
            },
        },
    },
};

/**
 * Base structure definitions.
 *
 * Parallel to VEHICLES -- every gameplay value that varies between
 * structure types lives here.  targetPriority only appears on
 * structures that can shoot (baseTower).
 */
export const BASE_STRUCTURES = {
    baseWall: {
        hp: 3,
        size: 0.5,
        visHeight: 10,
    },
    baseTower: {
        hp: 5,
        size: 0.5,
        visHeight: 20,
        fireRange: 15,
        bulletSpeed: 13.0,
        bulletDamage: 0.1,
        bulletCooldown: 0.15,
        targetPriority: { spg: 3, tank: 3, drone: 10, ifv: 3 },
    },
    baseHQ: {
        hp: 20,
        size: 0.5,
        visHeight: 14,
    },
};
