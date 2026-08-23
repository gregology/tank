/**
 * Damage models — the damage *rules* behind one `resolveDamage` interface.
 *
 * Durability *numbers* live in config (`VEHICLES[].armour`,
 * `BASE_STRUCTURES[].hp`); these model objects own the rule chains that
 * turn an incoming hit into a result:
 *
 *   armour   directional hit zones + subsystem knock-out (non-squad vehicles)
 *   members  one soldier dies per whole point of damage (squads)
 *   hp       a plain pool that decrements to zero (base structures)
 *
 * Adding a new damage model (shield, damage-over-time, armour-piercing) is a
 * new object here plus a `damageModel` key on the entity's config — not a new
 * branch in `Tank` or `BaseStructure`.
 */

import { VEHICLES } from "./config.js";

/**
 * Extra side-effects beyond marking a subsystem disabled, keyed by the
 * subsystem name the armour table declares.  A new subsystem with a
 * knock-out effect (e.g. engine → speed cut, radio → vision loss) is one
 * entry here — no new `if` in the rule chain.
 */
const SUBSYSTEM_EFFECTS = {
    turret: (entity) => {
        entity.turretAngle = 0; // locked forward
    },
};

/** Disable the subsystem for a hit zone (data-driven from the armour table). */
function applySubsystem(entity, armour, zone) {
    const sub = armour.subsystems?.[zone];
    if (!sub?.subsystem) return;
    entity.disabledSubsystems.add(sub.subsystem);
    SUBSYSTEM_EFFECTS[sub.subsystem]?.(entity);
}

/* ── model objects ────────────────────────────────────────── */

/** Directional armour: rear instant-kill, subsystem knock-out, HP threshold. */
const armour = {
    resolve(entity, zone, damage) {
        const def = VEHICLES[entity.vehicleType].armour;

        // Rear instant kill (full-damage hit, e.g. ammo rack detonation).
        if (def.rearInstantKill && zone === "rear" && damage >= 1.0) {
            entity.kill();
            return "destroyed";
        }

        // Already past the subsystem phase + full-damage hit → kill.
        if (entity.damaged && def.subsystemThreshold != null && damage >= 1.0) {
            entity.kill();
            return "destroyed";
        }

        entity.damageAccum += damage;

        // Total damage exceeds HP → destroy.
        if (entity.damageAccum >= def.hp) {
            entity.kill();
            return "destroyed";
        }

        // First time accumulated damage crosses the subsystem threshold.
        if (def.subsystemThreshold != null && !entity.damaged && entity.damageAccum >= def.subsystemThreshold) {
            // Rear zone at threshold → kill (accumulated small-arms to rear).
            if (def.rearInstantKill && zone === "rear") {
                entity.kill();
                return "destroyed";
            }
            entity.damaged = true;
            applySubsystem(entity, def, zone);
            return "damaged";
        }

        return "absorbed";
    },
};

/** Squad members: each whole point kills the next soldier (fractional carry). */
const members = {
    resolve(entity, _zone, damage) {
        const result = entity.squad.applyDamage(damage);
        if (result === "destroyed") entity.kill();
        return result;
    },
};

/** Plain HP pool (base structures). */
const hp = {
    resolve(entity, _zone, damage) {
        if (!entity.alive) return "absorbed";
        entity.hp -= damage;
        if (entity.hp <= 0) {
            entity.hp = 0;
            entity.alive = false;
            return "destroyed";
        }
        return "absorbed";
    },
};

export const DAMAGE_MODELS = { armour, members, hp };

/**
 * Apply a hit through the entity's own damage model.
 * @returns {"destroyed" | "damaged" | "absorbed"}
 */
export function resolveDamage(entity, zone, damage) {
    return (DAMAGE_MODELS[entity.damageModel] ?? hp).resolve(entity, zone, damage);
}
