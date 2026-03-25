/**
 * Central configuration for the entire game.
 * Tweak values here to tune gameplay, visuals, and controls.
 */

export const TILES = {
    DEEP_WATER:    0,
    SHALLOW_WATER: 1,
    SAND:          2,
    GRASS:         3,
    DARK_GRASS:    4,
    HILL:          5,
    ROCK:          6,
};

export const CONFIG = {
    // ── Display ──────────────────────────────────────────────
    TILE_WIDTH:  64,
    TILE_HEIGHT: 32,
    TILE_DEPTH:  20,          // pixel height of elevated tiles

    // ── Map ──────────────────────────────────────────────────
    MAP_WIDTH:  64,
    MAP_HEIGHT: 64,

    // ── Tank ─────────────────────────────────────────────────
    TANK_SPEED:          3.0, // world-units / second
    TANK_REVERSE_FACTOR: 0.4, // backward speed multiplier
    TANK_ROTATION_SPEED: 3.5, // radians / second
    TANK_SIZE:           0.35,// collision radius in world-units
    TANK_BODY_HALF:      0.28,// visual half-size for the iso diamond
    TANK_BODY_HEIGHT:    5,   // pixel height of the 3-D body box
    TANK_BARREL_LENGTH:  0.48,// barrel length in world-units
    TANK_BARREL_WIDTH:   3,   // barrel stroke width in pixels
    TANK_RESPAWN_TIME:   2.0, // seconds before respawn

    // ── Bullet ───────────────────────────────────────────────
    BULLET_SPEED:    9.0,
    BULLET_RADIUS:   3,       // screen-pixel radius
    BULLET_COOLDOWN: 0.45,
    BULLET_LIFETIME: 3.0,

    // ── Particles ────────────────────────────────────────────
    MAX_PARTICLES: 300,

    // ── Scoring ──────────────────────────────────────────────
    WIN_SCORE: 10,

    // ── Controls ─────────────────────────────────────────────
    PLAYER1_KEYS: {
        forward:  'KeyW',
        backward: 'KeyS',
        left:     'KeyA',
        right:    'KeyD',
        fire:     'Space',
    },
    PLAYER2_KEYS: {
        forward:  'ArrowUp',
        backward: 'ArrowDown',
        left:     'ArrowLeft',
        right:    'ArrowRight',
        fire:     'Enter',
    },
};
