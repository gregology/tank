/**
 * Default vehicle behaviour — direct-fire ground vehicles (tank, and the
 * base for every other behaviour).  Tanks and IFVs share the `fire` and
 * `move` hooks; the IFV overrides only the AI aim strategy (see ifv.js).
 *
 * A behaviour is a plain strategy object with five hooks, dispatched by
 * js/vehicles/index.js from the `vehicleType`:
 *
 *   fire(game, tank, device, dt)      per-frame firing/attack
 *   move(tank, device, dt, map)       per-frame movement (rotation, turret,
 *                                     drive) — the entity delegates here
 *   update(game, tank, dt)            per-frame component update
 *   aim(ai, me, target, map)          AI turret-aim strategy
 *   aiThink(ai, dt, me, enemies, map, objective)
 *                                     AI think-level dispatch; returns true
 *                                     when it consumed the whole think
 *
 * The shared movement primitives (`rotateHull`, `rotateTurret`, `drive`,
 * `animateTread`) are exported so other behaviours (drone flies, SPG
 * locks its drive while charging, squad digs in) can reuse them rather
 * than re-deriving rotation/turret/tread logic.
 */

import { bestTarget } from "../ai/targeting.js";
import { ACTIONS, CONFIG, VEHICLES } from "../config.js";
import { spawnBullet } from "../shoot.js";
import { normalizeAngle } from "../utils.js";

/* ── shared movement primitives ───────────────────────────── */

/** Binary/analog action magnitude: 0–1 from analog devices, 0/1 otherwise. */
function actionAmount(device, action) {
    return typeof device.analog === "function" ? device.analog(action) : device.isDown(action) ? 1 : 0;
}

/** True if a world point is inside the map bounds (for flying units). */
function inMapBounds(wx, wy, map) {
    return wx > 0.5 && wx < map.width - 0.5 && wy > 0.5 && wy < map.height - 0.5;
}

/**
 * Rotate the hull toward the left/right inputs.  A disabled track only
 * allows pivoting in the other direction; `freeRotation` (air units)
 * ignores track damage.  Returns whether the hull is rotating this frame
 * (drives the tread animation).
 */
export function rotateHull(tank, device, dt, freeRotation = false) {
    const v = VEHICLES[tank.vehicleType];
    const turnL = actionAmount(device, ACTIONS.left);
    const turnR = actionAmount(device, ACTIONS.right);
    const canLeft = freeRotation || !tank.rightTrackDisabled;
    const canRight = freeRotation || !tank.leftTrackDisabled;
    if (turnL > 0 && canLeft) tank.angle -= v.rotationSpeed * turnL * dt;
    if (turnR > 0 && canRight) tank.angle += v.rotationSpeed * turnR * dt;
    tank.angle = normalizeAngle(tank.angle);
    return (turnL > 0 && canLeft) || (turnR > 0 && canRight);
}

/** Rotate the turret offset; fixed turrets stay aligned with the hull. */
export function rotateTurret(tank, device, dt) {
    const v = VEHICLES[tank.vehicleType];
    if (v.turret === "fixed") {
        tank.turretAngle = 0;
        return;
    }
    if (tank.turretDisabled) return;
    const turrL = actionAmount(device, ACTIONS.turretLeft);
    const turrR = actionAmount(device, ACTIONS.turretRight);
    if (turrL > 0) tank.turretAngle -= v.turretSpeed * turrL * dt;
    if (turrR > 0) tank.turretAngle += v.turretSpeed * turrR * dt;
    tank.turretAngle = normalizeAngle(tank.turretAngle);
}

/**
 * Drive forward/reverse when `canDrive` (each behaviour decides its own
 * lock — track damage, SPG charge, squad dig-in).  Ground units slide
 * along obstacles via `map.canStand`; air units fly over everything and
 * only check map bounds.
 */
export function drive(tank, device, dt, map, canDrive = true) {
    const v = VEHICLES[tank.vehicleType];
    const flying = tank.flies;
    let move = 0;
    if (canDrive) {
        if (device.isDown(ACTIONS.forward)) move = 1;
        if (device.isDown(ACTIONS.backward)) move = -CONFIG.TANK_REVERSE_FACTOR;
    }
    if (move === 0) return;

    const speed = v.speed * move;
    const nx = tank.x + Math.cos(tank.angle) * speed * dt;
    const ny = tank.y + Math.sin(tank.angle) * speed * dt;
    if (flying) {
        if (inMapBounds(nx, tank.y, map)) tank.x = nx;
        if (inMapBounds(tank.x, ny, map)) tank.y = ny;
    } else {
        if (map.canStand(nx, tank.y, tank.size)) tank.x = nx;
        if (map.canStand(tank.x, ny, tank.size)) tank.y = ny;
    }
}

/** Scroll the tread animation while moving or rotating in place. */
export function animateTread(tank, dt, oldX, oldY, rotating) {
    const dx = tank.x - oldX,
        dy = tank.y - oldY;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.0001 || rotating) {
        tank.treadPhase = (tank.treadPhase + Math.max(dist * 6, rotating ? dt * 2.5 : 0)) % 1;
    }
}

/** Full ground-vehicle move: rotate hull, rotate turret, drive, tread. */
export function groundMove(tank, device, dt, map, canDrive) {
    const oldX = tank.x,
        oldY = tank.y;
    const rotating = rotateHull(tank, device, dt);
    rotateTurret(tank, device, dt);
    drive(tank, device, dt, map, canDrive);
    animateTread(tank, dt, oldX, oldY, rotating);
}

/**
 * Immobilised pivot: the tracks are destroyed, so the vehicle can't move —
 * rotate the hull toward the nearest threat (or the objective) and keep
 * firing.  Shared by the ground vehicles via the base `tank` behaviour.
 */
export function thinkImmobilised(ai, _dt, me, enemies, map, objective) {
    const bestEnemy = bestTarget(ai, me, enemies);
    let target = null;

    if (bestEnemy && bestEnemy.dist < 15) {
        target = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
    } else if (objective) {
        const d = Math.hypot(objective.x - me.x, objective.y - me.y);
        target = { x: objective.x, y: objective.y, dist: d };
    } else if (bestEnemy) {
        target = { x: bestEnemy.target.x, y: bestEnemy.target.y, dist: bestEnemy.dist };
    }

    if (!target) return;

    // Rotate the hull toward the target (since we can't drive).
    const desired = Math.atan2(target.y - me.y, target.x - me.x);
    let diff = desired - me.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (diff > 0.08) ai.keys[ACTIONS.right] = true;
    if (diff < -0.08) ai.keys[ACTIONS.left] = true;

    // Also aim the turret if it is functional.
    ai.aimAndFire(me, target, map);
}

export const tank = {
    /** Create this vehicle's per-instance components (no-op for the base). */
    init(_tank) {},

    fire(game, tank, device, _dt) {
        if (!device.isDown(ACTIONS.fire) || !tank.canFire()) return;
        tank.fire();
        const fireAngle = tank.turretWorld;
        const vStats = VEHICLES[tank.vehicleType];
        const b = spawnBullet(game, {
            x: tank.x,
            y: tank.y,
            angle: fireAngle,
            owner: tank.playerNumber,
            team: tank.team,
            damage: vStats.bulletDamage,
            speed: vStats.bulletSpeed,
            flash: vStats.muzzleFlash ?? "muzzle",
            flashOffset: CONFIG.TANK_BARREL_LENGTH,
        });
        game.emit("fire", { tank, bullet: b });
    },

    /** Ground movement: tracks lock the drive but still allow pivoting. */
    move(tank, device, dt, map) {
        groundMove(tank, device, dt, map, !tank.trackDamaged);
    },

    update(_game, _tank, _dt) {},

    /**
     * Standard turret aiming: steer the independent turret (or the hull
     * when the turret is disabled), then fire when aimed and LOS is
     * clear; otherwise shoot destructible terrain in front.
     */
    aim(ai, me, target, map) {
        const desiredWorld = Math.atan2(target.y - me.y, target.x - me.x);

        if (me.turretDisabled) {
            let diff = desiredWorld - me.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (diff > 0.08) ai.keys[ACTIONS.right] = true;
            if (diff < -0.08) ai.keys[ACTIONS.left] = true;

            if (Math.abs(diff) > 0.3) return;
        } else {
            ai.steerTurretTo(me, desiredWorld);

            const turretWorld = me.turretWorld;
            let diff = desiredWorld - turretWorld;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.3) return;
        }

        if (ai.fireDelay > 0) return;

        if (map.hasLineOfSight(me.x, me.y, target.x, target.y)) {
            ai.keys[ACTIONS.fire] = true;
            ai.fireDelay = 0.25 + ai.rng() * 0.35;
            return;
        }

        ai.tryShootWall(me, map);
    },

    aiThink(ai, dt, me, enemies, map, objective) {
        if (!me.trackDamaged) return false;
        thinkImmobilised(ai, dt, me, enemies, map, objective);
        return true;
    },
};
