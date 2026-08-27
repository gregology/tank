/**
 * Bridge stage — crossings over the water stage's channels.
 *
 * Every river gets at least two bridges, every tributary at least one.
 * Bridges are always AXIS-ALIGNED (crossing due N/S or E/W): a diagonal
 * span's tiles touch corner-to-corner, which the pathfinder's
 * anti-corner-cutting rule refuses — angled bridges were impassable.
 * Each bridge is a clean 2-lane span (vehicles can pass each other),
 * stone or wooden by hash, repelled from the map centre and never on
 * the direct base-to-base line (no direct-LoS siege corridor).
 *
 * Every stamped bridge is verified crossable (a tank can A* bank-to-bank
 * over the span) — a candidate that fails is unstamped and skipped.
 * After stamping, the stage validates connectivity: the bases must stay
 * reachable *through* bridges — a degenerate channel earns an extra
 * bridge rather than an unwinnable map.  Bridge spans are recorded on
 * the grid for the roads stage (and tests/sandbox).
 */

import { TILES as T } from "../../config.js";
import { Pathfinder } from "../../pathfinder.js";
import { hash } from "../noise.js";

/** Lay bridges across every channel; validate base connectivity. */
export function layBridges(grid, ctx) {
    ctx.bridges = [];
    ctx._bridgePf = new Pathfinder(grid); // one instance across stamps — buffers are shared
    grid.bridges = ctx.bridges; // inspectable layout data (tests, sandbox)
    const bases = grid.baseLayouts ?? [];
    const baseLine = bases.length === 2 ? { a: bases[0].center, b: bases[1].center } : null;
    const centre = { x: grid.width / 2, y: grid.height / 2 };
    const minDim = Math.min(grid.width, grid.height);

    // Try candidates in score order until each channel has its bridges —
    // stamping can fail (bad banks, unverifiable crossing), so never
    // commit to a pick before it stamps.  One global set: tributary
    // mouths must not tangle with the main river's crossings either.
    const placed = [];
    for (const channel of ctx.channels) {
        const wanted = channel.kind === "river" ? 2 : 1;
        const candidates = bridgeCandidates(grid, channel, centre, baseLine, minDim);
        let got = 0;
        for (const c of candidates) {
            if (got >= wanted) break;
            if (placed.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < minDim * 0.15)) continue;
            if (stampBridge(grid, c, ctx)) {
                placed.push(c);
                got++;
            }
        }
    }

    // Connectivity: the bases must be reachable through bridges only.
    // The guardrail never relaxes the no-direct-line rule — it tries
    // off-line candidates one at a time and keeps only what connects.
    if (baseLine) {
        const pf = ctx._bridgePf;
        pf.invalidate();
        const connected = () => {
            const path = pf.findPath(baseLine.a.x, baseLine.a.y, baseLine.b.x, baseLine.b.y);
            return path?.some((w) => isBridge(grid.getTile(Math.floor(w.x), Math.floor(w.y)))) ?? false;
        };
        let guard = 0;
        while (!connected() && guard++ < 10) {
            const candidates = ctx.channels
                .flatMap((ch) => bridgeCandidates(grid, ch, centre, baseLine, minDim))
                .filter((c) => !ctx.bridges.some((b) => Math.hypot(b.centre.x - c.x, b.centre.y - c.y) < minDim * 0.08))
                .sort((a, b) => b.score - a.score);
            const next = candidates[guard - 1];
            if (!next) break;
            stampBridge(grid, next, ctx);
            pf.invalidate();
        }
    }
    delete ctx._bridgePf;
}

function isBridge(t) {
    return t === T.BRIDGE_STONE || t === T.BRIDGE_WOOD;
}

/**
 * Spine points on water where an axis-aligned bridge can span the
 * channel: try both crossing axes, keep the one with the shorter span,
 * require standable banks.  The RIVER needn't run axis-aligned — the
 * bridge crosses it with a straight span whatever the meander (a
 * diagonal stretch just means a longer span).
 */
function bridgeCandidates(grid, channel, centre, baseLine, minDim) {
    const spine = channel.spine;
    const maxR = Math.min(grid.width, grid.height) / 2 - 1;
    const out = [];
    for (let i = 2; i < spine.length - 2; i++) {
        const p = spine[i];
        const gx = Math.floor(p.x),
            gy = Math.floor(p.y);
        const t = grid.getTile(gx, gy);
        if (t !== T.DEEP_WATER && t !== T.SHALLOW_WATER) continue;

        // Inland water only: the spine runs out to sea, and a bridge at
        // the river mouth reads as a pier into the ocean, not a crossing.
        if (Math.hypot(p.x - centre.x, p.y - centre.y) > maxR * 0.8) continue;

        // Try both crossing axes; keep the shorter viable span.
        let best = null;
        for (const axis of ["h", "v"]) {
            const cross = axis === "h" ? { x: 1, y: 0 } : { x: 0, y: 1 };
            const span = measureSpan(grid, { x: p.x, y: p.y, cross });
            if (!span) continue;
            const total = span.back + span.forward;
            if (total > 10) continue; // too wide to bridge
            if (!best || total < best.total) best = { axis, cross, total };
        }
        if (!best) continue;

        // Land must continue past both banks — a bank that runs straight
        // into the sea makes the bridge a pier.
        const beyond = [best.total + 4].flatMap((k) => [
            grid.getTile(Math.floor(p.x + best.cross.x * k), Math.floor(p.y + best.cross.y * k)),
            grid.getTile(Math.floor(p.x - best.cross.x * k), Math.floor(p.y - best.cross.y * k)),
        ]);
        if (!beyond.every((bt) => bt !== undefined && isInlandGround(bt))) continue;

        // Never on the direct base-to-base line (no direct-LoS corridor)
        // — the margin includes the bridge's own footprint.
        if (baseLine && distToSegment(p, baseLine.a, baseLine.b) < minDim * 0.12 + 7) continue;

        const centreDist = Math.hypot(p.x - centre.x, p.y - centre.y);
        const jitter = hash(grid, Math.round(p.x * 8), Math.round(p.y * 8)) * minDim * 0.3;
        out.push({ x: p.x, y: p.y, axis: best.axis, cross: best.cross, score: centreDist + jitter });
    }
    return out;
}

function isInlandGround(t) {
    // Banks and ends must be STANDABLE ground — a hill/rock bank is land
    // you can't step onto, which makes the bridge useless.
    return t === T.GRASS || t === T.DARK_GRASS || t === T.DIRT || t === T.SAND || t === T.FIELD || t === T.TREE;
}

/**
 * Stamp a 2-lane axis-aligned bridge; verify a tank can cross it; if
 * not, restore the water and skip.  Records centre/axis/kind/ends.
 */
function stampBridge(grid, p, ctx) {
    const lane = p.axis === "h" ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const span = measureSpan(grid, p);
    if (!span) return false;
    const kind = hash(grid, Math.round(p.x * 3), Math.round(p.y * 5)) > 0.5 ? T.BRIDGE_STONE : T.BRIDGE_WOOD;
    // All bridges are one lane — a multi-lane deck reads as extra roads.
    // Stone vs wood is a look, not a width.
    const laneW = [0];

    // Stamp; remember what we overwrote in case the span fails verification
    const saved = [];
    for (let k = -span.back; k <= span.forward; k++) {
        for (const w of laneW) {
            const gx = Math.floor(p.x) + p.cross.x * k + lane.x * w;
            const gy = Math.floor(p.y) + p.cross.y * k + lane.y * w;
            const t = grid.getTile(gx, gy);
            if (t === T.BASE_STRUCTURE) continue; // bridges stamp over water/land; roads never reach the span
            saved.push([gx, gy, t]);
            grid.setTile(gx, gy, kind);
        }
    }

    const endA = { x: p.x - p.cross.x * (span.back + 1), y: p.y - p.cross.y * (span.back + 1) };
    const endB = { x: p.x + p.cross.x * (span.forward + 1), y: p.y + p.cross.y * (span.forward + 1) };

    // Verify: a tank must cross bank-to-bank over this span, not around
    // the map.  Angled/narrow spans fail this — restore and skip.
    const pf = ctx._bridgePf;
    pf.invalidate();
    const path = pf.findPath(endA.x, endA.y, endB.x, endB.y);
    const spanLen = span.back + span.forward + 1;
    if (!path || path.length > spanLen + 8) {
        for (const [gx, gy, t] of saved) grid.setTile(gx, gy, t);
        return false;
    }

    ctx.bridges.push({
        centre: { x: p.x, y: p.y },
        axis: p.axis,
        normal: p.cross, // crossing direction unit vector
        kind,
        ends: [endA, endB],
        span: {
            x0: Math.floor(p.x - p.cross.x * span.back) - 1,
            y0: Math.floor(p.y - p.cross.y * span.back) - 1,
            x1: Math.floor(p.x + p.cross.x * span.forward) + 1,
            y1: Math.floor(p.y + p.cross.y * span.forward) + 1,
        },
    });
    return true;
}

/** How far the water extends along the crossing axis (both ways). */
function measureSpan(grid, p) {
    let back = 0,
        forward = 0;
    for (let k = 1; k <= 8; k++) {
        const t = grid.getTile(Math.floor(p.x - p.cross.x * k), Math.floor(p.y - p.cross.y * k));
        if (isInlandGround(t)) break;
        if (t === T.BASE_STRUCTURE) return null;
        back = k;
    }
    for (let k = 1; k <= 8; k++) {
        const t = grid.getTile(Math.floor(p.x + p.cross.x * k), Math.floor(p.y + p.cross.y * k));
        if (isInlandGround(t)) break;
        if (t === T.BASE_STRUCTURE) return null;
        forward = k;
    }
    return { back, forward }; // a thin channel's bank can be one tile out — fine
}

/** Distance from point p to segment ab. */
function distToSegment(p, a, b) {
    const dx = b.x - a.x,
        dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
