/**
 * Flat gameplay constants.  Tweak values here to tune gameplay, visuals,
 * and controls.  Optimizer-tuned values land in js/config/tuning.js and
 * are applied over these defaults (see the bottom of this file).
 */
import { applyOverrides } from "./overrides.js";
import { TUNING_OVERRIDES } from "./tuning.js";

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

    // ── AI combat ranges ─────────────────────────────────────
    OBJECTIVE_ENGAGE_RANGE: 25, // fire at the objective when this close
    ENGAGE_RANGE: 10, // bots fire at enemies this close while navigating
    IMMOBILISED_ENGAGE_RANGE: 15, // immobilised vehicles pivot toward enemies this close
    AIM_DEADZONE: 0.08, // turret/hull aim tolerance (radians) before steering
    OBJECTIVE_DISCOVERY_RANGE: 12, // sight range at which a unit discovers an enemy objective (with LOS)

    // ── Pheromone signal fields (js/ai/signals.js) ───────────
    SIGNAL_MAX: 20, // per-tile field cap (additive channels)
    SIGNAL_HALFLIVES: { recruit: 3.8817, trail: 15.0699, alarm: 1.5, food: 2 }, // seconds to halve
    SIGNAL_ALARM_TIME: 4, // seconds a hit unit keeps broadcasting alarm
    SIGNAL_ALARM_STRENGTH: 3.2721, // alarm deposit rate while broadcasting
    SIGNAL_FOOD_STRENGTH: 8, // food-beacon deposit rate at a known objective
    SIGNAL_HUMAN_EMIT: 2, // human-driven vehicles emit stronger recruitment (convoy leaders)
    SIGNAL_TRAIL_DISTANCE_FACTOR: 0.0073, // trail strength falloff per world-unit travelled

    // ── Swarm arbitration (js/ai/arbitration.js) ─────────────
    SIGNAL_SENSE_RADIUS: 8, // how far a bot scans for trail/food signal
    SIGNAL_SENSE_MIN: 0.05, // field value below which signal is ignored
    SIGNAL_ALARM_RESPONSE_RADIUS: 10, // how far a bot travels to answer an alarm
    CONVOY_JOIN_RANGE: 9.2333, // how far a follower looks for a convoy leader
    CONVOY_EMIT_MARGIN: 1.05, // a leader must out-emit the follower by this factor
    CONVOY_SPACING: 1.2, // world-units between queued convoy vehicles
    CONVOY_FLANK_OFFSET: 1.6, // perpendicular offset for flanking vehicles
    EXPLORE_RADIUS: 14.6112, // how far exploration candidates are sampled
    EXPLORE_SAMPLES: 6, // candidate points scored per exploration pick
    EXPLORE_INTERVAL: 2.0646, // seconds between exploration goal picks
    EXPLORE_VENTURE_WEIGHT: 0.2271, // exploration pull per world-unit away from the home anchor
    DIRECT_STEER_RANGE: 4, // goals closer than this (with a walkable line) skip A* and steer direct
    CONVOY_CROWD_LIMIT: 4.7589, // local recruit field above which convoy-joining is suppressed

    // ── Particles ────────────────────────────────────────────
    MAX_PARTICLES: 300,

    // ── Scoring ──────────────────────────────────────────────
    WIN_SCORE: 10,

    // ── Gamepad ────────────────────────────────────────────
    GAMEPAD_STICK_DEADZONE: 0.35, // left-stick deflection needed to register a direction
    GAMEPAD_TRIGGER_THRESHOLD: 0.35, // analogue LT/RT pull needed to rotate the turret
};

applyOverrides(CONFIG, TUNING_OVERRIDES.CONFIG);
