/**
 * Squad behaviour — an infantry squad that auto-fires per member.
 *
 * Each alive member targets and fires independently from its own
 * position (see pickSquadTarget); FIRE drives the dig-in state machine
 * (roaming → diggingIn → dugIn → roaming) for humans, and the AI
 * decides to dig in when enemies are close and building cover exists.
 *
 * The per-frame component update (dig-in timer + formation steering)
 * is driven through the `update` hook; squad members never aim with
 * the turret (no-op `aim`) and never fire arcing shells.
 */

import { ACTIONS, SQUAD_MEMBERS } from "../config.js";
import { flashMuzzle, spawnBullet } from "../shoot.js";
import { pickSquadTarget } from "../squad.js";
import { animateTread, drive, rotateHull, rotateTurret } from "./tank.js";

/** Fire one member's weapon at a target.  Shotguns fire a pellet spread. */
function fireMemberAt(game, squad, memberPos, weapon, target) {
    const e = target.entity;
    const angle = Math.atan2(e.y - memberPos.y, e.x - memberPos.x);
    const dmg = target.isFallback ? (weapon.fallbackDamage ?? weapon.damage) : weapon.damage;
    // Bullet lifetime = time to fly the member's range (+ margin),
    // giving squad weapons a hard range limit.
    const lifetime = weapon.bulletSpeed > 0 ? weapon.range / weapon.bulletSpeed + 0.15 : null;

    const pellets = weapon.pellets ?? 1;
    const spread = weapon.spread ?? 0;
    for (let p = 0; p < pellets; p++) {
        const a = pellets > 1 ? angle - spread / 2 + (spread * p) / (pellets - 1) : angle;
        spawnBullet(game, {
            x: memberPos.x,
            y: memberPos.y,
            angle: a,
            owner: squad.playerNumber,
            team: squad.team,
            damage: dmg,
            speed: weapon.bulletSpeed,
            lifetime,
        });
    }

    // Muzzle flash + event (the weapon tag drives the sound)
    flashMuzzle(game, "ifv", memberPos.x + Math.cos(angle) * 0.3, memberPos.y + Math.sin(angle) * 0.3, angle);
    game.emit("fire", { tank: squad, bullet: game.bullets[game.bullets.length - 1], weapon: weapon.weapon });
}

export const squad = {
    fire(game, squad, device, dt) {
        if (!squad.alive || !squad.squad) return;
        const component = squad.squad;

        // Dig-in toggle — humans have edge detection; bots manage dig-in in AI.
        if (typeof device.wasPressed === "function" && device.wasPressed(ACTIONS.fire)) {
            if (component.digIn.state === "roaming") component.startDigIn();
            else if (component.digIn.state === "diggingIn") component.cancelDigIn();
            else component.standUp();
        }

        // No firing while performing the dig-in transition.
        if (!component.canFire) return;

        // Pre-filtered candidates: alive, enemy-team tanks + structures.
        const candidates = [
            ...game.allTanks.filter((t) => t.alive && t.team !== squad.team),
            ...game.baseStructures.filter((s) => s.alive && s.team !== squad.team),
        ];
        const hasLOS = (x1, y1, x2, y2) => game.map.hasLineOfSight(x1, y1, x2, y2, { skipOrigin: true });

        for (const m of component.aliveMembers) {
            const weapon = SQUAD_MEMBERS[m.type];
            if (!weapon) continue;

            m.cooldown -= dt;
            if (m.cooldown > 0) continue;

            const target = pickSquadTarget(m, weapon, candidates, hasLOS);
            if (!target) continue;

            // Set the cooldown (dug-in squads fire 25% faster)
            let cooldown = weapon.cooldown;
            if (component.dugIn) cooldown *= 0.8;
            m.cooldown = cooldown;

            fireMemberAt(game, squad, m, weapon, target);
        }
    },

    /** Infantry movement: movement keys cancel dig-in; immobile while digging in / dug in. */
    move(tank, device, dt, map) {
        const component = tank.squad;
        if (component?.digIn.state === "diggingIn") {
            if (device.isDown(ACTIONS.forward) || device.isDown(ACTIONS.backward)) {
                component.cancelDigIn();
            }
        }
        const oldX = tank.x,
            oldY = tank.y;
        const rotating = rotateHull(tank, device, dt);
        rotateTurret(tank, device, dt);
        drive(tank, device, dt, map, !component || component.canMove);
        animateTread(tank, dt, oldX, oldY, rotating);
    },

    update(game, tank, dt) {
        if (tank.squad) tank.squad.update(dt, game.map);
    },

    aim(_ai, _me, _target, _map) {},

    aiThink(ai, _dt, me, enemies, map, _objective) {
        ai.updateSquadDigIn(me, enemies, map);
        if (me.squad.digIn.state !== "roaming") {
            // Digging in / dug in: hold position (auto-fire is handled by
            // the game) and clear stuck state so standing still doesn't
            // trigger the "blow through a wall" escape behaviour.
            ai.holdPosition();
            return true;
        }
        return false;
    },
};
