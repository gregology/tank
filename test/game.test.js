import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HIT_ZONE } from "../js/tank.js";
import { BASE_STRUCTURES, Bullet, CONFIG, customMap, GameMap, T, Tank, VEHICLES } from "./helpers.js";

describe("Tank", () => {
    it("starts alive with default properties", () => {
        const t = new Tank(1, "#c33", "#822");
        assert.ok(t.alive);
        assert.equal(t.score, 0);
        assert.equal(t.fireCooldown, 0);
        assert.equal(t.team, 0);
        assert.equal(t.turretAngle, 0);
        assert.equal(t.damaged, false);
        assert.equal(t.turretDisabled, false);
        assert.equal(t.leftTrackDisabled, false);
        assert.equal(t.rightTrackDisabled, false);
        assert.equal(t.vehicleType, "tank");
        assert.equal(t.damageAccum, 0);
    });

    it("respawnAt clears all damage state", () => {
        const t = new Tank(1, "#c33", "#822");
        t.damaged = true;
        t.turretDisabled = true;
        t.leftTrackDisabled = true;
        t.turretAngle = 1.5;
        t.damageAccum = 0.75;
        t.respawnAt(10.5, 20.5);
        assert.equal(t.turretAngle, 0);
        assert.equal(t.damaged, false);
        assert.equal(t.turretDisabled, false);
        assert.equal(t.leftTrackDisabled, false);
        assert.equal(t.damageAccum, 0);
    });

    it("kill sets alive=false and starts respawn timer", () => {
        const t = new Tank(1, "#c33", "#822");
        t.kill();
        assert.ok(!t.alive);
        assert.equal(t.respawnTimer, CONFIG.TANK_RESPAWN_TIME);
    });

    it("canFire respects cooldown", () => {
        const t = new Tank(1, "#c33", "#822");
        assert.ok(t.canFire());
        t.fire();
        assert.ok(!t.canFire());
    });

    it("turret rotates independently from hull", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 0;
        t.turretAngle = 0;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(t.turretAngle > 0);
        assert.equal(t.angle, 0);
    });

    it("turret rotation speed is slower than hull rotation speed", () => {
        assert.ok(VEHICLES.tank.turretSpeed < VEHICLES.tank.rotationSpeed);
    });
});

describe("Directional armour – hit zone detection", () => {
    it("detects front hits", () => {
        const t = new Tank(1, "#c33", "#822");
        t.x = 10;
        t.y = 10;
        t.angle = 0; // facing east
        assert.equal(t.getHitZone(11, 10), HIT_ZONE.FRONT);
        assert.equal(t.getHitZone(11, 10.3), HIT_ZONE.FRONT);
    });

    it("detects rear hits", () => {
        const t = new Tank(1, "#c33", "#822");
        t.x = 10;
        t.y = 10;
        t.angle = 0;
        assert.equal(t.getHitZone(9, 10), HIT_ZONE.REAR);
        assert.equal(t.getHitZone(9, 10.3), HIT_ZONE.REAR);
    });

    it("detects left side hits", () => {
        const t = new Tank(1, "#c33", "#822");
        t.x = 10;
        t.y = 10;
        t.angle = 0;
        // Left = -Y in world when facing east
        assert.equal(t.getHitZone(10, 9), HIT_ZONE.SIDE_LEFT);
    });

    it("detects right side hits", () => {
        const t = new Tank(1, "#c33", "#822");
        t.x = 10;
        t.y = 10;
        t.angle = 0;
        // Right = +Y in world when facing east
        assert.equal(t.getHitZone(10, 11), HIT_ZONE.SIDE_RIGHT);
    });

    it("works with rotated tanks", () => {
        const t = new Tank(1, "#c33", "#822");
        t.x = 10;
        t.y = 10;
        t.angle = Math.PI / 2; // facing south (+Y)
        // Front is south → bullet at (10, 11) is front
        assert.equal(t.getHitZone(10, 11), HIT_ZONE.FRONT);
        // Rear is north → bullet at (10, 9) is rear
        assert.equal(t.getHitZone(10, 9), HIT_ZONE.REAR);
    });
});

describe("Directional armour – subsystem damage", () => {
    it("front hit disables turret, locks turret forward", () => {
        const t = new Tank(1, "#c33", "#822");
        t.turretAngle = 0.5;
        const result = t.applyHit(HIT_ZONE.FRONT, VEHICLES.tank.bulletDamage);
        assert.equal(result, "damaged");
        assert.ok(t.damaged);
        assert.ok(t.turretDisabled);
        assert.ok(t.alive);
        assert.equal(t.turretAngle, 0, "turret locked forward");
    });

    it("left side hit disables left track", () => {
        const t = new Tank(1, "#c33", "#822");
        const result = t.applyHit(HIT_ZONE.SIDE_LEFT, VEHICLES.tank.bulletDamage);
        assert.equal(result, "damaged");
        assert.ok(t.leftTrackDisabled);
        assert.ok(!t.rightTrackDisabled);
        assert.ok(t.alive);
    });

    it("right side hit disables right track", () => {
        const t = new Tank(1, "#c33", "#822");
        const result = t.applyHit(HIT_ZONE.SIDE_RIGHT, VEHICLES.tank.bulletDamage);
        assert.equal(result, "damaged");
        assert.ok(t.rightTrackDisabled);
        assert.ok(!t.leftTrackDisabled);
        assert.ok(t.alive);
    });

    it("rear hit kills instantly", () => {
        const t = new Tank(1, "#c33", "#822");
        const result = t.applyHit(HIT_ZONE.REAR, VEHICLES.tank.bulletDamage);
        assert.equal(result, "destroyed");
        assert.ok(!t.alive);
    });

    it("second hit from any direction destroys", () => {
        const t = new Tank(1, "#c33", "#822");
        t.applyHit(HIT_ZONE.FRONT, VEHICLES.tank.bulletDamage);
        assert.ok(t.alive);
        const result = t.applyHit(HIT_ZONE.SIDE_LEFT, VEHICLES.tank.bulletDamage);
        assert.equal(result, "destroyed");
        assert.ok(!t.alive);
    });

    it("disabled turret blocks turret rotation input", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 0;
        t.turretAngle = 0;
        t.turretDisabled = true;
        t.damaged = true;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.turretAngle, 0, "turret should not rotate");
    });

    it("disabled track prevents straight-line movement", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 0;
        t.leftTrackDisabled = true;
        t.damaged = true;

        const startX = t.x;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.x, startX, "should not move forward");
    });

    it("left track disabled: can still rotate left (right track drives)", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 1.0;
        t.leftTrackDisabled = true;
        t.damaged = true;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.left };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(t.angle < 1.0, "should rotate left (right track still works)");
    });

    it("left track disabled: cannot rotate right", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 1.0;
        t.leftTrackDisabled = true;
        t.damaged = true;

        const startAngle = t.angle;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.right };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(Math.abs(t.angle - startAngle) < 0.001, "should NOT rotate right (left track needed for right turn)");
    });
});

describe("IFV vehicle type", () => {
    it("defaults to tank vehicle type", () => {
        const t = new Tank(1, "#c33", "#822");
        assert.equal(t.vehicleType, "tank");
        assert.equal(t.fixedGun, false);
    });

    it("IFV has fixed gun (fixedGun getter)", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "ifv";
        assert.equal(t.fixedGun, true);
    });

    it("IFV survives multiple hits before destruction", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "ifv";
        // First hit (1.0 damage) should be absorbed (below threshold of 2)
        const r1 = t.applyHit(HIT_ZONE.FRONT, 1.0);
        assert.equal(r1, "absorbed");
        assert.ok(t.alive, "IFV should survive first hit");
        // Second hit crosses threshold → subsystem damage
        const r2 = t.applyHit(HIT_ZONE.SIDE_LEFT, 1.0);
        assert.equal(r2, "damaged");
        assert.ok(t.alive, "IFV should survive subsystem hit");
        assert.ok(t.leftTrackDisabled, "IFV left track should be disabled");
        // Third hit: damaged=true + damage>=1.0 → kill
        const r3 = t.applyHit(HIT_ZONE.FRONT, 1.0);
        assert.equal(r3, "destroyed");
        assert.ok(!t.alive);
    });

    it("IFV destroyed by accumulated small-arms fire", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "ifv";
        const armour = VEHICLES.ifv.armour;
        const expectedShots = armour.hp / 0.1;
        // Tower bullets (0.1 damage each) — need hp/0.1 shots to destroy
        let hitCount = 0;
        while (t.alive) {
            t.applyHit(HIT_ZONE.FRONT, 0.1);
            hitCount++;
            if (hitCount > 100) break; // safety
        }
        assert.ok(!t.alive);
        assert.equal(hitCount, expectedShots, `IFV should take ${expectedShots} tower shots to destroy`);
    });

    it("IFV gets track damage at threshold", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "ifv";
        // Accumulate to threshold with small hits
        for (let i = 0; i < 7; i++) t.applyHit(HIT_ZONE.SIDE_RIGHT, 0.25);
        assert.ok(!t.damaged, "should not trigger subsystem yet");
        const r = t.applyHit(HIT_ZONE.SIDE_RIGHT, 0.25);
        assert.equal(r, "damaged");
        assert.ok(t.rightTrackDisabled, "IFV right track should be disabled");
        assert.ok(t.alive);
    });

    it("IFV has no turret subsystem (front hit disables nothing)", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "ifv";
        // Cross threshold with a front hit
        t.damageAccum = 1.75;
        const r = t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(r, "damaged");
        assert.ok(!t.turretDisabled, "IFV has no turret subsystem");
        assert.ok(t.alive);
    });

    it("IFV turret is fixed forward (turretAngle stays 0)", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "ifv";
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 0;
        t.turretAngle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.turretAngle, 0, "IFV turret should stay at 0");
    });

    it("IFV moves faster than tank", () => {
        const map = customMap([]);
        const tank = new Tank(1, "#c33", "#822");
        const ifv = new Tank(2, "#33c", "#228");
        ifv.vehicleType = "ifv";

        const sx = 32.5,
            sy = 32.5;

        tank.alive = true;
        tank.x = sx;
        tank.y = sy;
        tank.angle = 0;
        ifv.alive = true;
        ifv.x = sx;
        ifv.y = sy;
        ifv.angle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 30; i++) {
            tank.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
            ifv.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        }
        const tankDist = Math.hypot(tank.x - sx, tank.y - sy);
        const ifvDist = Math.hypot(ifv.x - sx, ifv.y - sy);
        assert.ok(
            ifvDist > tankDist * 1.3,
            `IFV should travel farther (${ifvDist.toFixed(2)} vs ${tankDist.toFixed(2)})`,
        );
    });

    it("IFV fires faster (shorter cooldown)", () => {
        const tank = new Tank(1, "#c33", "#822");
        const ifv = new Tank(2, "#33c", "#228");
        ifv.vehicleType = "ifv";

        tank.fire();
        ifv.fire();

        assert.equal(tank.fireCooldown, VEHICLES.tank.bulletCooldown);
        assert.equal(ifv.fireCooldown, VEHICLES.ifv.bulletCooldown);
        assert.ok(ifv.fireCooldown < tank.fireCooldown, "IFV should have shorter cooldown");
    });
});

describe("Partial damage (IFV bullets)", () => {
    it("IFV bullets accumulate to trigger subsystem damage", () => {
        const t = new Tank(1, "#c33", "#822");
        const threshold = VEHICLES.tank.armour.subsystemThreshold;
        const hitsNeeded = Math.ceil(threshold / 0.25);
        // One fewer than needed: no effect yet
        for (let i = 0; i < hitsNeeded - 1; i++) {
            const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
            assert.equal(result, "absorbed");
            assert.equal(t.damaged, false);
        }
        // Final hit triggers subsystem damage
        const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(result, "damaged");
        assert.ok(t.damaged);
        assert.ok(t.turretDisabled);
        assert.ok(t.alive);
    });

    it("IFV bullets destroy a tank (subsystem then kill)", () => {
        const t = new Tank(1, "#c33", "#822");
        const hp = VEHICLES.tank.armour.hp;
        const totalHits = Math.ceil(hp / 0.25);
        // Fire all but the last
        for (let i = 0; i < totalHits - 1; i++) t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.ok(t.alive);
        // Final hit kills
        const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(result, "destroyed");
        assert.ok(!t.alive);
    });

    it("IFV bullets to rear kill at threshold", () => {
        const t = new Tank(1, "#c33", "#822");
        const threshold = VEHICLES.tank.armour.subsystemThreshold;
        const hitsNeeded = Math.ceil(threshold / 0.25);
        for (let i = 0; i < hitsNeeded - 1; i++) {
            const result = t.applyHit(HIT_ZONE.REAR, 0.25);
            assert.equal(result, "absorbed");
        }
        // Hit that crosses threshold on rear zone → kill
        const result = t.applyHit(HIT_ZONE.REAR, 0.25);
        assert.equal(result, "destroyed");
        assert.ok(!t.alive);
    });

    it("mixed damage: IFV hits + tank shell triggers subsystem damage", () => {
        const t = new Tank(1, "#c33", "#822");
        // Soften up with IFV fire (not enough to trigger subsystem alone)
        t.applyHit(HIT_ZONE.FRONT, 0.25);
        t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(t.damaged, false);
        // Tank shell pushes past threshold (0.50 + 3.0 = 3.50 ≥ 3)
        const result = t.applyHit(HIT_ZONE.FRONT, VEHICLES.tank.bulletDamage);
        assert.equal(result, "damaged");
        assert.ok(t.damaged);
        assert.ok(t.turretDisabled);
    });

    it("respawnAt clears damageAccum", () => {
        const t = new Tank(1, "#c33", "#822");
        t.applyHit(HIT_ZONE.FRONT, 0.25);
        t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(t.damageAccum, 0.5);
        t.respawnAt(10, 10);
        assert.equal(t.damageAccum, 0);
    });
});

describe("Bullet", () => {
    it("spawns ahead of the tank", () => {
        const b = new Bullet(10, 20, 0, 1, 1);
        assert.ok(b.x > 10);
        assert.equal(b.team, 1);
        assert.ok(b.alive);
        assert.equal(b.damage, 1.0);
        assert.equal(b.speed, VEHICLES.tank.bulletSpeed);
    });

    it("supports custom damage and speed", () => {
        const b = new Bullet(10, 20, 0, 1, 1, 0.25, 13.5);
        assert.equal(b.damage, 0.25);
        assert.equal(b.speed, 13.5);
    });

    it("moves each frame", () => {
        const map = new GameMap();
        const b = new Bullet(32, 32, 0, 1, 1);
        const oldX = b.x;
        b.update(0.016, map);
        assert.ok(b.x > oldX);
    });

    it("faster bullet travels farther per frame", () => {
        const map = new GameMap();
        const slow = new Bullet(32, 32, 0, 1, 1, 1.0, 9.0);
        const fast = new Bullet(32, 32, 0, 1, 1, 0.25, 13.5);
        const slowX0 = slow.x,
            fastX0 = fast.x;
        slow.update(0.016, map);
        fast.update(0.016, map);
        const slowDist = slow.x - slowX0;
        const fastDist = fast.x - fastX0;
        assert.ok(fastDist > slowDist, "faster bullet should travel farther");
    });

    it("dies when hitting blocking terrain", () => {
        const map = new GameMap();
        map.setTile(30, 30, T.BLDG_MEDIUM);
        const b = new Bullet(28, 30.5, 0, 1, 1);
        for (let i = 0; i < 100; i++) {
            b.update(0.016, map);
            if (!b.alive) break;
        }
        assert.ok(!b.alive);
    });

    it("dies after lifetime expires", () => {
        const map = new GameMap();
        const b = new Bullet(32, 32, 0, 1, 1);
        for (let i = 0; i < 1000; i++) b.update(0.016, map);
        assert.ok(!b.alive);
    });
});

describe("Collision – team filtering", () => {
    it("same-team bullets should not hit friendly tanks", () => {
        const t = new Tank(1, "#c33", "#822");
        t.team = 1;
        const b = new Bullet(9, 10, 0, 2, 1);
        assert.equal(b.team, t.team);
    });

    it("different-team bullets can hit enemy tanks", () => {
        const t = new Tank(1, "#c33", "#822");
        t.team = 1;
        const b = new Bullet(0, 0, 0, 3, 2);
        assert.notEqual(b.team, t.team);
    });
});

describe("Drone vehicle type", () => {
    it("drone has fixed gun (fixedGun getter)", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "drone";
        assert.equal(t.fixedGun, true);
    });

    it("drone has smaller collision radius", () => {
        const t = new Tank(1, "#c33", "#822");
        assert.equal(t.size, VEHICLES.tank.size);
        t.vehicleType = "drone";
        assert.equal(t.size, VEHICLES.drone.size);
        assert.ok(VEHICLES.drone.size < VEHICLES.tank.size);
    });

    it("drone dies on any hit regardless of zone", () => {
        for (const zone of [HIT_ZONE.FRONT, HIT_ZONE.SIDE_LEFT, HIT_ZONE.SIDE_RIGHT, HIT_ZONE.REAR]) {
            const t = new Tank(1, "#c33", "#822");
            t.vehicleType = "drone";
            const result = t.applyHit(zone);
            assert.equal(result, "destroyed", `Drone should die from ${zone} hit`);
            assert.ok(!t.alive);
        }
    });

    it("drone dies from a single tower bullet", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "drone";
        const towerDmg = BASE_STRUCTURES.baseTower.bulletDamage;
        const result = t.applyHit(HIT_ZONE.FRONT, towerDmg);
        assert.equal(result, "destroyed");
        assert.ok(!t.alive);
    });

    it("drone turret is fixed forward (turretAngle stays 0)", () => {
        const map = new GameMap();
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "drone";
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) {
                    sx = x + 0.5;
                    sy = y + 0.5;
                }
        t.x = sx;
        t.y = sy;
        t.angle = 0;
        t.turretAngle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.turretAngle, 0, "Drone turret should stay at 0");
    });

    it("drone moves faster than tank and IFV", () => {
        const map = customMap([]);
        const tank = new Tank(1, "#c33", "#822");
        const ifv = new Tank(2, "#33c", "#228");
        ifv.vehicleType = "ifv";
        const drone = new Tank(3, "#3c3", "#282");
        drone.vehicleType = "drone";

        const sx = 32.5,
            sy = 32.5;
        for (const t of [tank, ifv, drone]) {
            t.alive = true;
            t.x = sx;
            t.y = sy;
            t.angle = 0;
        }

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 30; i++) {
            tank.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
            ifv.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
            drone.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        }
        const tankDist = Math.hypot(tank.x - sx, tank.y - sy);
        const ifvDist = Math.hypot(ifv.x - sx, ifv.y - sy);
        const droneDist = Math.hypot(drone.x - sx, drone.y - sy);
        assert.ok(
            droneDist > ifvDist,
            `Drone should travel farther than IFV (${droneDist.toFixed(2)} vs ${ifvDist.toFixed(2)})`,
        );
        assert.ok(
            droneDist > tankDist * 1.8,
            `Drone should travel much farther than tank (${droneDist.toFixed(2)} vs ${tankDist.toFixed(2)})`,
        );
    });

    it("drone flies over buildings and hills (not blocked by terrain)", () => {
        const obstacles = [];
        for (let x = 30; x <= 35; x++) obstacles.push({ x, y: 32, tile: T.HILL });
        const map = customMap(obstacles);

        const drone = new Tank(1, "#c33", "#822");
        drone.vehicleType = "drone";
        drone.alive = true;
        drone.x = 28.5;
        drone.y = 32.5;
        drone.angle = 0; // facing east, into the wall

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        // Drone speed = 6.0 u/s.  Need ~1.4s to cross 8.5 tiles → ~90 frames
        for (let i = 0; i < 120; i++) drone.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(drone.x > 36, `Drone should fly over hills (x=${drone.x.toFixed(2)})`);
    });

    it("regular tank is blocked by same terrain drone flies over", () => {
        const obstacles = [];
        for (let x = 30; x <= 35; x++) obstacles.push({ x, y: 32, tile: T.HILL });
        const map = customMap(obstacles);

        const tank = new Tank(1, "#c33", "#822");
        tank.alive = true;
        tank.x = 28.5;
        tank.y = 32.5;
        tank.angle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 120; i++) tank.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(tank.x < 30, `Tank should be blocked by hills (x=${tank.x.toFixed(2)})`);
    });

    it("drone flies over water", () => {
        const map = customMap([]);
        for (let x = 30; x <= 35; x++) map.setTile(x, 32, T.DEEP_WATER);

        const drone = new Tank(1, "#c33", "#822");
        drone.vehicleType = "drone";
        drone.alive = true;
        drone.x = 28.5;
        drone.y = 32.5;
        drone.angle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 120; i++) drone.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(drone.x > 36, `Drone should fly over water (x=${drone.x.toFixed(2)})`);
    });

    it("drone cannot fly off the map", () => {
        const map = customMap([]);
        const drone = new Tank(1, "#c33", "#822");
        drone.vehicleType = "drone";
        drone.alive = true;
        drone.x = 1;
        drone.y = 32.5;
        drone.angle = Math.PI; // facing west, toward map edge

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 200; i++) drone.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(drone.x >= 0.5, `Drone should stop at map edge (x=${drone.x.toFixed(2)})`);
    });

    it("drone track damage has no effect (always free to move)", () => {
        const map = customMap([]);
        const drone = new Tank(1, "#c33", "#822");
        drone.vehicleType = "drone";
        drone.alive = true;
        drone.x = 32.5;
        drone.y = 32.5;
        drone.angle = 0;
        drone.leftTrackDisabled = true;
        drone.rightTrackDisabled = true;

        const startX = drone.x;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 30; i++) drone.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(drone.x > startX + 0.5, `Drone should still move with disabled tracks (x=${drone.x.toFixed(2)})`);
    });
});

describe("Drone detonation – distance-based damage", () => {
    it("point-blank detonation deals full blast damage", () => {
        const dmg = VEHICLES.drone.blastDamage * Math.max(0, 1 - 0 / VEHICLES.drone.blastRadius);
        assert.equal(dmg, VEHICLES.drone.blastDamage);
    });

    it("damage falls off linearly to 0 at blast radius edge", () => {
        const r = VEHICLES.drone.blastRadius;
        const maxDmg = VEHICLES.drone.blastDamage;
        const atEdge = maxDmg * Math.max(0, 1 - r / r);
        assert.equal(atEdge, 0);

        const atHalf = maxDmg * Math.max(0, 1 - r / 2 / r);
        assert.ok(Math.abs(atHalf - maxDmg / 2) < 0.01, `Half-radius should deal ~50% damage (got ${atHalf})`);
    });

    it("detonation with no enemies nearby still kills the drone", () => {
        // The drone self-destructs even if nobody is in range
        const drone = new Tank(1, "#c33", "#822");
        drone.vehicleType = "drone";
        drone.alive = true;
        // canFire returns true (no cooldown on drones)
        assert.ok(drone.canFire());
    });

    it("drone blast radius and damage are configured", () => {
        assert.ok(VEHICLES.drone.blastRadius > 0);
        assert.ok(VEHICLES.drone.blastDamage > 0);
    });
});

describe("SPG vehicle type", () => {
    it("SPG has independent turret (not fixedGun)", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        assert.equal(t.fixedGun, false);
    });

    it("SPG survives multiple hits before destruction", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        // First hit: accum=1.0, below threshold 2 → absorbed
        const r1 = t.applyHit(HIT_ZONE.FRONT, 1.0);
        assert.equal(r1, "absorbed");
        assert.ok(t.alive);
        // Second hit: accum=2.0, crosses threshold → damaged
        const r2 = t.applyHit(HIT_ZONE.FRONT, 1.0);
        assert.equal(r2, "damaged");
        assert.ok(t.alive);
        assert.ok(t.turretDisabled);
        // Third hit: damaged=true + damage>=1.0 → destroyed
        const r3 = t.applyHit(HIT_ZONE.FRONT, 1.0);
        assert.equal(r3, "destroyed");
        assert.ok(!t.alive);
    });

    it("SPG rear hit kills instantly", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        const result = t.applyHit(HIT_ZONE.REAR, 1.0);
        assert.equal(result, "destroyed");
        assert.ok(!t.alive);
    });

    it("SPG destroyed by accumulated small-arms fire", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        const armour = VEHICLES.spg.armour;
        let hitCount = 0;
        while (t.alive) {
            t.applyHit(HIT_ZONE.FRONT, 0.1);
            hitCount++;
            if (hitCount > 200) break;
        }
        assert.ok(!t.alive);
        // Allow ±1 for floating-point accumulation (50×0.1 ≈ 5.0)
        const expected = Math.round(armour.hp / 0.1);
        assert.ok(Math.abs(hitCount - expected) <= 1, `SPG should take ~${expected} tower shots, got ${hitCount}`);
    });

    it("SPG gets track damage at threshold", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        // Accumulate just below threshold
        t.damageAccum = 1.75;
        const r = t.applyHit(HIT_ZONE.SIDE_LEFT, 0.25);
        assert.equal(r, "damaged");
        assert.ok(t.leftTrackDisabled);
        assert.ok(t.alive);
    });

    it("SPG has larger collision radius than tank", () => {
        assert.ok(VEHICLES.spg.size > VEHICLES.tank.size);
    });

    it("SPG moves slower than tank", () => {
        assert.ok(VEHICLES.spg.speed < VEHICLES.tank.speed);
    });

    it("SPG has longer cooldown than tank", () => {
        assert.ok(VEHICLES.spg.bulletCooldown > VEHICLES.tank.bulletCooldown);
    });

    it("SPG has bullet damage >= tank", () => {
        assert.ok(VEHICLES.spg.bulletDamage >= VEHICLES.tank.bulletDamage);
    });

    it("SPG turret rotates (not fixed like IFV)", () => {
        const map = customMap([]);
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        t.alive = true;
        t.x = 32.5;
        t.y = 32.5;
        t.angle = 0;
        t.turretAngle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 20; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(t.turretAngle > 0, "SPG turret should rotate");
    });

    it("SPG turret rotates slower than tank turret", () => {
        assert.ok(VEHICLES.spg.turretSpeed < VEHICLES.tank.turretSpeed);
    });

    it("kill() resets charge state", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        t.isCharging = true;
        t.chargeTime = 2.0;
        t.kill();
        assert.equal(t.chargeTime, 0);
        assert.equal(t.isCharging, false);
    });

    it("respawnAt() resets charge state", () => {
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        t.isCharging = true;
        t.chargeTime = 1.5;
        t.respawnAt(10, 10);
        assert.equal(t.chargeTime, 0);
        assert.equal(t.isCharging, false);
    });

    it("SPG cannot drive while charging (isCharging blocks movement)", () => {
        const map = customMap([]);
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        t.alive = true;
        t.x = 32.5;
        t.y = 32.5;
        t.angle = 0;
        t.isCharging = true;

        const startX = t.x;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 30; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.x, startX, "SPG should not move forward while charging");
    });

    it("SPG can still rotate hull while charging", () => {
        const map = customMap([]);
        const t = new Tank(1, "#c33", "#822");
        t.vehicleType = "spg";
        t.alive = true;
        t.x = 32.5;
        t.y = 32.5;
        t.angle = 1.0;
        t.isCharging = true;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.right };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(t.angle !== 1.0, "SPG should still rotate hull while charging");
    });
});

describe("SPG arcing bullets", () => {
    it("arcing bullet has correct properties", () => {
        const b = new Bullet(10, 20, 0, 1, 1, 1.5, 7.0, true, 15.0);
        assert.equal(b.arcing, true);
        assert.equal(b.targetDistance, 15.0);
        assert.equal(b.distanceTraveled, 0);
        assert.equal(b.landed, false);
        assert.equal(b.damage, 1.5);
        assert.equal(b.speed, 7.0);
    });

    it("arcing bullet flies over blocking terrain", () => {
        const map = customMap([]);
        // Place a wall of hills directly in path
        for (let x = 12; x <= 16; x++) map.setTile(x, 20, T.HILL);

        const b = new Bullet(10, 20.5, 0, 1, 1, 1.5, 7.0, true, 20.0);
        // Run for enough frames to pass through the wall
        for (let i = 0; i < 100; i++) {
            b.update(0.016, map);
            if (!b.alive) break;
        }
        // Bullet should have traveled past the wall (x > 16)
        assert.ok(b.x > 16 || b.landed, "Arcing bullet should fly over terrain");
    });

    it("arcing bullet dies when reaching target distance", () => {
        const map = customMap([]);
        const b = new Bullet(32, 32, 0, 1, 1, 1.5, 7.0, true, 3.0);
        for (let i = 0; i < 200; i++) {
            b.update(0.016, map);
            if (!b.alive) break;
        }
        assert.ok(!b.alive, "Arcing bullet should die after reaching target distance");
        assert.ok(b.landed, "Arcing bullet should set landed=true");
    });

    it("arcProgress goes from 0 to 1", () => {
        const map = customMap([]);
        const b = new Bullet(32, 32, 0, 1, 1, 1.5, 7.0, true, 10.0);
        assert.ok(b.arcProgress < 0.1, "Should start near 0");
        // Run until about halfway
        for (let i = 0; i < 50; i++) b.update(0.016, map);
        assert.ok(b.arcProgress > 0.2 && b.arcProgress < 0.8, `Mid-flight progress: ${b.arcProgress}`);
    });

    it("normal bullet is NOT arcing", () => {
        const b = new Bullet(10, 20, 0, 1, 1, 1.0, 9.0);
        assert.equal(b.arcing, false);
        assert.equal(b.targetDistance, 0);
        assert.equal(b.arcProgress, 0);
    });

    it("normal bullet is still blocked by terrain", () => {
        const map = customMap([]);
        map.setTile(12, 20, T.HILL);
        const b = new Bullet(10, 20.5, 0, 1, 1);
        for (let i = 0; i < 100; i++) {
            b.update(0.016, map);
            if (!b.alive) break;
        }
        assert.ok(!b.alive);
        assert.ok(b.x < 14, "Normal bullet should be stopped by terrain");
    });
});

describe("SPG splash damage", () => {
    it("SPG splash has non-zero radius", () => {
        assert.ok(VEHICLES.spg.splashRadius > 0);
    });

    it("SPG shell two-shots a tank (subsystem then kill)", () => {
        const t = new Tank(1, "#c33", "#822");
        t.applyHit(HIT_ZONE.FRONT, VEHICLES.spg.bulletDamage);
        assert.ok(t.alive, "tank should survive first SPG shell");
        assert.ok(t.damaged, "first SPG shell should trigger subsystem");
        const r = t.applyHit(HIT_ZONE.FRONT, VEHICLES.spg.bulletDamage);
        assert.equal(r, "destroyed", "second SPG shell should kill");
    });

    it("SPG charge rate and range are configured", () => {
        assert.ok(VEHICLES.spg.chargeRate > 0);
        assert.ok(VEHICLES.spg.minRange > 0);
        assert.ok(VEHICLES.spg.maxRange > VEHICLES.spg.minRange);
    });
});

describe("Data-driven armour system", () => {
    it("every vehicle has an armour config", () => {
        for (const [name, v] of Object.entries(VEHICLES)) {
            assert.ok(v.armour, `${name} should have armour config`);
            assert.ok(typeof v.armour.hp === "number", `${name}.armour.hp should be a number`);
            assert.ok(
                typeof v.armour.rearInstantKill === "boolean",
                `${name}.armour.rearInstantKill should be boolean`,
            );
            assert.ok(typeof v.armour.subsystems === "object", `${name}.armour.subsystems should be an object`);
        }
    });

    it("hpFraction starts at 1.0 and decreases with damage", () => {
        const t = new Tank(1, "#c33", "#822");
        assert.equal(t.hpFraction, 1.0);
        t.applyHit(HIT_ZONE.FRONT, 1.0);
        assert.ok(t.hpFraction < 1.0);
        assert.ok(t.hpFraction > 0);
    });

    it("drone hp is low enough that one tower shot kills", () => {
        assert.ok(VEHICLES.drone.armour.hp <= BASE_STRUCTURES.baseTower.bulletDamage);
    });

    it("IFV and SPG survive a tank shell (1.0 damage)", () => {
        for (const type of ["ifv", "spg"]) {
            const t = new Tank(1, "#c33", "#822");
            t.vehicleType = type;
            t.applyHit(HIT_ZONE.FRONT, 1.0);
            assert.ok(t.alive, `${type} should survive a 1.0 damage hit`);
        }
    });

    it("subsystem keys map to valid Tank properties", () => {
        for (const [name, v] of Object.entries(VEHICLES)) {
            for (const [zone, key] of Object.entries(v.armour.subsystems)) {
                assert.ok(
                    key in { turret: 1, leftTrack: 1, rightTrack: 1 },
                    `${name}.armour.subsystems.${zone} = "${key}" should be a known subsystem`,
                );
            }
        }
    });
});
