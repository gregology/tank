/**
 * Water stage — rivers, tributaries, and lakes.
 *
 * Every map gets at least one river.  In battle the main river's guide
 * line runs through the bases' midpoint, roughly perpendicular to their
 * axis — the river *separates* the bases, so the bridges over it are
 * the war's choke points.  Skirmish rivers run freeform across the
 * island.  Larger maps add tributaries branching off the main river,
 * plus standalone lakes.
 *
 * Rivers reuse the existing water tiles (deep channel core, shallow
 * fringe) — no new tile type.  Each channel's spine is recorded on the
 * shared ctx for the bridges stage.
 */

import { TILES as T } from "../../config.js";
import { hash } from "../noise.js";

/** Carve all water features; records `ctx.channels` for the bridge stage. */
export function carveWater(grid, ctx) {
    ctx.channels = [];
    const w = grid.width,
        h = grid.height;
    const cx = w / 2,
        cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 1;
    const bases = grid.baseLayouts ?? [];

    // ── main river ──
    let guidePoint, guideAngle;
    if (bases.length === 2) {
        const [b1, b2] = bases.map((l) => l.center);
        guidePoint = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
        const baseAxis = Math.atan2(b2.y - b1.y, b2.x - b1.x);
        const tilt = (hash(grid, 31, 41) - 0.5) * (Math.PI / 4);
        guideAngle = baseAxis + Math.PI / 2 + tilt;
    } else {
        guidePoint = { x: cx, y: cy };
        guideAngle = hash(grid, 31, 41) * Math.PI * 2;
    }
    ctx.channels.push({ spine: carveRiver(grid, guidePoint, guideAngle, maxR, 700), kind: "river" });

    // ── tributaries (larger maps) ──
    const mapScale = Math.min(w, h) / 64;
    const tributaryCount = mapScale >= 2 ? Math.round(mapScale - 1) : 0; // 128²: 1, 192²: 2
    const mainSpine = ctx.channels[0].spine;
    for (let i = 0; i < tributaryCount; i++) {
        const at = mainSpine[Math.floor(mainSpine.length * (0.3 + hash(grid, 800 + i, 900) * 0.4))];
        const dir =
            (hash(grid, 810 + i, 910) > 0.5 ? 1 : -1) * (Math.PI / 4 + hash(grid, 820 + i, 920) * (Math.PI / 6));
        ctx.channels.push({
            spine: carveRiver(grid, at, guideAngle + dir, maxR * 0.55, 1000 + i * 100, { oneSided: true, thin: true }),
            kind: "tributary",
        });
    }

    // ── lakes ──
    const lakeCount = Math.max(1, Math.round(mapScale * (0.5 + hash(grid, 500, 600))));
    for (let i = 0; i < lakeCount; i++) carveLake(grid, cx, cy, maxR, 1100 + i * 100);
}

/**
 * Carve one meandering channel from `origin` along `angle` (both ways,
 * or one way for tributaries) with a multi-octave sine meander.  Returns
 * the spine points (world coords).  Deep core, shallow fringe; never
 * floods a compound.
 */
function carveRiver(grid, origin, angle, maxR, salt, { oneSided = false, thin = false } = {}) {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const perp = { x: -dir.y, y: dir.x };
    const octaves = [0.05, 0.13, 0.31].map((freq, i) => ({
        freq,
        amp: maxR * [0.06, 0.03, 0.015][i] * (thin ? 0.6 : 1),
        phase: hash(grid, salt + i, 17) * Math.PI * 2,
    }));
    const meander = (t) => octaves.reduce((m, o) => m + Math.sin(t * o.freq + o.phase) * o.amp, 0);

    const reach = maxR * (oneSided ? 1.1 : 1.6);
    const spine = [];
    const from = oneSided ? 0 : -reach;
    for (let t = from; t <= reach; t += 0.5) {
        const m = meander(t);
        const p = { x: origin.x + dir.x * t + perp.x * m, y: origin.y + dir.y * t + perp.y * m };
        spine.push(p);
        stampWater(grid, p, thin ? 0.9 : 1.3);
    }
    return spine;
}

/** Stamp a water disc: deep core, shallow fringe; skip compounds. */
function stampWater(grid, p, radius) {
    const bases = grid.baseLayouts ?? [];
    for (const layout of bases) {
        if (Math.hypot(p.x - layout.center.x, p.y - layout.center.y) < layout.half + 4) return;
    }
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const gx = Math.floor(p.x) + dx,
                gy = Math.floor(p.y) + dy;
            const d = Math.hypot(gx + 0.5 - p.x, gy + 0.5 - p.y);
            if (d > radius) continue;
            if (grid.getTile(gx, gy) === T.BASE_STRUCTURE) continue;
            grid.setTile(gx, gy, d < radius * 0.55 ? T.DEEP_WATER : T.SHALLOW_WATER);
        }
    }
}

/** Carve a lake: a noise-perturbed ellipse blob on open land. */
function carveLake(grid, cx, cy, maxR, salt) {
    const angle = hash(grid, salt, 1) * Math.PI * 2;
    const dist = maxR * (0.25 + hash(grid, salt, 2) * 0.5);
    const lx = cx + Math.cos(angle) * dist,
        ly = cy + Math.sin(angle) * dist;
    if (!grid.isPassable(lx, ly)) return;
    const bases = grid.baseLayouts ?? [];
    for (const layout of bases) {
        if (Math.hypot(lx - layout.center.x, ly - layout.center.y) < layout.half + 10) return;
    }
    const r = 2.5 + hash(grid, salt, 3) * 3;
    for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
            const wobble = 0.75 + hash(grid, salt + dx * 13 + dy * 29, 4) * 0.5;
            const d = Math.hypot(dx, dy) / wobble;
            if (d > r) continue;
            const gx = Math.floor(lx) + dx,
                gy = Math.floor(ly) + dy;
            const t = grid.getTile(gx, gy);
            if (t === T.BASE_STRUCTURE) continue;
            if (t !== T.GRASS && t !== T.DARK_GRASS && t !== T.SAND) continue; // land only
            grid.setTile(gx, gy, d < r * 0.6 ? T.DEEP_WATER : T.SHALLOW_WATER);
        }
    }
}
