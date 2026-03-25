import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, T, GameMap, Tank, Bullet, distance } from './helpers.js';
import { HIT_ZONE } from '../js/tank.js';

describe('Tank', () => {

    it('starts alive with default properties', () => {
        const t = new Tank(1, '#c33', '#822');
        assert.ok(t.alive);
        assert.equal(t.score, 0);
        assert.equal(t.fireCooldown, 0);
        assert.equal(t.team, 0);
        assert.equal(t.turretAngle, 0);
        assert.equal(t.damaged, false);
        assert.equal(t.turretDisabled, false);
        assert.equal(t.leftTrackDisabled, false);
        assert.equal(t.rightTrackDisabled, false);
        assert.equal(t.vehicleType, 'tank');
        assert.equal(t.damageAccum, 0);
    });

    it('respawnAt clears all damage state', () => {
        const t = new Tank(1, '#c33', '#822');
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

    it('kill sets alive=false and starts respawn timer', () => {
        const t = new Tank(1, '#c33', '#822');
        t.kill();
        assert.ok(!t.alive);
        assert.equal(t.respawnTimer, CONFIG.TANK_RESPAWN_TIME);
    });

    it('canFire respects cooldown', () => {
        const t = new Tank(1, '#c33', '#822');
        assert.ok(t.canFire());
        t.fire();
        assert.ok(!t.canFire());
    });

    it('turret rotates independently from hull', () => {
        const map = new GameMap();
        const t = new Tank(1, '#c33', '#822');
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }
        t.x = sx; t.y = sy; t.angle = 0; t.turretAngle = 0;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(t.turretAngle > 0);
        assert.equal(t.angle, 0);
    });

    it('turret rotation speed is slower than hull rotation speed', () => {
        assert.ok(CONFIG.TURRET_ROTATION_SPEED < CONFIG.TANK_ROTATION_SPEED);
    });
});

describe('Directional armour – hit zone detection', () => {

    it('detects front hits', () => {
        const t = new Tank(1, '#c33', '#822');
        t.x = 10; t.y = 10; t.angle = 0;  // facing east
        assert.equal(t.getHitZone(11, 10), HIT_ZONE.FRONT);
        assert.equal(t.getHitZone(11, 10.3), HIT_ZONE.FRONT);
    });

    it('detects rear hits', () => {
        const t = new Tank(1, '#c33', '#822');
        t.x = 10; t.y = 10; t.angle = 0;
        assert.equal(t.getHitZone(9, 10), HIT_ZONE.REAR);
        assert.equal(t.getHitZone(9, 10.3), HIT_ZONE.REAR);
    });

    it('detects left side hits', () => {
        const t = new Tank(1, '#c33', '#822');
        t.x = 10; t.y = 10; t.angle = 0;
        // Left = -Y in world when facing east
        assert.equal(t.getHitZone(10, 9), HIT_ZONE.SIDE_LEFT);
    });

    it('detects right side hits', () => {
        const t = new Tank(1, '#c33', '#822');
        t.x = 10; t.y = 10; t.angle = 0;
        // Right = +Y in world when facing east
        assert.equal(t.getHitZone(10, 11), HIT_ZONE.SIDE_RIGHT);
    });

    it('works with rotated tanks', () => {
        const t = new Tank(1, '#c33', '#822');
        t.x = 10; t.y = 10; t.angle = Math.PI / 2;  // facing south (+Y)
        // Front is south → bullet at (10, 11) is front
        assert.equal(t.getHitZone(10, 11), HIT_ZONE.FRONT);
        // Rear is north → bullet at (10, 9) is rear
        assert.equal(t.getHitZone(10, 9), HIT_ZONE.REAR);
    });
});

describe('Directional armour – subsystem damage', () => {

    it('front hit disables turret, locks turret forward', () => {
        const t = new Tank(1, '#c33', '#822');
        t.turretAngle = 0.5;
        const result = t.applyHit(HIT_ZONE.FRONT);
        assert.equal(result, 'damaged');
        assert.ok(t.damaged);
        assert.ok(t.turretDisabled);
        assert.ok(t.alive);
        assert.equal(t.turretAngle, 0, 'turret locked forward');
    });

    it('left side hit disables left track', () => {
        const t = new Tank(1, '#c33', '#822');
        const result = t.applyHit(HIT_ZONE.SIDE_LEFT);
        assert.equal(result, 'damaged');
        assert.ok(t.leftTrackDisabled);
        assert.ok(!t.rightTrackDisabled);
        assert.ok(t.alive);
    });

    it('right side hit disables right track', () => {
        const t = new Tank(1, '#c33', '#822');
        const result = t.applyHit(HIT_ZONE.SIDE_RIGHT);
        assert.equal(result, 'damaged');
        assert.ok(t.rightTrackDisabled);
        assert.ok(!t.leftTrackDisabled);
        assert.ok(t.alive);
    });

    it('rear hit kills instantly', () => {
        const t = new Tank(1, '#c33', '#822');
        const result = t.applyHit(HIT_ZONE.REAR);
        assert.equal(result, 'destroyed');
        assert.ok(!t.alive);
    });

    it('second hit from any direction destroys', () => {
        const t = new Tank(1, '#c33', '#822');
        t.applyHit(HIT_ZONE.FRONT);
        assert.ok(t.alive);
        const result = t.applyHit(HIT_ZONE.SIDE_LEFT);
        assert.equal(result, 'destroyed');
        assert.ok(!t.alive);
    });

    it('disabled turret blocks turret rotation input', () => {
        const map = new GameMap();
        const t = new Tank(1, '#c33', '#822');
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }
        t.x = sx; t.y = sy; t.angle = 0; t.turretAngle = 0;
        t.turretDisabled = true; t.damaged = true;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.turretAngle, 0, 'turret should not rotate');
    });

    it('disabled track prevents straight-line movement', () => {
        const map = new GameMap();
        const t = new Tank(1, '#c33', '#822');
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }
        t.x = sx; t.y = sy; t.angle = 0;
        t.leftTrackDisabled = true; t.damaged = true;

        const startX = t.x;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.x, startX, 'should not move forward');
    });

    it('left track disabled: can still rotate left (right track drives)', () => {
        const map = new GameMap();
        const t = new Tank(1, '#c33', '#822');
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }
        t.x = sx; t.y = sy; t.angle = 1.0;
        t.leftTrackDisabled = true; t.damaged = true;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.left };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(t.angle < 1.0, 'should rotate left (right track still works)');
    });

    it('left track disabled: cannot rotate right', () => {
        const map = new GameMap();
        const t = new Tank(1, '#c33', '#822');
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }
        t.x = sx; t.y = sy; t.angle = 1.0;
        t.leftTrackDisabled = true; t.damaged = true;

        const startAngle = t.angle;
        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.right };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.ok(Math.abs(t.angle - startAngle) < 0.001,
            'should NOT rotate right (left track needed for right turn)');
    });
});

describe('IFV vehicle type', () => {

    it('defaults to tank vehicle type', () => {
        const t = new Tank(1, '#c33', '#822');
        assert.equal(t.vehicleType, 'tank');
        assert.equal(t.fixedGun, false);
    });

    it('IFV has fixed gun (fixedGun getter)', () => {
        const t = new Tank(1, '#c33', '#822');
        t.vehicleType = 'ifv';
        assert.equal(t.fixedGun, true);
    });

    it('IFV dies on any hit regardless of zone', () => {
        for (const zone of [HIT_ZONE.FRONT, HIT_ZONE.SIDE_LEFT, HIT_ZONE.SIDE_RIGHT, HIT_ZONE.REAR]) {
            const t = new Tank(1, '#c33', '#822');
            t.vehicleType = 'ifv';
            const result = t.applyHit(zone);
            assert.equal(result, 'destroyed', `IFV should die from ${zone} hit`);
            assert.ok(!t.alive);
        }
    });

    it('IFV dies even from partial damage (0.25)', () => {
        const t = new Tank(1, '#c33', '#822');
        t.vehicleType = 'ifv';
        const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(result, 'destroyed');
        assert.ok(!t.alive);
    });

    it('IFV turret is fixed forward (turretAngle stays 0)', () => {
        const map = new GameMap();
        const t = new Tank(1, '#c33', '#822');
        t.vehicleType = 'ifv';
        t.alive = true;
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }
        t.x = sx; t.y = sy; t.angle = 0; t.turretAngle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.turretRight };
        for (let i = 0; i < 10; i++) t.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        assert.equal(t.turretAngle, 0, 'IFV turret should stay at 0');
    });

    it('IFV moves faster than tank', () => {
        const map = new GameMap();
        const tank = new Tank(1, '#c33', '#822');
        const ifv = new Tank(2, '#33c', '#228');
        ifv.vehicleType = 'ifv';

        // Find a clear position
        let sx, sy;
        for (let y = 20; y < 44 && !sx; y++)
            for (let x = 20; x < 44 && !sx; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { sx = x + 0.5; sy = y + 0.5; }

        tank.alive = true; tank.x = sx; tank.y = sy; tank.angle = 0;
        ifv.alive = true; ifv.x = sx; ifv.y = sy; ifv.angle = 0;

        const fakeInput = { isDown: (k) => k === CONFIG.PLAYER1_KEYS.forward };
        for (let i = 0; i < 30; i++) {
            tank.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
            ifv.update(0.016, fakeInput, CONFIG.PLAYER1_KEYS, map);
        }
        const tankDist = Math.hypot(tank.x - sx, tank.y - sy);
        const ifvDist = Math.hypot(ifv.x - sx, ifv.y - sy);
        assert.ok(ifvDist > tankDist * 1.3,
            `IFV should travel farther (${ifvDist.toFixed(2)} vs ${tankDist.toFixed(2)})`);
    });

    it('IFV fires faster (shorter cooldown)', () => {
        const tank = new Tank(1, '#c33', '#822');
        const ifv = new Tank(2, '#33c', '#228');
        ifv.vehicleType = 'ifv';

        tank.fire();
        ifv.fire();

        assert.equal(tank.fireCooldown, CONFIG.BULLET_COOLDOWN);
        assert.equal(ifv.fireCooldown, CONFIG.IFV_BULLET_COOLDOWN);
        assert.ok(ifv.fireCooldown < tank.fireCooldown,
            'IFV should have shorter cooldown');
    });
});

describe('Partial damage (IFV bullets)', () => {

    it('4 IFV bullets (0.25 each) equal one tank hit', () => {
        const t = new Tank(1, '#c33', '#822');
        // Three partial hits: no effect yet
        for (let i = 0; i < 3; i++) {
            const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
            assert.equal(result, 'absorbed');
            assert.equal(t.damaged, false);
        }
        // Fourth hit triggers subsystem damage
        const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(result, 'damaged');
        assert.ok(t.damaged);
        assert.ok(t.turretDisabled);
        assert.ok(t.alive);
    });

    it('8 IFV bullets destroy a tank (4 to damage + 4 to kill)', () => {
        const t = new Tank(1, '#c33', '#822');
        // First 4: subsystem damage
        for (let i = 0; i < 4; i++) t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.ok(t.alive);
        assert.ok(t.damaged);
        // Next 4: kill
        for (let i = 0; i < 3; i++) {
            const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
            assert.equal(result, 'absorbed');
        }
        const result = t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(result, 'destroyed');
        assert.ok(!t.alive);
    });

    it('4 IFV bullets to rear kills instantly', () => {
        const t = new Tank(1, '#c33', '#822');
        for (let i = 0; i < 3; i++) {
            const result = t.applyHit(HIT_ZONE.REAR, 0.25);
            assert.equal(result, 'absorbed');
        }
        // Fourth rear hit should trigger rear kill
        const result = t.applyHit(HIT_ZONE.REAR, 0.25);
        assert.equal(result, 'destroyed');
        assert.ok(!t.alive);
    });

    it('mixed damage: 2 IFV hits + 1 tank hit triggers subsystem damage', () => {
        const t = new Tank(1, '#c33', '#822');
        t.applyHit(HIT_ZONE.FRONT, 0.25);  // 0.25
        t.applyHit(HIT_ZONE.FRONT, 0.25);  // 0.50
        assert.equal(t.damaged, false);
        // Tank hit (1.0) — total becomes 1.5, triggers subsystem damage
        const result = t.applyHit(HIT_ZONE.FRONT, 1.0);
        // damageAccum was 0.50, adding 1.0 → 1.50 ≥ 1.0 → trigger damage
        // But wait, the fast path: damage >= 1.0 and !damaged → goes through accum
        // Actually no: the code checks "damage >= 1.0 && rear" and "damaged && damage >= 1.0" first
        // Neither applies (not rear, not damaged), so it accumulates: 0.5 + 1.0 = 1.5 >= 1.0
        // Triggers first hit, damageAccum = 0.5
        assert.equal(result, 'damaged');
        assert.ok(t.damaged);
        assert.ok(t.turretDisabled);
    });

    it('respawnAt clears damageAccum', () => {
        const t = new Tank(1, '#c33', '#822');
        t.applyHit(HIT_ZONE.FRONT, 0.25);
        t.applyHit(HIT_ZONE.FRONT, 0.25);
        assert.equal(t.damageAccum, 0.5);
        t.respawnAt(10, 10);
        assert.equal(t.damageAccum, 0);
    });
});

describe('Bullet', () => {

    it('spawns ahead of the tank', () => {
        const b = new Bullet(10, 20, 0, 1, 1);
        assert.ok(b.x > 10);
        assert.equal(b.team, 1);
        assert.ok(b.alive);
        assert.equal(b.damage, 1.0);
        assert.equal(b.speed, CONFIG.BULLET_SPEED);
    });

    it('supports custom damage and speed', () => {
        const b = new Bullet(10, 20, 0, 1, 1, 0.25, 13.5);
        assert.equal(b.damage, 0.25);
        assert.equal(b.speed, 13.5);
    });

    it('moves each frame', () => {
        const map = new GameMap();
        const b = new Bullet(32, 32, 0, 1, 1);
        const oldX = b.x;
        b.update(0.016, map);
        assert.ok(b.x > oldX);
    });

    it('faster bullet travels farther per frame', () => {
        const map = new GameMap();
        const slow = new Bullet(32, 32, 0, 1, 1, 1.0, 9.0);
        const fast = new Bullet(32, 32, 0, 1, 1, 0.25, 13.5);
        const slowX0 = slow.x, fastX0 = fast.x;
        slow.update(0.016, map);
        fast.update(0.016, map);
        const slowDist = slow.x - slowX0;
        const fastDist = fast.x - fastX0;
        assert.ok(fastDist > slowDist, 'faster bullet should travel farther');
    });

    it('dies when hitting blocking terrain', () => {
        const map = new GameMap();
        map.setTile(30, 30, T.BLDG_MEDIUM);
        const b = new Bullet(28, 30.5, 0, 1, 1);
        for (let i = 0; i < 100; i++) { b.update(0.016, map); if (!b.alive) break; }
        assert.ok(!b.alive);
    });

    it('dies after lifetime expires', () => {
        const map = new GameMap();
        const b = new Bullet(32, 32, 0, 1, 1);
        for (let i = 0; i < 1000; i++) b.update(0.016, map);
        assert.ok(!b.alive);
    });
});

describe('Collision – team filtering', () => {

    it('same-team bullets should not hit friendly tanks', () => {
        const t = new Tank(1, '#c33', '#822');
        t.team = 1;
        const b = new Bullet(9, 10, 0, 2, 1);
        assert.equal(b.team, t.team);
    });

    it('different-team bullets can hit enemy tanks', () => {
        const t = new Tank(1, '#c33', '#822');
        t.team = 1;
        const b = new Bullet(0, 0, 0, 3, 2);
        assert.notEqual(b.team, t.team);
    });
});
