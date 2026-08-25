/**
 * Tank entity – a generic vehicle shell: identity, armour, timers, and
 * the shared movement/aiming *data* (angle, turret offset, position).
 *
 * Movement and firing are delegated to the vehicle behaviour strategy
 * (js/vehicles/) via `getVehicleBehaviour(this.vehicleType)` — `update()`
 * ticks the generic timers then calls the behaviour's `move` hook, and
 * `game.js` dispatches firing to the behaviour's `fire` hook.  The entity
 * itself never branches on vehicle type.
 *
 * turretAngle is an OFFSET from the hull angle.  0 = turret faces
 * the same direction as the hull.  The world-space turret direction
 * is  angle + turretAngle.  When the hull rotates, the turret rotates
 * with it automatically.
 *
 * Directional armour (data-driven — see VEHICLES[type].armour):
 *   Each vehicle type declares its own armour profile in config.js:
 *     hp               — total damage to destroy
 *     subsystemThreshold — damage at which first subsystem is disabled
 *     rearInstantKill  — full-damage rear hit = instant kill
 *     subsystems       — maps hit-zone → subsystem key
 *
 *   applyHit() reads this table generically — no vehicle-specific
 *   branching.  Adding a new vehicle or changing durability is purely
 *   a config change.
 *
 * Vehicle types:
 *   - 'tank'  — independent turret, 2 HP, subsystems at 1 HP
 *   - 'ifv'   — fixed forward gun, 4 HP, track subsystems at 2 HP
 *   - 'drone' — FPV kamikaze, 0.25 HP (one tower shot kills), no subsystems
 *   - 'spg'   — hold-to-charge artillery, 5 HP, subsystems at 2 HP
 *   - 'squad' — 5-man infantry squad, one HP per member, auto-fires
 *               (see js/vehicles/squad.js); members drop as it takes
 *               damage and it can dig in / use building cover
 */

import { CONFIG, VEHICLES } from "./config.js";
import { resolveDamage } from "./damage.js";
import { GameEntity } from "./entity.js";
import { distance } from "./utils.js";
import { getVehicleBehaviour } from "./vehicles/index.js";

/* ── Hit zone constants ───────────────────────────────────── */

export const HIT_ZONE = {
    FRONT: "front",
    SIDE_LEFT: "side_left",
    SIDE_RIGHT: "side_right",
    REAR: "rear",
};

/** Single-point body: the default hitbox/hp surface for a non-squad vehicle. */
function singleBody(tank) {
    return {
        distanceToPoint(x, y) {
            return distance(x, y, tank.x, tank.y);
        },
        get hitRadius() {
            return tank.size;
        },
        hitTest(x, y) {
            return distance(x, y, tank.x, tank.y) < tank.size;
        },
        get hpFraction() {
            const armour = VEHICLES[tank.vehicleType].armour;
            return Math.max(0, 1 - tank.damageAccum / armour.hp);
        },
    };
}

export class Tank extends GameEntity {
    constructor(playerNumber, color, darkColor) {
        super("tank", 0, color, darkColor); // team set by Game later
        this.playerNumber = playerNumber;

        // Hull / turret rotation
        this.angle = 0; // hull angle (radians – 0 = east in world space)
        this.turretAngle = 0; // turret offset from hull (0 = aligned with hull)

        // Vehicle type — the setter clears per-vehicle components and lets
        // the behaviour's `init` hook create them (squad, SPG charge).
        this.vehicleType = "tank"; // 'tank', 'ifv', 'drone', 'spg', 'squad'

        // Gameplay
        this.score = 0;
        this.fireCooldown = 0;
        this.respawnTimer = 0;

        // Subsystem damage (set by the data-driven applyHit)
        this.damaged = false; // true after subsystem threshold crossed
        this.damageAccum = 0; // accumulated damage (unified HP pool)
        /** Knocked-out subsystems ("turret" / "leftTrack" / "rightTrack"). */
        this.disabledSubsystems = new Set();

        // Swarm state (read by the pheromone system in js/systems/swarm.js)
        this.lastHitAt = null; // game time of the last hit taken (alarm signal)
        this.distanceTravelled = 0; // this life — scales trail deposit strength
        this.recentSpeed = 0; // smoothed tiles/sec (convoy leadership requires motion)
        this.convoyLeadable = false; // stamped per tick by the swarm system
        this.underAttack = false; // stamped per tick: recently hit (alarm source)

        // Visual feedback
        this.flashTimer = 0; // invulnerability flash after respawn
        this.recoilTimer = 0; // barrel recoil animation
        this.treadPhase = 0; // 0–1 tread scroll offset (animated)
        this.smokeTimer = 0; // damage smoke emitter cooldown
    }

    /* ── vehicle type + per-vehicle components ───────────── */

    /** Vehicle type key (tank / ifv / drone / spg / squad). */
    get vehicleType() {
        return this._vehicleType;
    }

    /**
     * Assign the vehicle type.  The setter drops any per-vehicle components
     * from the previous type and calls the new behaviour's `init` hook to
     * create the ones it needs (squad component, SPG charge) — the entity
     * never branches on type.
     */
    set vehicleType(type) {
        this._vehicleType = type;
        this._initVehicleComponents();
    }

    /** A named per-vehicle component (null when this vehicle has none). */
    component(name) {
        return this.components.get(name) ?? null;
    }

    /** SPG hold-to-charge state (owned by the spg behaviour); null otherwise. */
    get charge() {
        return this.component("charge");
    }

    /** The physical body (single-point, or the squad when one exists). */
    get body() {
        return this.components.get("body");
    }

    /** Recreate this vehicle's components at its current position. */
    _initVehicleComponents() {
        this.components = new Map();
        this.components.set("body", singleBody(this));
        getVehicleBehaviour(this._vehicleType).init?.(this);
    }

    /** World-space angle the turret is pointing. */
    get turretWorld() {
        return this.angle + this.turretAngle;
    }

    /** True if a subsystem has been knocked out (see VEHICLES[].armour.subsystems). */
    subsystemDisabled(name) {
        return this.disabledSubsystems.has(name);
    }

    /** Front hit disabled the turret (can't rotate it). */
    get turretDisabled() {
        return this.subsystemDisabled("turret");
    }
    /** Left-side hit disabled the left track (can't drive straight). */
    get leftTrackDisabled() {
        return this.subsystemDisabled("leftTrack");
    }
    /** Right-side hit disabled the right track (can't drive straight). */
    get rightTrackDisabled() {
        return this.subsystemDisabled("rightTrack");
    }

    /** True if any track is disabled (can only pivot). */
    get trackDamaged() {
        return this.leftTrackDisabled || this.rightTrackDisabled;
    }

    /** True if the gun fires only forward (fixed-turret vehicles, or a disabled turret). */
    get fixedGun() {
        return this.turretDisabled || VEHICLES[this.vehicleType].turret === "fixed";
    }

    /** Collision radius — varies by vehicle type. */
    get size() {
        return VEHICLES[this.vehicleType].size;
    }

    /**
     * The squad component (soldiers, dig-in state machine, damage) for
     * infantry vehicles; null otherwise.  Created and owned by the squad
     * behaviour's `init` hook — the entity only stores it.
     */
    get squad() {
        return this.component("squad");
    }

    /** Fraction of HP remaining (1.0 = full, 0.0 = destroyed) — delegated to the body. */
    get hpFraction() {
        return this.body.hpFraction;
    }

    /** Number of squad members still alive (0 for non-squad vehicles). */
    get membersAlive() {
        return this.squad?.membersAlive ?? 0;
    }

    /** Alive squad member objects ({type, x, y, ...}) in canonical order. */
    get aliveMembers() {
        return this.squad?.aliveMembers ?? [];
    }

    /* ── GameEntity capability overrides ──────────────────── */

    get targetType() {
        return this.vehicleType;
    }
    get isVehicle() {
        return true;
    }
    get collidable() {
        return true;
    }
    get mobile() {
        return true;
    }
    get isShooter() {
        return VEHICLES[this.vehicleType].firesBullets !== false;
    }

    /* ── interaction capabilities (data-driven flags) ── */

    /** Air units fly over terrain and other units. */
    get flies() {
        return VEHICLES[this.vehicleType].flies;
    }
    /** Infantry is soft against enemy vehicles (run-over), but solid to friendlies. */
    get softTarget() {
        return VEHICLES[this.vehicleType].soft;
    }
    /** Exposed soldiers can be run over (dug-in squads are protected). */
    get crushable() {
        return VEHICLES[this.vehicleType].crushable && (this.squad?.isCrushable ?? false);
    }
    /** Ground vehicles crush exposed infantry. */
    get canCrush() {
        return VEHICLES[this.vehicleType].canCrush;
    }
    /** Chargeable vehicles hold fire to charge a ranged (arcing) shot. */
    get chargeable() {
        return VEHICLES[this.vehicleType].chargeRate != null;
    }
    /** Incoming damage multiplier after cover/dig-in (1 = no reduction). */
    incomingDamageMultiplier(map) {
        if (!this.alive || !this.squad) return 1;
        return this.squad.damageMultiplier(map);
    }

    /** Which damage model resolves hits (armour vs squad members). */
    get damageModel() {
        return VEHICLES[this.vehicleType].armour.damageModel ?? "armour";
    }

    /* ── body delegation (single-point by default, multi-member for squads) ── */

    /** Distance from a world point to the vehicle's hitbox (delegated to the body). */
    distanceToPoint(x, y) {
        return this.body.distanceToPoint(x, y);
    }

    /** Radius used for AoE falloff (delegated to the body). */
    get hitRadius() {
        return this.body.hitRadius;
    }

    /** True if a point is inside the vehicle's hitbox (delegated to the body). */
    hitTest(x, y) {
        return this.body.hitTest(x, y);
    }

    /** Index of the first crushable soldier under `vehicle`, or -1. */
    crushedMemberBy(vehicle) {
        return this.squad?.crushedMemberBy(vehicle) ?? -1;
    }

    /** Crush one soldier; returns true if the squad was destroyed. */
    crushMember(index) {
        return this.squad ? this.squad.crushMember(index) : false;
    }

    /* ── per-frame update ─────────────────────────────────── */

    /**
     * Tick the generic entity timers, then delegate movement to the
     * vehicle behaviour (js/vehicles/).  Each behaviour's `move` hook owns
     * how the vehicle rotates, aims the turret, and drives — the entity
     * no longer branches on vehicle type here.
     */
    update(dt, device, map) {
        // Tick timers even when dead (respawn countdown)
        if (!this.alive) {
            this.respawnTimer -= dt;
            if (this.respawnTimer <= 0) {
                this.alive = true;
                this.flashTimer = 1.0; // 1 s of invuln-flash
            }
            return;
        }

        if (this.flashTimer > 0) this.flashTimer -= dt;
        if (this.fireCooldown > 0) this.fireCooldown -= dt;
        if (this.recoilTimer > 0) this.recoilTimer -= dt;

        getVehicleBehaviour(this.vehicleType).move(this, device, dt, map);
    }

    /* ── firing ───────────────────────────────────────────── */

    canFire() {
        return this.alive && this.fireCooldown <= 0;
    }

    fire() {
        this.fireCooldown = VEHICLES[this.vehicleType].bulletCooldown;
        this.recoilTimer = 0.1;
    }

    /* ── directional damage ───────────────────────────────── */

    /**
     * Determine which zone a bullet hit based on the bearing from the
     * tank centre to the bullet contact point, relative to the tank's
     * hull facing direction.
     *
     * @param {number} bx  bullet world X
     * @param {number} by  bullet world Y
     * @returns {string}  one of HIT_ZONE values
     */
    getHitZone(bx, by) {
        const bearing = Math.atan2(by - this.y, bx - this.x) - this.angle;
        // Normalize to [-PI, PI]
        let b = bearing % (Math.PI * 2);
        if (b > Math.PI) b -= Math.PI * 2;
        if (b < -Math.PI) b += Math.PI * 2;

        const abs = Math.abs(b);
        if (abs <= CONFIG.HIT_FRONT_ARC) return HIT_ZONE.FRONT;
        if (abs >= Math.PI - CONFIG.HIT_REAR_ARC) return HIT_ZONE.REAR;
        return b < 0 ? HIT_ZONE.SIDE_LEFT : HIT_ZONE.SIDE_RIGHT;
    }

    /**
     * Apply a hit to this vehicle.  Behaviour is entirely data-driven
     * by the armour profile in VEHICLES[vehicleType].armour.
     *
     * @param {string} zone    one of HIT_ZONE values
     * @param {number} damage  damage amount (1.0 = tank shell, 0.25 = IFV burst, 0.1 = tower)
     * @returns {string}  'damaged'   — subsystem knocked out (first time)
     *                     'destroyed' — vehicle killed
     *                     'absorbed'  — damage counted but no state change yet
     */
    applyHit(zone, damage = 1.0) {
        return resolveDamage(this, zone, damage);
    }

    /* ── death / respawn ──────────────────────────────────── */

    kill() {
        this.alive = false;
        this.respawnTimer = CONFIG.TANK_RESPAWN_TIME;
    }

    /** A destroyed tank credits the kill to the source's faction. */
    onDestroyed(game, source) {
        game.mode.onKill(game, source.team, this);
    }

    respawnAt(x, y, rng = Math.random) {
        this.x = x;
        this.y = y;
        this.angle = rng() * Math.PI * 2;
        this.turretAngle = 0; // turret starts aligned with hull

        // Clear all damage
        this.damaged = false;
        this.damageAccum = 0;
        this.disabledSubsystems.clear();

        // A fresh life: no alarm history, no travelled route
        this.lastHitAt = null;
        this.distanceTravelled = 0;
        this.recentSpeed = 0;
        this.convoyLeadable = false;
        this.underAttack = false;

        // Recreate per-vehicle components (squad members, SPG charge) at
        // the new spawn position — the behaviour owns their state.
        this._initVehicleComponents();
    }
}
