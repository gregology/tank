/**
 * Settlements stage — villages grow around the road network.
 *
 * The roads come FIRST (they connect bases, bridges, and farms);
 * villages then pop up where settlement naturally happens: at road
 * junctions, and at intervals along long straight stretches (ribbon
 * development).  A village is a cluster of buildings flanking the
 * existing road — the through-road is its main street — never its own
 * separate street grid.
 */

import { TILES as T } from "../../config.js";
import { distance } from "../../utils.js";
import { hash } from "../noise.js";
import { styleFor } from "./terrain.js";

/**
 * Place a building beside a road — the shared rule for every
 * settlement building: never on roads/water/existing structures,
 * never within 2 tiles of a bridge span (buildings there block the
 * approach and read as clutter).  A new bridge shape only has to keep
 * its `span` record honest and stays protected.
 */
export function placeBuildingBesideRoad(grid, gx, gy, tile) {
    if (grid.isRoad(gx, gy)) return false;
    if (!isNaturalGround(grid, gx, gy)) return false;
    if (nearBase(grid, gx, gy)) return false;
    if (nearBridge(grid, gx, gy)) return false;
    grid.setTile(gx, gy, tile);
    return true;
}

/** Within 2 tiles of any bridge span (the deck + approach). */
function nearBridge(grid, x, y) {
    for (const b of grid.bridges ?? []) {
        if (x >= b.span.x0 - 2 && x <= b.span.x1 + 2 && y >= b.span.y0 - 2 && y <= b.span.y1 + 2) return true;
    }
    return false;
}

/** Find village sites on the road network and stamp them. */
export function placeVillages(grid, ctx) {
    const density = grid.villageDensity;
    const mapScale = Math.min(grid.width, grid.height) / 64;
    const minSep = Math.max(8, Math.round(12 * mapScale));
    const sites = [];

    for (const site of junctionSites(grid)) maybeAdd(sites, site, minSep, grid, density);
    for (const site of ribbonSites(grid)) maybeAdd(sites, site, minSep, grid, density);

    ctx.villages = sites;
    for (const site of sites) stampRibbonVillage(grid, site);
}

/** Junctions: road tiles with 3+ road connections (clustered). */
function junctionSites(grid) {
    const junctionTiles = [];
    for (let y = 1; y < grid.height - 1; y++) {
        for (let x = 1; x < grid.width - 1; x++) {
            if (!isRoadTile(grid, x, y)) continue;
            const links = roadLinks(grid, x, y);
            if (links >= 3) junctionTiles.push({ x, y });
        }
    }
    // cluster adjacent junction tiles into one site (the centroid)
    const sites = [];
    const used = new Set();
    for (const t of junctionTiles) {
        const key = `${t.x},${t.y}`;
        if (used.has(key)) continue;
        const cluster = junctionTiles.filter((o) => Math.abs(o.x - t.x) <= 2 && Math.abs(o.y - t.y) <= 2);
        for (const o of cluster) used.add(`${o.x},${o.y}`);
        // the site must be ON the road — the junction tile nearest the
        // cluster's centroid (a bare centroid can land off-road, and a
        // ribbon village that isn't on the road stamps nothing)
        const cx = cluster.reduce((s, o) => s + o.x, 0) / cluster.length,
            cy = cluster.reduce((s, o) => s + o.y, 0) / cluster.length;
        const onRoad = cluster.reduce((best, o) =>
            Math.hypot(o.x - cx, o.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? o : best,
        );
        sites.push({ x: onRoad.x, y: onRoad.y });
    }
    return sites;
}

/** Ribbon sites: intervals along long straight road runs. */
function ribbonSites(grid) {
    const sites = [];
    for (const horiz of [true, false]) {
        const outer = horiz ? grid.height : grid.width;
        const inner = horiz ? grid.width : grid.height;
        for (let o = 1; o < outer - 1; o++) {
            let run = 0;
            for (let i = 1; i < inner - 1; i++) {
                const x = horiz ? i : o,
                    y = horiz ? o : i;
                if (isRoadTile(grid, x, y) && roadLinks(grid, x, y) === 2) {
                    run++;
                    if (run > 0 && run % 12 === 0) sites.push({ x, y }); // a village every long stretch
                } else {
                    run = 0;
                }
            }
        }
    }
    return sites;
}

/** A site joins unless it's too close to another village, a compound, or a bridge. */
function maybeAdd(sites, site, minSep, grid, density) {
    if (hash(grid, site.x * 7 + site.y * 13, 2300) > density) return; // density thins sites
    if (sites.some((s) => distance(s.x, s.y, site.x, site.y) < minSep)) return;
    if (nearBase(grid, site.x, site.y)) return;
    if (nearBridge(grid, site.x, site.y)) return; // villages don't crowd crossings
    sites.push(site);
}

/** Village shape (data, so village types stay a table): a main street
 *  along the through-road's direction, cross lanes of dirt, buildings
 *  dense on both sides of every street. */
const VILLAGE = {
    mainStreet: { tile: T.TARMAC, halfLenMin: 5, halfLenVar: 4 },
    lanes: { count: 2, tile: T.DIRT, halfLenMin: 3, halfLenVar: 3 },
    buildingSkip: 0.22, // gaps between buildings
};

/**
 * A village is a place, not a line: a main street (tarmac, extending the
 * through-road), cross lanes (dirt), and dense buildings flanking every
 * street — the lanes join the road network back (villages create roads).
 */
function stampRibbonVillage(grid, site) {
    const style = styleFor(grid);
    const seed = site.x * 101 + site.y * 977;

    // The through-road's direction at the site
    const horiz = isRoadTile(grid, site.x - 1, site.y) || isRoadTile(grid, site.x + 1, site.y);
    const dx = horiz ? 1 : 0,
        dy = horiz ? 0 : 1;
    const px = dy,
        py = dx;

    const stampStreet = (ox, oy, ddx, ddy, halfLen, tile, { paveOverDirt = false } = {}) => {
        for (let i = -halfLen; i <= halfLen; i++) {
            const rx = ox + ddx * i,
                ry = oy + ddy * i;
            if (isNaturalGround(grid, rx, ry)) grid.setTile(rx, ry, tile);
            // a village's main street upgrades the through road to tarmac
            // (dirt lanes never overwrite — they'd mix surfaces on one line)
            else if (paveOverDirt && grid.getTile(rx, ry) === T.DIRT) grid.setTile(rx, ry, tile);
        }
    };

    // Main street + cross lanes
    const mainHalf = VILLAGE.mainStreet.halfLenMin + Math.floor(hash(grid, seed, 2400) * VILLAGE.mainStreet.halfLenVar);
    stampStreet(site.x, site.y, dx, dy, mainHalf, VILLAGE.mainStreet.tile, { paveOverDirt: true });
    const laneOffsets = [-2, 2];
    const lanes = [];
    for (let l = 0; l < VILLAGE.lanes.count; l++) {
        const off = laneOffsets[l] ?? 0;
        const lx = site.x + dx * off,
            ly = site.y + dy * off;
        const laneHalf =
            VILLAGE.lanes.halfLenMin + Math.floor(hash(grid, seed + l * 71, 2500) * VILLAGE.lanes.halfLenVar);
        stampStreet(lx, ly, px, py, laneHalf, VILLAGE.lanes.tile);
        lanes.push({ x: lx, y: ly, dx: px, dy: py, halfLen: laneHalf });
    }

    // Buildings: dense, flanking the main street and every lane
    const streets = [{ x: site.x, y: site.y, dx, dy, halfLen: mainHalf }, ...lanes];
    for (const street of streets) {
        for (let i = -street.halfLen; i <= street.halfLen; i++) {
            const rx = street.x + street.dx * i,
                ry = street.y + street.dy * i;
            if (!isRoadTile(grid, rx, ry)) continue;
            const ppx = street.dy,
                ppy = street.dx;
            for (const side of [-1, 1]) {
                if (hash(grid, seed + i * 13 + side * 37 + street.halfLen * 7, 2600) < VILLAGE.buildingSkip) continue;
                let bx = -1,
                    by = -1;
                for (let k = 1; k <= 2; k++) {
                    const tx = rx + ppx * side * k,
                        ty = ry + ppy * side * k;
                    if (!grid.isRoad(tx, ty)) {
                        bx = tx;
                        by = ty;
                        break;
                    }
                }
                if (bx < 0) continue;
                const sizeRoll = hash(grid, seed + i * 23 + side * 53 + street.halfLen, 2700);
                let bldgType;
                if (sizeRoll < 0.45) bldgType = style.buildings.small;
                else if (sizeRoll < 0.8) bldgType = style.buildings.medium;
                else bldgType = style.buildings.large;
                placeBuildingBesideRoad(grid, bx, by, bldgType);
            }
        }
    }
}

/** How many cardinal neighbours are road tiles (roads + bridges). */
function roadLinks(grid, x, y) {
    let n = 0;
    for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        if (isRoadTile(grid, x + dx, y + dy)) n++;
    }
    return n;
}

function isRoadTile(grid, x, y) {
    return grid.isRoad(x, y); // covers DIRT/TARMAC/BRIDGE_* via TILE_PROPS.road
}

/** True for tiles a settlement may paint over (grass/sand/dirt — never
 *  water, bridges, or existing structures). */
function isNaturalGround(grid, gx, gy) {
    const t = grid.getTile(gx, gy);
    return t !== undefined && !grid.isWaterTile(t) && !grid.isSolid(t) && t !== T.BRIDGE_STONE && t !== T.BRIDGE_WOOD;
}

/** True if (x, y) falls within a base compound's exclusion zone. */
function nearBase(grid, x, y) {
    for (const layout of grid.baseLayouts) {
        if (distance(x, y, layout.center.x, layout.center.y) < layout.half + 8) return true;
    }
    return false;
}
