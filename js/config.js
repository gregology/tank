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

    // ── Gamepad ────────────────────────────────────────────
    GAMEPAD_STICK_DEADZONE: 0.35, // left-stick deflection needed to register a direction
    GAMEPAD_TRIGGER_THRESHOLD: 0.35, // analogue LT/RT pull needed to rotate the turret
};

/* ═══════════════════════════════════════════════════════════ *
 *  Players & colours                                          *
 * ═══════════════════════════════════════════════════════════ */

/** Maximum number of simultaneous local human players. */
export const MAX_PLAYERS = 4;

/**
 * Player colours in join order (P1 = index 0, P2 = index 1, …).
 *
 * A colour is a *team* colour, not a fixed identity: in Skirmish each
 * player defaults to their own colour and may join another player's
 * team by adopting its colour; in Battle teams are fixed RED (0) /
 * BLUE (1).  A player's `P1`…`P4` label is fixed by join order and is
 * used only for HUD identity.
 */
export const PLAYER_COLORS = [
    { color: "#cc3333", darkColor: "#882222", label: "RED" },
    { color: "#3366dd", darkColor: "#223399", label: "BLUE" },
    { color: "#3bb54a", darkColor: "#2a8035", label: "GREEN" },
    { color: "#e8a020", darkColor: "#a5711a", label: "AMBER" },
];

/**
 * Input action vocabulary — the single source of truth shared by input
 * devices (keyboard / gamepad), the AI controller, and gameplay code.
 *
 * `left` / `right` are shared between steering and menu navigation;
 * `up` / `down` are menu-only (a gamepad's face buttons drive
 * `forward`/`backward` but never menu navigation).
 */
export const ACTIONS = Object.freeze({
    forward: "forward",
    backward: "backward",
    left: "left",
    right: "right",
    turretLeft: "turretLeft",
    turretRight: "turretRight",
    fire: "fire",
    up: "up",
    down: "down",
    confirm: "confirm",
    back: "back",
    cycleTeam: "cycleTeam",
});

/* ═══════════════════════════════════════════════════════════ *
 *  Game types                                                 *
 * ═══════════════════════════════════════════════════════════ */

/**
 * Game type definitions.
 *
 * Each type describes the shared match rules; *who* is human vs bot is
 * decided at match time by the lobby (see the MatchConfig built by
 * Game), so a game type is a small, stable declaration rather than an
 * exhaustive list of compositions:
 *
 *   win:      'score' — first faction to WIN_SCORE kills (Skirmish)
 *             'base'  — destroy the enemy HQ (Battle)
 *   teamSet:  'players' — up to MAX_PLAYERS teams, one per colour (Skirmish)
 *             'two'     — fixed RED vs BLUE (Battle)
 *   bases:    whether tower/HQ compounds are built
 *   vehicles: allowed vehicle type keys from VEHICLES
 *   options:  GAME_OPTIONS keys shown on the pre-game screen
 *   defaults: optional per-type option default indices/values
 */
export const GAME_TYPES = {
    skirmish: {
        win: "score",
        teamSet: "players",
        bases: false,
        vehicles: ["tank"],
        options: ["mapSize", "buildingDensity"],
        defaults: { mapSize: 0 },
    },
    battle: {
        win: "base",
        teamSet: "two",
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg", "squad"],
        options: ["mapSize", "buildingDensity", "baseType", "teamSize"],
    },
};

/* ═══════════════════════════════════════════════════════════ *
 *  Pre-game options                                           *
 *                                                             *
 *  GAME_OPTIONS       — master list of every option, defined  *
 *                       once with type, labels, and defaults  *
 *  GAME_TYPES[].options — which options each game type shows  *
 *  resolveSettings()  — merge defaults + user overrides into  *
 *                       a flat object with concrete values    *
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
            { label: "Medium (128\u00d7128)", value: { w: 128, h: 128 } },
            { label: "Large  (192\u00d7192)", value: { w: 192, h: 192 } },
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
        max: 32,
        maxByMapSize: [16, 24, 32],
        step: 1,
        default: 5,
    },
];

/** Look up an option definition by key. */
function _optionDef(key) {
    return GAME_OPTIONS.find((o) => o.key === key);
}

/**
 * Build the initial option indices/values for a game type, merging:
 *   1. global GAME_OPTIONS defaults
 *   2. per-type GAME_TYPES[gameType].defaults overrides
 *
 * Returns a Map<string, number> where:
 *   enum  options → current choice index
 *   range options → current numeric value
 */
export function getDefaultOptionValues(gameType) {
    const def = GAME_TYPES[gameType];
    const keys = def?.options ?? [];
    const typeDefaults = def?.defaults ?? {};
    const values = new Map();

    for (const key of keys) {
        const opt = _optionDef(key);
        if (!opt) continue;
        if (key in typeDefaults) {
            values.set(key, typeDefaults[key]);
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
    // Clamp teamSize to the per-map-size maximum
    const tsOpt = _optionDef("teamSize");
    if (tsOpt?.maxByMapSize && settings.teamSize != null) {
        const msIdx = optionValues.get("mapSize") ?? 0;
        const cap = tsOpt.maxByMapSize[msIdx] ?? tsOpt.max;
        if (settings.teamSize > cap) settings.teamSize = cap;
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
 *
 * Behaviour fields (consumed by js/vehicles/, js/modes.js, ai.js, audio.js):
 *   unitClass    "vehicle" (ground vehicles: run over infantry, pushed by
 *                 structures), "infantry" (soft against enemy vehicles),
 *                 or "air" (flies over everything, no separation).
 *   turret       "independent" (aims independently of the hull) or "fixed"
 *                 (fires straight ahead — the fixedGun capability).
 *   firesBullets false only for vehicles whose "fire" detonates instead of
 *                 shooting (drone).  Defaults to true.
 *   muzzleFlash  which muzzle-flash particle a direct fire uses: default
 *                 "muzzle", or "ifv" for the autocannon flash.
 *   fireSound    sound key used by audio.js when this vehicle fires:
 *                 "tank" (default), "ifv", or "spg".
 */
export const VEHICLES = {
    tank: {
        unitClass: "vehicle",
        turret: "independent",
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
        targetPriority: { spg: 10, tank: 10, drone: 0, ifv: 2, squad: 8, baseWall: 5, baseTower: 10, baseHQ: 10 },
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
        unitClass: "vehicle",
        turret: "fixed",
        muzzleFlash: "ifv",
        fireSound: "ifv",
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
        targetPriority: { spg: 5, tank: 2, drone: 10, ifv: 3, squad: 8, baseWall: 3, baseTower: 5, baseHQ: 10 },
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
        unitClass: "air",
        turret: "fixed",
        firesBullets: false,
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
        targetPriority: { spg: 10, tank: 5, drone: 0, ifv: 2, squad: 7, baseWall: 0, baseTower: 0, baseHQ: 10 },
        armour: {
            hp: 0.1,
            subsystemThreshold: null,
            rearInstantKill: false,
            subsystems: {},
        },
    },
    spg: {
        unitClass: "vehicle",
        turret: "independent",
        fireSound: "spg",
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
        targetPriority: { spg: 5, tank: 0, drone: 0, ifv: 0, squad: 3, baseWall: 0, baseTower: 10, baseHQ: 10 },
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
    squad: {
        unitClass: "infantry",
        turret: "fixed",
        speed: 2.6,
        rotationSpeed: 4.0,
        turretSpeed: 0,
        size: 0.4,
        // Squad members fire their own weapons (see SQUAD_MEMBERS);
        // these single-shot fields are unused but keep the VEHICLES
        // shape uniform for pickVehicleType / menu stat bars.
        bulletSpeed: 0,
        bulletDamage: 0,
        bulletCooldown: 0,
        spawnWeight: 3,
        cameraLookAhead: 2.0,
        // Squads are never defenders — they advance/flank under cover.
        roleWeights: { cavalry: 3, sniper: 0, defender: 0, scout: 3 },
        targetPriority: { spg: 8, tank: 6, ifv: 5, drone: 3, squad: 6, baseWall: 8, baseTower: 8, baseHQ: 8 },
        // Cover/dig-in damage model (see Squad.damageMultiplier):
        //  coverReduction  — incoming damage multiplier while adjacent to
        //                    an intact building (mechanical cover)
        //  digInReduction  — incoming damage multiplier while dug in
        //  maxDamageReduction — cap on the combined reduction
        coverRadius: 1.2,
        coverReduction: 0.5,
        digInReduction: 0.4,
        maxDamageReduction: 0.7,
        // Member simulation (see js/formation.js and js/squad.js):
        //  soldierRadius    — per-member radius for bullet/AoE hit tests
        //  memberSpeed      — member steering max speed (>= leader speed)
        //  formationSpacing — minimum separation between members
        //  wallAffinity     — 0..1 bias pulling members toward buildings
        //  digInTime        — seconds to dig in (immobile + no fire)
        soldierRadius: 0.22,
        memberSpeed: 3.5,
        formationSpacing: 0.4,
        wallAffinity: 0.5,
        digInTime: 1.0,
        armour: {
            hp: 5, // one HP per soldier — member damage handled by Squad
            subsystemThreshold: null,
            rearInstantKill: false,
            subsystems: {},
        },
    },
};

/**
 * Infantry squad member definitions.
 *
 * A squad is a single Tank entity, but each alive member auto-targets
 * and auto-fires independently using these per-weapon stats.  Members
 * fire at `primaryTargets` when any are in range/LOS; otherwise they
 * fall back to `fallbackTargets` (plinking at `fallbackDamage`).
 *
 * `pellets` + `spread` turn a weapon into a shotgun-style burst
 * (used by the counter-drone member to hit the small, fast drone).
 */
export const SQUAD_MEMBERS = {
    rifleman: {
        weapon: "rifle",
        range: 6,
        cooldown: 0.5,
        bulletSpeed: 11,
        damage: 0.12,
        primaryTargets: ["squad"],
        fallbackTargets: ["tank", "ifv", "spg"],
        fallbackDamage: 0.04,
    },
    mg: {
        weapon: "mg",
        range: 7,
        cooldown: 0.16,
        bulletSpeed: 12,
        damage: 0.1,
        primaryTargets: ["squad"],
        fallbackTargets: ["tank", "ifv", "spg"],
        fallbackDamage: 0.05,
    },
    rpg: {
        weapon: "rpg",
        range: 9,
        cooldown: 2.0,
        bulletSpeed: 8,
        damage: 1.0,
        primaryTargets: ["tank", "ifv", "spg", "baseWall", "baseTower", "baseHQ"],
        fallbackTargets: [],
        fallbackDamage: 0,
    },
    shotgun: {
        weapon: "shotgun",
        range: 3.5,
        cooldown: 0.8,
        bulletSpeed: 10,
        damage: 0.3, // one pellet kills a drone (0.1 HP)
        pellets: 5,
        spread: 0.6, // total cone width in radians
        primaryTargets: ["drone"],
        fallbackTargets: ["squad"],
        fallbackDamage: 0.3,
    },
};

/**
 * Canonical squad member death order.  The first entry dies first and
 * the last survives longest, so the squad's specialist capability
 * (RPG anti-armour, shotgun anti-drone) is the last thing it loses.
 */
export const SQUAD_ATTENTION_ORDER = ["rifleman", "rifleman", "mg", "rpg", "shotgun"];

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
        targetPriority: { spg: 3, tank: 3, drone: 10, ifv: 3, squad: 5 },
    },
    baseHQ: {
        hp: 20,
        size: 0.5,
        visHeight: 14,
    },
};
