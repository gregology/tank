/**
 * Tank entity – handles movement, rotation, firing cooldown, and respawn.
 *
 * Movement model:  W/↑ = drive forward in the direction the tank faces,
 * S/↓ = reverse (slower), A/← and D/→ = rotate hull in place.
 * Q/E and ,/. = rotate turret relative to the hull (slower than hull).
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
 */

import { CONFIG, VEHICLES } from "./config.js";
import { GameEntity } from "./entity.js";
import { normalizeAngle } from "./utils.js";

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
        this.vehicleType = "tank"; // 'tank', 'ifv', 'drone', 'spg'

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

    /** True if the gun fires only forward (IFV, drone, or disabled turret). */
    get fixedGun() {
        return this.vehicleType === "ifv" || this.vehicleType === "drone" || this.turretDisabled;
    }

    /** Collision radius — varies by vehicle type. */
    get size() {
        return VEHICLES[this.vehicleType].size;
    }

    /** Fraction of HP remaining (1.0 = full, 0.0 = destroyed). */
    get hpFraction() {
        const armour = VEHICLES[this.vehicleType].armour;
        return Math.max(0, 1 - this.damageAccum / armour.hp);
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
        return this.vehicleType !== "drone";
    }

    /* ── per-frame update ─────────────────────────────────── */

    update(dt, input, keyMap, map) {
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

        const oldX = this.x,
            oldY = this.y;
        const isIFV = this.vehicleType === "ifv";
        const isDrone = this.vehicleType === "drone";

        // ── Hull rotation
        // If a track is disabled, can only pivot in the direction
        // of the working track (left track out → can only turn right,
        // right track out → can only turn left).
        // Drones have no tracks — always free to rotate.
        const canRotateLeft = isDrone || !this.rightTrackDisabled;
        const canRotateRight = isDrone || !this.leftTrackDisabled;

        const rotSpeed = VEHICLES[this.vehicleType].rotationSpeed;

        const rotating = (input.isDown(keyMap.left) && canRotateLeft) || (input.isDown(keyMap.right) && canRotateRight);
        if (input.isDown(keyMap.left) && canRotateLeft) this.angle -= rotSpeed * dt;
        if (input.isDown(keyMap.right) && canRotateRight) this.angle += rotSpeed * dt;
        this.angle = normalizeAngle(this.angle);

        // ── Turret rotation (relative to hull, slower)
        // IFV/Drone: turret is fixed forward (always 0)
        // Disabled by front hit on tanks
        if (isIFV || isDrone) {
            this.turretAngle = 0;
        } else if (!this.turretDisabled) {
            const turretSpd = VEHICLES[this.vehicleType].turretSpeed;
            if (input.isDown(keyMap.turretLeft)) this.turretAngle -= turretSpd * dt;
            if (input.isDown(keyMap.turretRight)) this.turretAngle += turretSpd * dt;
            this.turretAngle = normalizeAngle(this.turretAngle);
        }

        // ── Forward / reverse
        // Disabled if any track is damaged (can only pivot).
        // Drones always fly freely.
        // SPGs cannot drive while charging (deployed).
        let move = 0;
        if (isDrone || !this.trackDamaged) {
            if (this.isCharging) {
                // SPG is deployed — no movement
            } else {
                if (input.isDown(keyMap.forward)) move = 1;
                if (input.isDown(keyMap.backward)) move = -CONFIG.TANK_REVERSE_FACTOR;
            }
        }

        if (move !== 0) {
            const baseSpeed = VEHICLES[this.vehicleType].speed;
            const speed = baseSpeed * move;
            const nx = this.x + Math.cos(this.angle) * speed * dt;
            const ny = this.y + Math.sin(this.angle) * speed * dt;

            if (isDrone) {
                // Drones fly over all terrain — only check map bounds
                if (this._canFly(nx, this.y, map)) this.x = nx;
                if (this._canFly(this.x, ny, map)) this.y = ny;
            } else {
                // Slide along obstacles – try each axis independently
                if (this._canOccupy(nx, this.y, map)) this.x = nx;
                if (this._canOccupy(this.x, ny, map)) this.y = ny;
            }
        }

        // ── Tread animation (scrolls when moving or rotating in place)
        const dx = this.x - oldX,
            dy = this.y - oldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.0001 || rotating) {
            this.treadPhase = (this.treadPhase + Math.max(dist * 6, rotating ? dt * 2.5 : 0)) % 1;
        }
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

        // Clear all damage
        this.damaged = false;
        this.damageAccum = 0;
        this.turretDisabled = false;
        this.leftTrackDisabled = false;
        this.rightTrackDisabled = false;
    }

    /* ── collision helper ─────────────────────────────────── */

    _canOccupy(wx, wy, map) {
        const s = VEHICLES[this.vehicleType].size * 0.85;
        return (
            map.isPassable(wx - s, wy - s) &&
            map.isPassable(wx + s, wy - s) &&
            map.isPassable(wx - s, wy + s) &&
            map.isPassable(wx + s, wy + s)
        );
    }

    /** Drones fly over everything — only check map bounds. */
    _canFly(wx, wy, map) {
        return wx > 0.5 && wx < map.width - 0.5 && wy > 0.5 && wy < map.height - 0.5;
    }
}
