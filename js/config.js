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
};

export const CONFIG = {
    // ── Display ──────────────────────────────────────────────
    TILE_WIDTH: 64,
    TILE_HEIGHT: 32,
    TILE_DEPTH: 20, // pixel height of elevated tiles

    // ── Map ──────────────────────────────────────────────────
    MAP_WIDTH: 64,
    MAP_HEIGHT: 64,

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

    // ── Team / Tower ────────────────────────────────────────
    TEAM_SIZE: 5, // tanks per team (including human)
    TOWER_HP: 10,
    TOWER_RADIUS: 0.8, // collision / hit radius
    TOWER_VIS_HEIGHT: 35, // pixel height for rendering

    // ── Bullet ───────────────────────────────────────────────
    BULLET_RADIUS: 3, // screen-pixel radius
    BULLET_LIFETIME: 3.0,

    // ── AI Roles (team mode) ─────────────────────────────────
    SNIPER_FIRE_RANGE: 12, // preferred distance from enemy tower
    SNIPER_MIN_RANGE: 8, // won't get closer than this
    SNIPER_ENGAGE_RANGE: 6, // only fights enemies this close
    DEFENDER_PATROL_RADIUS: 8, // patrol radius around friendly tower
    DEFENDER_ENGAGE_RANGE: 14, // intercepts enemies this close to tower
    SCOUT_FLANK_OFFSET: 20, // perpendicular offset for flanking route

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
 *   teams:    [[humans, bots], [humans, bots]]  — team 1 (red) and team 2 (blue)
 *   split:    true = split screen (requires 2 humans total)
 *   bases:    true = towers + tower-destruction win condition
 *             false = score-based win condition (first to WIN_SCORE kills)
 *   vehicles: array of allowed vehicle type keys from VEHICLES
 *             Humans always spawn as the first entry; bots pick randomly
 *             using spawnWeight from the allowed subset.
 */
export const MODE_DEFS = {
    duel_split: {
        teams: [
            [1, 0],
            [1, 0],
        ],
        split: true,
        bases: false,
        vehicles: ["tank"],
    },
    duel_bot: {
        teams: [
            [1, 0],
            [0, 1],
        ],
        split: false,
        bases: false,
        vehicles: ["tank"],
    },
    skirmish_coop: {
        teams: [
            [2, 0],
            [0, 2],
        ],
        split: true,
        bases: false,
        vehicles: ["tank"],
    },
    battle_split: {
        teams: [
            [1, 4],
            [1, 4],
        ],
        split: true,
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg"],
    },
    battle_coop: {
        teams: [
            [2, 3],
            [0, 5],
        ],
        split: true,
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg"],
    },
    battle_solo: {
        teams: [
            [1, 4],
            [0, 5],
        ],
        split: false,
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg"],
    },
};

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
 */
export const VEHICLES = {
    tank: {
        speed: 3.0,
        rotationSpeed: 3.5,
        turretSpeed: 2.0,
        size: 0.45,
        bulletSpeed: 9.0,
        bulletDamage: 1.0,
        bulletCooldown: 0.45,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 3, sniper: 2, defender: 2, scout: 1 },
        targetPriority: { spg: 10, tank: 10, drone: 0, ifv: 2, base: 10 },
    },
    ifv: {
        speed: 4.5,
        rotationSpeed: 4.0,
        turretSpeed: 0,
        size: 0.45,
        bulletSpeed: 13.0,
        bulletDamage: 0.25,
        bulletCooldown: 0.18,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 1, sniper: 1, defender: 2, scout: 4 },
        targetPriority: { spg: 5, tank: 2, drone: 10, ifv: 3, base: 2 },
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
        blastDamage: 1.0,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 1, sniper: 0, defender: 0, scout: 0 },
        targetPriority: { spg: 10, tank: 5, drone: 0, ifv: 2, base: 10 },
    },
    spg: {
        speed: 2.0,
        rotationSpeed: 2.0,
        turretSpeed: 1.0,
        size: 0.5,
        bulletSpeed: 7.0,
        bulletDamage: 1.5,
        bulletCooldown: 3.0,
        chargeRate: 8.0,
        minRange: 4.0,
        maxRange: 25.0,
        arcHeight: 40,
        splashRadius: 1.5,
        spawnWeight: 3,
        cameraLookAhead: 10.0,
        roleWeights: { cavalry: 0, sniper: 5, defender: 2, scout: 0 },
        targetPriority: { spg: 5, tank: 0, drone: 0, ifv: 0, base: 10 },
    },
};
