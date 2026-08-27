/**
 * Farmland stage — patchwork districts of fields, hedgerows, barns.
 *
 * A district reads like aerial farmland: an area split into
 * non-uniform AXIS-ALIGNED field rectangles that share rows and
 * columns (guillotine cuts), with hedgerows — dense, ragged tree lines
 * — along the field borders (uncleared growth, not plantings), and a
 * barn + silo at the district's edge.
 *
 *   FIELD  ploughed ground — purely cosmetic, passable
 *   TREE   the hedgerow — sight-only cover: opaque, but vehicles drive
 *          through and bullets pass (the future trench basis)
 *   BARN/SILO  real buildings (solid, destructible, squad cover)
 *
 * Districts place on open grass, clear of water and compounds, and
 * record their barns on the shared ctx for the roads stage (a dirt
 * spur joins each barn to the network).  64² maps skip farmland: two
 * compounds and the river fill the island.
 */

import { TILES as T } from "../../config.js";
import { distance } from "../../utils.js";
import { hash } from "../noise.js";

/** Stamp farmland districts; records `ctx.farms` (barns) for roads. */
export function placeFarms(grid, ctx) {
    ctx.farms = [];
    const mapScale0 = Math.min(grid.width, grid.height) / 64;
    if (mapScale0 < 1.6) return; // 64²: two compounds + the river fill the island — no room for farmland
    const cx = grid.width / 2,
        cy = grid.height / 2;
    const maxR = Math.min(grid.width, grid.height) / 2 - 1;
    const mapScale = Math.min(grid.width, grid.height) / 64;
    const districtCount = Math.max(1, Math.round(mapScale * (0.7 + hash(grid, 3000, 77) * 0.8)));

    for (let i = 0; i < districtCount * 14 && ctx.farms.length < districtCount; i++) {
        const angle = hash(grid, 3000 + i * 13, 100) * Math.PI * 2;
        const dist = 10 + hash(grid, 3000 + i * 19, 200) * (maxR - 20);
        const dx = Math.round(cx + Math.cos(angle) * dist);
        const dy = Math.round(cy + Math.sin(angle) * dist);

        const w = Math.round(12 + hash(grid, 3000 + i * 23, 300) * 7 * mapScale);
        const h = Math.round(10 + hash(grid, 3000 + i * 29, 400) * 6 * mapScale);
        if (!districtFits(grid, dx, dy, w, h)) continue;

        const barn = stampDistrict(grid, dx, dy, w, h, 3000 + i * 1000);
        if (barn) ctx.farms.push(barn);
    }
}

/** The district must sit on open grass, clear of water and compounds. */
function districtFits(grid, cx, cy, w, h) {
    for (const layout of grid.baseLayouts ?? []) {
        if (distance(cx, cy, layout.center.x, layout.center.y) < layout.half + Math.max(w, h) / 2 + 4) return false; // the fit check already covers the barn overhang
    }
    // Mostly open grass — the district tolerates the odd road or
    // building (fields only stamp over grass anyway), but it must not
    // sit on the river, the sea, or a village.
    const x0 = Math.floor(cx - w / 2),
        y0 = Math.floor(cy - h / 2);
    let open = 0,
        total = 0;
    // sample past the west/north edges too — the barn and silo overhang
    for (let dy = -4; dy < h + 2; dy += 2) {
        for (let dx = -4; dx < w + 2; dx += 2) {
            total++;
            const t = grid.getTile(x0 + dx, y0 + dy);
            // districts sit on any open ground (grass/sand/roads/trees) —
            // only water and compounds reject the site outright
            if (t !== undefined && (grid.isWaterTile(t) || t === T.BASE_STRUCTURE)) return false;
            if (!grid.isSolid(t)) open++;
        }
    }
    return open >= total * 0.7;
}

/**
 * One district: guillotine-split the area into aligned fields, then
 * hedgerows along the borders, then barn + silo at the edge.  Returns
 * the barn's position (the district's road anchor), or null.
 */
function stampDistrict(grid, cx, cy, w, h, seed) {
    const x0 = Math.floor(cx - w / 2),
        y0 = Math.floor(cy - h / 2);

    // Guillotine cuts: split into columns of varying widths, then each
    // column into rows of varying heights — fields share rows/columns.
    const colEdges = cutEdges(0, w, 2 + Math.floor(hash(grid, seed, 11) * 2), grid, seed + 1);
    const fields = [];
    for (const [cx0, cw] of colEdges) {
        const rowEdges = cutEdges(0, h, 2 + Math.floor(hash(grid, seed + cx0, 17) * 2), grid, seed + cx0 + 100);
        for (const [cy0, ch] of rowEdges) fields.push({ x: x0 + cx0, y: y0 + cy0, w: cw, h: ch });
    }

    // Hedgerows FIRST: tree lines along every field border while the
    // ground is still grass (a field stamped before its neighbour's
    // border would eat the hedgerow).  Dense but ragged — per-edge
    // density varies, per-tile dropout leaves gaps: uncleared growth.
    for (const f of fields) {
        for (const [bx, by, len, horiz] of [
            [f.x, f.y - 1, f.w, true], // north border
            [f.x, f.y + f.h, f.w, true], // south border
            [f.x - 1, f.y, f.h, false], // west border
            [f.x + f.w, f.y, f.h, false], // east border
        ]) {
            const edgeDensity = 0.6 + hash(grid, seed + f.x * 7 + f.y * 13 + (horiz ? 3 : 5), 23) * 0.4;
            for (let i = 0; i < len; i++) {
                const gx = bx + (horiz ? i : 0),
                    gy = by + (horiz ? 0 : i);
                if (hash(grid, gx * 31 + gy * 47, 29) > edgeDensity) continue; // ragged gaps
                placeTree(grid, gx, gy);
            }
        }
    }

    // Fields (trees already down — field stamping skips them)
    for (const f of fields) {
        for (let dy = 0; dy < f.h; dy++) {
            for (let dx = 0; dx < f.w; dx++) {
                const t = grid.getTile(f.x + dx, f.y + dy);
                if (t === T.GRASS || t === T.DARK_GRASS) grid.setTile(f.x + dx, f.y + dy, T.FIELD);
            }
        }
    }

    // Barn + silo at the district's west edge — never against a
    // compound: a building there boxes the spawn pocket.
    const barn = { x: x0 - 2, y: y0 + 1 };
    if (!isNaturalGround(grid, barn.x, barn.y) || nearBase(grid, barn.x, barn.y)) return null;
    grid.setTile(barn.x, barn.y, T.BARN);
    const silo = { x: barn.x, y: barn.y + 2 };
    if (isNaturalGround(grid, silo.x, silo.y) && !nearBase(grid, silo.x, silo.y)) grid.setTile(silo.x, silo.y, T.SILO);
    return barn;
}

/** Split [0, len) into n segments of varying sizes (guillotine cut). */
function cutEdges(start, len, n, grid, seed) {
    const cuts = [0];
    for (let i = 1; i < n; i++) {
        cuts.push(Math.round((len * i) / n + (hash(grid, seed + i * 41, 31) - 0.5) * (len / n) * 0.9));
    }
    cuts.push(len);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        const s = cuts[i],
            e = cuts[i + 1];
        if (e - s >= 3) out.push([start + s, e - s]);
    }
    return out;
}

/** A tree, only ever replacing open grass. */
function placeTree(grid, gx, gy) {
    const t = grid.getTile(gx, gy);
    if (t === T.GRASS || t === T.DARK_GRASS) grid.setTile(gx, gy, T.TREE);
}

/** Natural ground a farm building may sit on. */
function isNaturalGround(grid, gx, gy) {
    const t = grid.getTile(gx, gy);
    return t === T.GRASS || t === T.DARK_GRASS || t === T.SAND;
}

/** True if (x, y) falls within a base compound's exclusion zone. */
function nearBase(grid, x, y) {
    for (const layout of grid.baseLayouts ?? []) {
        if (distance(x, y, layout.center.x, layout.center.y) < layout.half + 9) return true;
    }
    return false;
}
