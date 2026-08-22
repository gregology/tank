import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASE_STRUCTURES, Base, BaseStructure, GameEntity } from "./helpers.js";

describe("GameEntity – base class defaults", () => {
    it("has correct default properties", () => {
        const e = new GameEntity("test", 1, "#f00", "#800");
        assert.equal(e.entityType, "test");
        assert.equal(e.targetType, "test");
        assert.equal(e.team, 1);
        assert.equal(e.color, "#f00");
        assert.equal(e.darkColor, "#800");
        assert.equal(e.alive, true);
        assert.equal(e.x, 0);
        assert.equal(e.y, 0);
    });

    it("returns correct capability flags", () => {
        const e = new GameEntity("test");
        assert.equal(e.targetable, true);
        assert.equal(e.collidable, false);
        assert.equal(e.mobile, false);
        assert.equal(e.isShooter, false);
        assert.equal(e.isVehicle, false);
        assert.equal(e.isStructure, false);
        assert.equal(e.size, 0.45);
    });
});

describe("BaseStructure – wall", () => {
    it("has correct type and HP", () => {
        const w = new BaseStructure("baseWall", 1, "#f00", "#800");
        assert.equal(w.entityType, "baseWall");
        assert.equal(w.targetType, "baseWall");
        assert.equal(w.isStructure, true);
        assert.equal(w.collidable, true);
        assert.equal(w.hp, BASE_STRUCTURES.baseWall.hp);
        assert.equal(w.maxHp, BASE_STRUCTURES.baseWall.hp);
        assert.equal(w.size, BASE_STRUCTURES.baseWall.size);
    });

    it("damageFraction decreases with damage", () => {
        const w = new BaseStructure("baseWall", 1, "#f00", "#800");
        assert.equal(w.damageFraction, 1);
        w.applyDamage(1);
        assert.ok(w.damageFraction < 1);
        assert.ok(w.damageFraction > 0);
    });

    it('applyDamage returns "destroyed" when destroyed', () => {
        const w = new BaseStructure("baseWall", 1, "#f00", "#800");
        assert.equal(w.applyDamage(w.hp), "destroyed");
        assert.equal(w.alive, false);
    });

    it('applyDamage returns "absorbed" when still alive', () => {
        const w = new BaseStructure("baseWall", 1, "#f00", "#800");
        assert.equal(w.applyDamage(0.5), "absorbed");
        assert.equal(w.alive, true);
    });
});

describe("BaseStructure – HQ", () => {
    it("has correct type and HP", () => {
        const hq = new BaseStructure("baseHQ", 1, "#f00", "#800");
        assert.equal(hq.entityType, "baseHQ");
        assert.equal(hq.isStructure, true);
        assert.equal(hq.hp, BASE_STRUCTURES.baseHQ.hp);
    });
});

describe("BaseStructure – watch tower", () => {
    it("has correct type and shooting capability", () => {
        const t = new BaseStructure("baseTower", 1, "#f00", "#800");
        assert.equal(t.entityType, "baseTower");
        assert.equal(t.isShooter, true);
        assert.equal(t.isStructure, true);
        assert.equal(t.fireCooldown, 0);
        assert.equal(t.turretAngle, 0);
    });

    it("walls and HQ are not shooters", () => {
        assert.equal(new BaseStructure("baseWall", 1, "#f00", "#800").isShooter, false);
        assert.equal(new BaseStructure("baseHQ", 1, "#f00", "#800").isShooter, false);
    });
});

describe("Base – compound container", () => {
    it("alive delegates to HQ", () => {
        const b = new Base(1, "#f00", "#800");
        const hq = new BaseStructure("baseHQ", 1, "#f00", "#800");
        hq.x = 5;
        hq.y = 5;
        b.hq = hq;
        assert.equal(b.alive, true);
        assert.equal(b.x, 5);
        assert.equal(b.y, 5);
        hq.alive = false;
        assert.equal(b.alive, false);
    });

    it("allStructures includes all parts", () => {
        const b = new Base(1, "#f00", "#800");
        b.hq = new BaseStructure("baseHQ", 1, "#f00", "#800");
        b.walls.push(new BaseStructure("baseWall", 1, "#f00", "#800"));
        b.towers.push(new BaseStructure("baseTower", 1, "#f00", "#800"));
        assert.equal(b.allStructures.length, 3);
    });

    it("x/y fallback to center when no HQ", () => {
        const b = new Base(1, "#f00", "#800");
        b.center = { x: 10, y: 20 };
        assert.equal(b.x, 10);
        assert.equal(b.y, 20);
    });
});
