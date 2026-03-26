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
 * Per-vehicle-type stats.  Every gameplay value that varies between
 * vehicle types lives here.  The game reads VEHICLES[tank.vehicleType]
 * at runtime — adding a new vehicle is just a new entry in this table.
 *
 * roleWeights: per-vehicle role distribution for team mode AI.
 *              Higher weight = more likely.  0 = never assigned.
 *              Drones are always cavalry; IFVs lean toward scout.
 */
export const VEHICLES = {
    tank: {
        speed: 3.0, // world-units / second
        rotationSpeed: 3.5, // radians / second (hull)
        turretSpeed: 2.0, // radians / second (independent turret)
        size: 0.45, // collision radius in world-units
        bulletSpeed: 9.0, // world-units / second
        bulletDamage: 1.0, // damage per shot
        bulletCooldown: 0.45, // seconds between shots
        spawnWeight: 5, // relative spawn chance in team mode
        roleWeights: { cavalry: 3, sniper: 2, defender: 2, scout: 1 },
    },
    ifv: {
        speed: 4.5, // faster (was 1.5× tank)
        rotationSpeed: 4.0, // wheeled — agile
        turretSpeed: 0, // fixed forward gun
        size: 0.45, // same footprint as tank
        bulletSpeed: 13.5, // faster rounds (was 1.5× tank)
        bulletDamage: 0.25, // 4 hits = 1 tank hit
        bulletCooldown: 0.18, // rapid fire
        spawnWeight: 3, // relative spawn chance
        roleWeights: { cavalry: 1, sniper: 1, defender: 2, scout: 4 },
    },
    drone: {
        speed: 6.0, // very fast (was 2× tank)
        rotationSpeed: 5.0, // very agile
        turretSpeed: 0, // no turret
        size: 0.1, // small, hard to hit
        bulletSpeed: 0, // N/A — kamikaze
        bulletDamage: 0, // N/A — uses blastDamage
        bulletCooldown: 0, // N/A
        blastRadius: 2.5, // detonation AoE radius
        blastDamage: 1.0, // max damage at point blank
        spawnWeight: 3, // relative spawn chance
        roleWeights: { cavalry: 1, sniper: 0, defender: 0, scout: 0 },
    },
};
