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
import { GameEntity } from "./entity.js";
import { Squad } from "./squad.js";
import { distance } from "./utils.js";
import { getVehicleBehaviour } from "./vehicles/index.js";

/* ── Hit zone constants ───────────────────────────────────── */

export const HIT_ZONE = {
    FRONT: "front",
    SIDE_LEFT: "side_left",
    SIDE_RIGHT: "side_right",
    REAR: "rear",
};

/* ── Subsystem key → Tank property mapping ────────────────── */

const SUBSYSTEM_PROPS = {
    turret: "turretDisabled",
    leftTrack: "leftTrackDisabled",
    rightTrack: "rightTrackDisabled",
};

export class Tank extends GameEntity {
    constructor(playerNumber, color, darkColor) {
        super("tank", 0, color, darkColor); // team set by Game later
        this.playerNumber = playerNumber;

        // Hull / turret rotation
        this.angle = 0; // hull angle (radians – 0 = east in world space)
        this.turretAngle = 0; // turret offset from hull (0 = aligned with hull)

        // Vehicle type
        this.vehicleType = "tank"; // 'tank', 'ifv', 'drone', 'spg', 'squad'

        // Gameplay
        this.score = 0;
        this.fireCooldown = 0;
        this.respawnTimer = 0;

        // Subsystem damage (set by the data-driven applyHit)
        this.damaged = false; // true after subsystem threshold crossed
        this.damageAccum = 0; // accumulated damage (unified HP pool)
        this.turretDisabled = false; // front hit: can't rotate turret
        this.leftTrackDisabled = false; // left-side hit: can't drive straight
        this.rightTrackDisabled = false; // right-side hit: can't drive straight

        // SPG charge state
        this.chargeTime = 0; // seconds fire button has been held
        this.isCharging = false; // true while holding fire to charge range

        // Squad component (lazily created for infantry units)
        this._squad = null;

        // Visual feedback
        this.flashTimer = 0; // invulnerability flash after respawn
        this.recoilTimer = 0; // barrel recoil animation
        this.treadPhase = 0; // 0–1 tread scroll offset (animated)
        this.smokeTimer = 0; // damage smoke emitter cooldown
    }

    /** World-space angle the turret is pointing. */
    get turretWorld() {
        return this.angle + this.turretAngle;
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
     * infantry vehicles; null otherwise.  Lazily created on first access.
     */
    get squad() {
        if (VEHICLES[this.vehicleType].unitClass !== "infantry") return null;
        if (!this._squad) this._squad = new Squad(this);
        return this._squad;
    }

    /** Whether the squad is fully dug in (proxy into the component). */
    get dugIn() {
        return this.squad?.dugIn ?? false;
    }

    /** Fraction of HP remaining (1.0 = full, 0.0 = destroyed). */
    get hpFraction() {
        if (this.squad) return this.squad.hpFraction;
        const armour = VEHICLES[this.vehicleType].armour;
        return Math.max(0, 1 - this.damageAccum / armour.hp);
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

    /* ── interaction capabilities (data-driven from unitClass) ── */

    /** Air units fly over terrain and other units. */
    get flies() {
        return VEHICLES[this.vehicleType].unitClass === "air";
    }
    /** Infantry is soft against enemy vehicles (run-over), but solid to friendlies. */
    get softTarget() {
        return VEHICLES[this.vehicleType].unitClass === "infantry";
    }
    /** Exposed soldiers can be run over (dug-in squads are protected). */
    get crushable() {
        return this.squad?.isCrushable ?? false;
    }
    /** Ground vehicles crush exposed infantry. */
    get canCrush() {
        return VEHICLES[this.vehicleType].unitClass === "vehicle";
    }
    /** Incoming damage multiplier after cover/dig-in (1 = no reduction). */
    incomingDamageMultiplier(map) {
        if (!this.alive || !this.squad) return 1;
        return this.squad.damageMultiplier(map);
    }

    /* ── distributed-hitbox capabilities (squads use member positions) ── */

    /** Distance from a world point to the vehicle's hitbox (squads use their nearest member). */
    distanceToPoint(x, y) {
        if (this.squad) {
            const d = this.squad.nearestMemberDistance(x, y);
            if (Number.isFinite(d)) return d;
        }
        return distance(x, y, this.x, this.y);
    }

    /** Radius used for AoE falloff: squads use their soldier radius. */
    get hitRadius() {
        return this.squad ? VEHICLES.squad.soldierRadius : this.size;
    }

    /** True if a point is inside the vehicle's hitbox (squads check each member). */
    hitTest(x, y) {
        if (this.squad) return this.squad.bulletHit(x, y);
        return distance(x, y, this.x, this.y) < this.size;
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
        // Squads use their explicit member damage model (see Squad).
        if (this.squad) {
            const result = this.squad.applyDamage(damage);
            if (result === "destroyed") this.kill();
            return result;
        }

        const armour = VEHICLES[this.vehicleType].armour;

        // ── Rear instant kill (full-damage hit, e.g. ammo rack detonation)
        if (armour.rearInstantKill && zone === HIT_ZONE.REAR && damage >= 1.0) {
            this.kill();
            return "destroyed";
        }

        // ── Already past subsystem phase + full-damage hit → kill
        if (this.damaged && armour.subsystemThreshold != null && damage >= 1.0) {
            this.kill();
            return "destroyed";
        }

        // ── Accumulate damage
        this.damageAccum += damage;

        // ── Destruction: total damage exceeds HP
        if (this.damageAccum >= armour.hp) {
            this.kill();
            return "destroyed";
        }

        // ── Subsystem trigger (first time accumulated damage crosses threshold)
        if (armour.subsystemThreshold != null && !this.damaged && this.damageAccum >= armour.subsystemThreshold) {
            // Rear zone at threshold → kill (accumulated small-arms to rear)
            if (armour.rearInstantKill && zone === HIT_ZONE.REAR) {
                this.kill();
                return "destroyed";
            }

            this.damaged = true;
            this._applySubsystem(armour, zone);
            return "damaged";
        }

        return "absorbed";
    }

    /**
     * Activate the subsystem effect for the given hit zone.
     * Reads the armour.subsystems map to decide what to disable.
     */
    _applySubsystem(armour, zone) {
        const key = armour.subsystems[zone];
        if (!key) return; // zone has no subsystem mapping — damage only

        const prop = SUBSYSTEM_PROPS[key];
        if (prop) {
            this[prop] = true;
        }

        // Side-effect: lock turret forward when turret is disabled
        if (key === "turret") {
            this.turretAngle = 0;
        }
    }

    /* ── death / respawn ──────────────────────────────────── */

    kill() {
        this.alive = false;
        this.respawnTimer = CONFIG.TANK_RESPAWN_TIME;
        this.chargeTime = 0;
        this.isCharging = false;
    }

    respawnAt(x, y) {
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.turretAngle = 0; // turret starts aligned with hull

        // Clear charge state
        this.chargeTime = 0;
        this.isCharging = false;

        // Discard the squad component — a fresh one is created lazily on
        // next access (which also resets members, dig-in, and cooldowns).
        this._squad = null;

        // Clear all damage
        this.damaged = false;
        this.damageAccum = 0;
        this.turretDisabled = false;
        this.leftTrackDisabled = false;
        this.rightTrackDisabled = false;
    }
}
