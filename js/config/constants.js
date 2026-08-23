/**
 * Flat gameplay constants.  Tweak values here to tune gameplay, visuals,
 * and controls.
 */
export const CONFIG = {
    // ── Display ──────────────────────────────────────────────
    TILE_WIDTH: 64,
    TILE_HEIGHT: 32,
    TILE_DEPTH: 20, // pixel height of elevated tiles

    // ── Map ──────────────────────────────────────────────────
    MAP_WIDTH: 128,
    MAP_HEIGHT: 128,

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
    SNIPER_FIRE_MARGIN: 5, // extra range beyond SNIPER_FIRE_RANGE to start firing
    DEFENDER_PATROL_RADIUS: 10, // patrol radius around friendly tower
    DEFENDER_ENGAGE_RANGE: 18, // intercepts enemies this close to tower
    OBJECTIVE_ENGAGE_RANGE: 25, // fire at the objective when this close (cavalry/scout/default)
    CAVALRY_ENGAGE_RANGE: 10, // cavalry fires at enemies this close while rushing
    SCOUT_ENGAGE_RANGE: 6, // scout self-defence range
    DEFENDER_PERSONAL_RANGE: 10, // defender's own fire range (vs the intercept radius above)
    DEFAULT_ENGAGE_RANGE: 10, // no-role bots engage enemies this close
    DEFAULT_CHASE_RANGE: 8, // no-role bots chase a lone enemy this close
    IMMOBILISED_ENGAGE_RANGE: 15, // immobilised vehicles pivot toward enemies this close
    DEFENDER_PATROL_TURN: 0.8, // patrol heading step (radians)
    DEFENDER_PATROL_TURN_SPREAD: 1.0, // patrol heading jitter (radians)
    DEFENDER_PATROL_INTERVAL: 3.0, // seconds between patrol heading changes
    DEFENDER_PATROL_INTERVAL_SPREAD: 2.0, // patrol interval jitter (seconds)
    AIM_DEADZONE: 0.08, // turret/hull aim tolerance (radians) before steering

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

    // ── Gamepad ────────────────────────────────────────────
    GAMEPAD_STICK_DEADZONE: 0.35, // left-stick deflection needed to register a direction
    GAMEPAD_TRIGGER_THRESHOLD: 0.35, // analogue LT/RT pull needed to rotate the turret
};
