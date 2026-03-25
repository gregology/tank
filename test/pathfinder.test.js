import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, Pathfinder, T, customMap, wallH, wallV, wallU, zigzag } from './helpers.js';

describe('Pathfinder', () => {
    it('finds a straight-line path on open terrain', () => {
        const map = customMap([]);  // flat grass, no obstacles
        const pf = new Pathfinder(map);
        const path = pf.findPath(16.5, 32.5, 48.5, 32.5);
        assert.ok(path, 'path should exist');
        assert.ok(path.length > 0, 'path should have waypoints');
        for (const wp of path) {
            assert.ok(map.isPassable(wp.x, wp.y),
                `waypoint (${wp.x},${wp.y}) should be passable`);
        }
    });

    it('returns null for unreachable targets', () => {
        const map = new GameMap();
        const pf = new Pathfinder(map);
        // Deep water is unreachable
        const path = pf.findPath(32.5, 32.5, 0.5, 0.5);
        assert.equal(path, null);
    });

    it('returns empty array when already at goal', () => {
        const map = new GameMap();
        const pf = new Pathfinder(map);
        // Find a passable tile to test with
        let px, py;
        for (let y = 20; y < 44 && !px; y++)
            for (let x = 20; x < 44 && !px; x++)
                if (map.isPassable(x + 0.5, y + 0.5)) { px = x + 0.5; py = y + 0.5; }
        const path = pf.findPath(px, py, px, py);
        assert.ok(path !== null, 'same-tile path should not be null');
        assert.equal(path.length, 0);
    });

    it('routes around a horizontal wall', () => {
        const map = customMap(wallH(30, 25, 38));
        const pf = new Pathfinder(map);
        const path = pf.findPath(30.5, 32.5, 30.5, 27.5);
        assert.ok(path, 'should find a path around the wall');
        assert.ok(path.length > 3, 'path should detour');
        // Verify no waypoint is on the wall
        for (const wp of path) {
            const tile = map.getTile(Math.floor(wp.x), Math.floor(wp.y));
            assert.notEqual(tile, T.HILL, `waypoint should not be on a hill`);
        }
    });

    it('routes around an L-shaped wall', () => {
        const map = new GameMap();
        // Clear an area then stamp our L-wall
        for (let y = 24; y <= 36; y++)
            for (let x = 24; x <= 42; x++)
                if (map.getTile(x, y) === T.HILL || map.getTile(x, y) === T.ROCK)
                    map.setTile(x, y, T.GRASS);
        // L-wall
        for (let x = 28; x <= 38; x++) map.setTile(x, 30, T.HILL);
        for (let y = 25; y <= 30; y++) map.setTile(28, y, T.HILL);
        const pf = new Pathfinder(map);
        const path = pf.findPath(31.5, 27.5, 31.5, 33.5);
        assert.ok(path, 'should route around the L');
        assert.ok(path.length >= 5);
    });

    it('routes through a U-shaped trap', () => {
        const map = customMap(wallU(27, 28, 10, 6));
        const pf = new Pathfinder(map);
        // Bot inside the U, target outside
        const path = pf.findPath(32.5, 31.5, 32.5, 26.5);
        assert.ok(path, 'should escape the U');
    });

    it('routes through a zigzag maze', () => {
        const map = customMap(zigzag(27, 3, 3, 25, 38));
        const pf = new Pathfinder(map);
        const path = pf.findPath(30.5, 25.5, 30.5, 36.5);
        assert.ok(path, 'should navigate the zigzag');
    });

    it('paths between tower positions on random maps', () => {
        for (let i = 0; i < 5; i++) {
            const map = new GameMap();
            const [tp1, tp2] = map.findTowerPositions();
            const pf = new Pathfinder(map);
            const path = pf.findPath(tp1.x, tp1.y, tp2.x, tp2.y);
            assert.ok(path, `map seed ${map.seed}: should find cross-map path`);
            assert.ok(path.length > 5, 'path should have meaningful length');
        }
    });

    it('prefers tiles away from walls (wall-cost weighting)', () => {
        const map = new GameMap();
        // Clear the area then stamp a 6-tile-wide corridor
        for (let y = 26; y <= 36; y++)
            for (let x = 18; x <= 42; x++)
                if (map.getTile(x, y) === T.HILL || map.getTile(x, y) === T.ROCK)
                    map.setTile(x, y, T.GRASS);
        for (let x = 18; x <= 42; x++) { map.setTile(x, 28, T.HILL); map.setTile(x, 34, T.HILL); }
        const pf = new Pathfinder(map);
        const path = pf.findPath(20.5, 31.5, 40.5, 31.5);
        assert.ok(path, 'should find corridor path');
        // Waypoints at y=30-32 are the centre rows (3 of 5 passable rows 29-33)
        const middleCount = path.filter(wp =>
            Math.floor(wp.y) >= 30 && Math.floor(wp.y) <= 32).length;
        const ratio = middleCount / path.length;
        assert.ok(ratio > 0.4,
            `should prefer centre, got ${(ratio * 100).toFixed(0)}% in middle rows`);
    });

    it('invalidate() rebuilds wall costs after terrain destruction', () => {
        const map = customMap(wallH(30, 25, 35));
        const pf = new Pathfinder(map);
        const path1 = pf.findPath(30.5, 32.5, 30.5, 28.5);
        assert.ok(path1, 'should find path around wall');
        const len1 = path1.length;

        // Destroy part of the wall (create a gap)
        map.setTile(30, 30, T.GRASS);
        pf.invalidate();
        const path2 = pf.findPath(30.5, 32.5, 30.5, 28.5);
        assert.ok(path2, 'should find path through gap');
        assert.ok(path2.length <= len1,
            `gap path (${path2.length}) should be <= detour path (${len1})`);
    });

    it('completes within 2ms on a 64x64 map', () => {
        const map = new GameMap();
        const pf = new Pathfinder(map);
        const start = performance.now();
        for (let i = 0; i < 10; i++) {
            pf.findPath(10.5, 10.5, 55.5, 55.5);
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 20, `10 pathfinds should take <20ms, took ${elapsed.toFixed(1)}ms`);
    });
});
