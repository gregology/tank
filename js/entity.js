/**
 * Game entity hierarchy.
 *
 * All interactive game objects inherit from GameEntity, giving
 * targeting, damage, collision, and rendering a single interface.
 *
 * Hierarchy:
 *   GameEntity
 *     ├── Tank  (vehicle — tank, IFV, drone, SPG)      ← tank.js
 *     └── BaseStructure (baseWall / baseTower / baseHQ, data-driven
 *                        from BASE_STRUCTURES)          ← this file
 *
 * Base is a compound container (not an entity itself) that holds
 * one team's HQ, walls, and watch towers.
 */

import { BASE_STRUCTURES } from "./config.js";
import { resolveDamage } from "./damage.js";
import { distance } from "./utils.js";

/* ═══════════════════════════════════════════════════════════ *
 *  GameEntity — root of the hierarchy                         *
 * ═══════════════════════════════════════════════════════════ */

export class GameEntity {
    constructor(entityType, team = 0, color = "", darkColor = "") {
        this.entityType = entityType;
        this.x = 0;
        this.y = 0;
        this.team = team;
        this.color = color;
        this.darkColor = darkColor;
        this.alive = true;
    }

    /** Key for targetPriority look-ups. */
    get targetType() {
        return this.entityType;
    }
    get targetable() {
        return true;
    }
    get collidable() {
        return false;
    }
    get mobile() {
        return false;
    }
    get isShooter() {
        return false;
    }
    get isVehicle() {
        return false;
    }
    get isStructure() {
        return false;
    }
    get size() {
        return 0.45;
    }
    /** Distance from a world point to the entity's hitbox centre. */
    distanceToPoint(x, y) {
        return distance(x, y, this.x, this.y);
    }
    /** Radius used for AoE falloff (a vehicle/structure's collision size). */
    get hitRadius() {
        return this.size;
    }
    get flies() {
        return false;
    }
    get softTarget() {
        return false;
    }
    get crushable() {
        return false;
    }
    get canCrush() {
        return false;
    }
    /** Incoming damage multiplier after cover/dig-in (1 = no reduction). */
    incomingDamageMultiplier(_map) {
        return 1;
    }
}

/* ═══════════════════════════════════════════════════════════ *
 *  BaseStructure                                              *
 * ═══════════════════════════════════════════════════════════ */

export class BaseStructure extends GameEntity {
    constructor(entityType, team, color, darkColor) {
        super(entityType, team, color, darkColor);
        const cfg = BASE_STRUCTURES[entityType];
        this.hp = cfg.hp;
        this.maxHp = cfg.hp;
        this.tilePositions = [];
        if (cfg.isShooter) {
            this.fireCooldown = 0;
            this.turretAngle = 0;
        }
    }

    get isStructure() {
        return true;
    }
    get collidable() {
        return true;
    }
    get isShooter() {
        return BASE_STRUCTURES[this.entityType].isShooter ?? false;
    }
    get size() {
        return BASE_STRUCTURES[this.entityType].size;
    }
    get damageFraction() {
        return this.maxHp > 0 ? this.hp / this.maxHp : 0;
    }

    /** Which damage model resolves hits (a plain HP pool). */
    get damageModel() {
        return "hp";
    }

    applyDamage(amount) {
        return resolveDamage(this, null, amount);
    }
}

/* ═══════════════════════════════════════════════════════════ *
 *  Base — compound container                                  *
 * ═══════════════════════════════════════════════════════════ */

export class Base {
    constructor(team, color, darkColor) {
        this.team = team;
        this.color = color;
        this.darkColor = darkColor;
        this.hq = null;
        this.walls = [];
        this.towers = [];
        this.center = { x: 0, y: 0 };
        this.origin = { x: 0, y: 0 };
        this.entranceDir = "E";
        this.compoundSize = 10;
    }

    get allStructures() {
        const out = [...this.walls, ...this.towers];
        if (this.hq) out.push(this.hq);
        return out;
    }

    get alive() {
        return this.hq?.alive ?? false;
    }

    get x() {
        return this.hq?.x ?? this.center.x;
    }
    get y() {
        return this.hq?.y ?? this.center.y;
    }
}
