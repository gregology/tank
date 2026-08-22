/**
 * Per-vehicle-type stats and squad member definitions.
 *
 * Every gameplay value that varies between vehicle types lives here.
 * The game reads VEHICLES[tank.vehicleType] at runtime — adding a new
 * vehicle is just a new entry in this table.
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
 *   damageModel      which damage rule set applies ("armour" | "members";
 *                    see js/damage.js)
 *   hp               total damage required to destroy the vehicle
 *   subsystemThreshold  accumulated damage at which the first subsystem
 *                       is knocked out (null = no subsystem phase, damage
 *                       goes straight to destruction)
 *   rearInstantKill  if true, a full-damage (>=1.0) rear hit kills
 *                    instantly regardless of remaining HP
 *   subsystems       map of hit-zone name -> subsystem name:
 *                       "turret"     (front: locks the turret forward)
 *                       "leftTrack"  / "rightTrack"  (side hits)
 *                    Zones not listed deal damage but disable nothing.
 *
 * The applyHit() method in tank.js reads this table generically --
 * adding a new vehicle or tweaking durability is purely a config change.
 *
 * Interaction capabilities (read by js/tank.js, js/collision.js, and the
 * render layer) are independent flags, not one class string:
 *   flies      true for air units (fly over terrain and other units).
 *   soft       true for soft targets (driven through by enemy vehicles).
 *   crushable  true for units that can be run over.
 *   canCrush   true for ground vehicles that run over crushable units.
 *   hasSquad   true for infantry that owns a Squad component.
 * Behaviour fields (consumed by js/vehicles/, js/modes.js, ai.js, audio.js):
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
        flies: false,
        soft: false,
        crushable: false,
        canCrush: true,
        turret: "independent",
        hudGlyph: "\u25C6",
        minimapShape: "square",
        speed: 3.0,
        rotationSpeed: 3.5,
        turretSpeed: 2.0,
        size: 0.45,
        bulletSpeed: 9.0,
        bulletDamage: 3.0,
        bulletCooldown: 0.45,
        displayArmour: 2,
        spawnWeight: 3,
        cameraLookAhead: 3.5,
        roleWeights: { cavalry: 3, sniper: 2, defender: 1, scout: 1 },
        targetPriority: { spg: 10, tank: 10, drone: 0, ifv: 2, squad: 8, baseTower: 10, baseHQ: 10 },
        armour: {
            damageModel: "armour",
            hp: 6,
            subsystemThreshold: 3,
            rearInstantKill: true,
            subsystems: {
                front: { subsystem: "turret" },
                side_left: { subsystem: "leftTrack" },
                side_right: { subsystem: "rightTrack" },
            },
        },
    },
    ifv: {
        flies: false,
        soft: false,
        crushable: false,
        canCrush: true,
        turret: "fixed",
        hudGlyph: "\u25C7",
        minimapShape: "diamond",
        muzzleFlash: "ifvFlash",
        tracer: true,
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
        targetPriority: { tank: 2, drone: 10, ifv: 3, squad: 8, baseWall: 3, baseHQ: 10 },
        armour: {
            damageModel: "armour",
            hp: 3,
            subsystemThreshold: 2,
            rearInstantKill: false,
            subsystems: {
                side_left: { subsystem: "leftTrack" },
                side_right: { subsystem: "rightTrack" },
            },
        },
    },
    drone: {
        flies: true,
        soft: false,
        crushable: false,
        canCrush: false,
        turret: "fixed",
        hudGlyph: "\u2716",
        minimapShape: "cross",
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
        targetPriority: { spg: 10, drone: 0, ifv: 2, squad: 7, baseWall: 0, baseTower: 0, baseHQ: 10 },
        armour: {
            damageModel: "armour",
            hp: 0.1,
            subsystemThreshold: null,
            rearInstantKill: false,
            subsystems: {},
        },
    },
    spg: {
        flies: false,
        soft: false,
        crushable: false,
        canCrush: true,
        turret: "independent",
        hudGlyph: "\u25B2",
        minimapShape: "triangle",
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
        targetPriority: { tank: 0, drone: 0, ifv: 0, squad: 3, baseWall: 0, baseTower: 10, baseHQ: 10 },
        armour: {
            damageModel: "armour",
            hp: 3,
            subsystemThreshold: 2,
            rearInstantKill: true,
            subsystems: {
                front: { subsystem: "turret" },
                side_left: { subsystem: "leftTrack" },
                side_right: { subsystem: "rightTrack" },
            },
        },
    },
    squad: {
        flies: false,
        soft: true,
        crushable: true,
        canCrush: false,
        hasSquad: true,
        turret: "fixed",
        hudGlyph: "\u25CF",
        minimapShape: "dot",
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
        displayDamage: 1.0,
        displayFireRate: 6,
        spawnWeight: 3,
        cameraLookAhead: 2.0,
        // Squads are never defenders — they advance/flank under cover.
        roleWeights: { cavalry: 3, sniper: 0, defender: 0, scout: 3 },
        targetPriority: { spg: 8, tank: 6, squad: 6, baseWall: 8, baseTower: 8, baseHQ: 8 },
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
            damageModel: "members",
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
        sound: "rifle",
        muzzleFlash: "ifvFlash",
        tracer: true,
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
        sound: "rifle",
        muzzleFlash: "ifvFlash",
        tracer: true,
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
        sound: "rpg",
        muzzleFlash: "ifvFlash",
        tracer: true,
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
        sound: "shotgun",
        muzzleFlash: "ifvFlash",
        tracer: true,
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
