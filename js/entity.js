/**
 * Game entity hierarchy.
 *
 * All interactive game objects inherit from GameEntity, giving
 * targeting, damage, collision, and rendering a single interface.
 *
 * Hierarchy:
 *   GameEntity
 *     ├── Tank  (vehicle — tank, IFV, drone, SPG)      ← tank.js
 *     └── BaseStructure
 *         ├── BaseWall        1×1 fortification wall
 *         ├── BaseHQ          1×2 command tent
 *         └── BaseWatchTower  1×1 armed guard tower
 *
 * Base is a compound container (not an entity itself) that holds
 * one team's HQ, walls, and watch towers.
 */

import { BASE_STRUCTURES } from "./config.js";

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
    }

    get isStructure() {
        return true;
    }
    get collidable() {
        return true;
    }
    get size() {
        return BASE_STRUCTURES[this.entityType].size;
    }
    get damageFraction() {
        return this.maxHp > 0 ? this.hp / this.maxHp : 0;
    }

    applyDamage(amount) {
        if (!this.alive) return false;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            return true;
        }
        return false;
    }
}

/* ── Concrete types ───────────────────────────────────────── */

export class BaseWall extends BaseStructure {
    constructor(team, color, darkColor) {
        super("baseWall", team, color, darkColor);
    }
}

export class BaseHQ extends BaseStructure {
    constructor(team, color, darkColor) {
        super("baseHQ", team, color, darkColor);
    }
}

export class BaseWatchTower extends BaseStructure {
    constructor(team, color, darkColor) {
        super("baseTower", team, color, darkColor);
        this.fireCooldown = 0;
        this.turretAngle = 0;
    }

    get isShooter() {
        return true;
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
