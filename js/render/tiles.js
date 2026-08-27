/**
 * Ground and elevated tile drawing.
 *
 * Flat tiles are drawn first in the viewport (they can never occlude
 * entities); elevated tiles (hills, rocks) share the depth-sorted pass so
 * their side walls correctly occlude entities behind them.  See
 * `viewport.js` for the two-pass orchestration.
 */

import { TILE_VISUALS, TILES } from "../config.js";
import { drawBuilding } from "./buildings.js";
import { PALETTE, rgb } from "./canvas-utils.js";
import { drawDamageOverlay } from "./damage.js";
import { TH, TW } from "./projection.js";

/**
 * Draw functions per `TILE_VISUALS[].draw` kind — a registry, not an
 * `if/else` chain, so a new draw kind is one entry here.
 */
/** Iso link endpoints per direction: 4 cardinal edge midpoints + the 4
 *  diagonal corner points (diagonal neighbours touch corner-to-corner;
 *  the strip runs to the shared corner, which the other tile's strip
 *  reaches from its side — a seamless band). */
const EDGE_MIDPOINTS = [
    { dx: 1, dy: 0, fx: TW / 4, fy: (TH * 3) / 4 }, // across the R–B edge
    { dx: 0, dy: -1, fx: TW / 4, fy: TH / 4 }, // across the T–R edge
    { dx: -1, dy: 0, fx: -TW / 4, fy: TH / 4 }, // across the L–T edge
    { dx: 0, dy: 1, fx: -TW / 4, fy: (TH * 3) / 4 }, // across the L–B edge
    { dx: 1, dy: 1, fx: 0, fy: TH + 2 }, // shared corner B (the neighbour's strip meets it there)
    { dx: 1, dy: -1, fx: TW / 2 + 2, fy: TH / 2 }, // shared corner R
    { dx: -1, dy: 1, fx: -TW / 2 - 2, fy: TH / 2 }, // shared corner L
    { dx: -1, dy: -1, fx: 0, fy: -2 }, // shared corner T
];

/** Which neighbours carry the road (roads + bridges), 8 directions. */
function roadMask(map, gx, gy) {
    return EDGE_MIDPOINTS.filter((e) => {
        const t = map.getTile(gx + e.dx, gy + e.dy);
        return map.isRoad(gx + e.dx, gy + e.dy) || t === TILES.BRIDGE_STONE || t === TILES.BRIDGE_WOOD;
    });
}

/**
 * Transport Tycoon-style road strips: each connected edge gets a capsule
 * (rounded band) from the tile centre to the edge midpoint — strips from
 * both tiles meet at the shared edge, so runs/curves/junctions assemble
 * seamlessly.  Per-style kerbs and centre dashes from TILE_VISUALS.
 */
function drawRoadStrips(ctx, sx, sy, links, v, style) {
    const c = { x: sx, y: sy + TH / 2 };
    const W = style.width;
    const surface = PALETTE[style.surface];
    const fill = rgb(surface.r + v, surface.g + v, surface.b + v);

    const kerb = style.kerb
        ? rgb(PALETTE[style.kerb].r + v, PALETTE[style.kerb].g + v, PALETTE[style.kerb].b + v)
        : null;
    const dashC = style.dash ? rgb(PALETTE[style.dash].r, PALETTE[style.dash].g, PALETTE[style.dash].b) : null;

    if (links.length === 0) {
        // isolated stub: a small pad
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, W / 2, W / 4, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    if (links.length >= 3) {
        // junction: one paved pad — overlapping bands would knot dark.
        // Kerbs edge the sides where nothing connects.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - TH / 2 + 6);
        ctx.lineTo(c.x + TW / 2 - 12, c.y);
        ctx.lineTo(c.x, c.y + TH / 2 - 6);
        ctx.lineTo(c.x - TW / 2 + 12, c.y);
        ctx.closePath();
        ctx.fill();
        return;
    }

    const shoulder = style.verge
        ? rgb(PALETTE[style.verge].r + v, PALETTE[style.verge].g + v, PALETTE[style.verge].b + v)
        : null;
    const capsule = (ex, ey, width, color) => {
        // a plain band from the tile centre to the edge midpoint — the
        // neighbour's band starts at the same midpoint, so strips join
        // flush (a rounded end would bead at every tile boundary)
        const ux = ex - c.x,
            uy = ey - c.y;
        const len = Math.hypot(ux, uy);
        const nx = (-uy / len) * (width / 2),
            ny = (ux / len) * (width / 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(c.x + nx, c.y + ny);
        ctx.lineTo(ex + nx, ey + ny);
        ctx.lineTo(ex - nx, ey - ny);
        ctx.lineTo(c.x - nx, c.y - ny);
        ctx.closePath();
        ctx.fill();
    };

    for (const e of links) {
        const mx = sx + e.fx,
            my = sy + e.fy;
        if (shoulder) capsule(mx, my, W + 3, shoulder); // dirt shoulder under the asphalt (tarmac only)
        capsule(mx, my, W, fill);
        if (kerb) {
            const ux = mx - c.x,
                uy = my - c.y;
            const len = Math.hypot(ux, uy);
            const nx = (-uy / len) * (W / 2),
                ny = (ux / len) * (W / 2);
            ctx.strokeStyle = kerb;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(c.x + nx, c.y + ny);
            ctx.lineTo(mx + nx, my + ny);
            ctx.moveTo(c.x - nx, c.y - ny);
            ctx.lineTo(mx - nx, my - ny);
            ctx.stroke();
        }
        if (dashC) {
            const ux = mx - c.x,
                uy = my - c.y;
            const dmx = c.x + ux * 0.55,
                dmy = c.y + uy * 0.55;
            ctx.strokeStyle = dashC;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(dmx - ux * 0.16, dmy - uy * 0.16);
            ctx.lineTo(dmx + ux * 0.16, dmy + uy * 0.16);
            ctx.stroke();
        }
    }
    // the centre square merges the strips (and caps dead ends)
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - W / 4 - 1);
    ctx.lineTo(c.x + W / 2 + 1, c.y);
    ctx.lineTo(c.x, c.y + W / 4 + 1);
    ctx.lineTo(c.x - W / 2 - 1, c.y);
    ctx.closePath();
    ctx.fill();
}

const DRAW_KINDS = {
    water(ctx, { sx, sy, gx, gy }, time, _map, visual, v) {
        const base = PALETTE[visual.color];
        const wave = Math.sin(time * 1.8 + gx * 1.3 + gy * 0.9) * 0.5 + 0.5;
        drawDiamond(
            ctx,
            sx,
            sy,
            rgb(base.r + v * 2 + wave * 12, base.g + v * 2 + wave * 16, base.b + v * 2 + wave * 22),
        );
        // subtle wave highlight
        if (wave > 0.7) {
            ctx.globalAlpha = (wave - 0.7) * 1.5;
            drawDiamond(ctx, sx, sy, "rgba(180,210,240,0.15)");
            ctx.globalAlpha = 1;
        }
    },
    // Ploughed field: a warm diamond with darker furrow stripes, plus the
    // occasional hay bale (purely cosmetic).
    field(ctx, { sx, sy, gx, gy }, _time, _map, visual, v) {
        const c = PALETTE[visual.color];
        drawDiamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
        // furrows: two stripes across the diamond
        ctx.fillStyle = rgb(c.r - 26 + v * 2, c.g - 24 + v * 2, c.b - 18 + v * 2);
        for (const fy of [sy + TH / 4, sy + (TH * 3) / 4]) {
            ctx.beginPath();
            ctx.moveTo(sx - TW / 4, fy - 1);
            ctx.lineTo(sx, fy - TH / 4 - 1);
            ctx.lineTo(sx + TW / 4, fy - 1);
            ctx.lineTo(sx, fy + TH / 4 + 1);
            ctx.closePath();
            ctx.fill();
        }
        // round hay bales scattered through the field (deterministic
        // per position) — big enough to read as bales at tile scale
        if ((gx * 5 + gy * 11) % 7 === 0) {
            const bx = sx,
                by = sy + TH / 2 - 3;
            ctx.fillStyle = rgb(PALETTE.hay.r - 30, PALETTE.hay.g - 30, PALETTE.hay.b - 25);
            ctx.beginPath();
            ctx.ellipse(bx, by + 3, 6, 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = rgb(PALETTE.hay.r, PALETTE.hay.g, PALETTE.hay.b);
            ctx.beginPath();
            ctx.ellipse(bx, by, 5, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = rgb(PALETTE.hay.r + 20, PALETTE.hay.g + 18, PALETTE.hay.b + 12);
            ctx.beginPath();
            ctx.ellipse(bx - 1, by - 2, 2.5, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    },
    // Hedgerow scrub: a cluster of low bushes hugging the ground — a
    // forest's edge, not a row of discrete trees.  Low mounds, two
    // greens, slight raise so the depth pass occludes what's behind.
    bush(ctx, { sx, sy, gx, gy, tile }, _time, map, _visual, v) {
        const h = map.tileHeight(tile);
        const baseY = sy + TH / 2;
        const rng = (gx * 31 + gy * 47) % 7; // per-tile variation
        const mounds = [
            { ox: -10 + (rng % 3), oy: 2, rx: 13, ry: 9, c: PALETTE.bushDark },
            { ox: 9 - (rng % 4), oy: 4, rx: 12, ry: 8, c: PALETTE.treeCanopy },
            { ox: -1 + (rng % 5) - 2, oy: -4, rx: 11, ry: 8, c: PALETTE.treeCanopy },
            { ox: 2, oy: -8 - h * 0.2, rx: 8, ry: 6, c: PALETTE.treeCanopyLight },
        ];
        for (const m of mounds) {
            ctx.fillStyle = rgb(m.c.r + v * 3, m.c.g + v * 3, m.c.b + v * 3);
            ctx.beginPath();
            ctx.ellipse(sx + m.ox, baseY + m.oy - h * 0.3, m.rx, m.ry, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    },
    // Roads, Transport Tycoon-style: every road tile draws by its
    // connection mask — a surface strip from the tile centre to each
    // connected edge, with per-style kerbs/dashes from TILE_VISUALS.
    // Junctions and crossings fall out of the strips; a new road type is
    // one tile + one style row.
    road(ctx, { sx, sy, gx, gy }, _time, map, visual, v) {
        const style = visual.road;
        // The tile's ground stays terrain-toned (grass corners show, like
        // TT's road-over-landscape sprites) — a full-tile verge diamond
        // reads as a wide mud band, not a road.
        const grass = PALETTE.grass;
        drawDiamond(ctx, sx, sy, rgb(grass.r + v * 3, grass.g + v * 3, grass.b + v * 2));
        drawRoadStrips(ctx, sx, sy, roadMask(map, gx, gy), v, style);
    },
    // Bridges: a deck diamond with darker kerbs along the sides that face
    // water.  Stone bridges read as masonry; wooden bridges get plank
    // lines along the deck.
    bridge(ctx, { sx, sy, gx, gy, tile }, _time, map, _visual, v) {
        const wooden = tile === TILES.BRIDGE_WOOD;
        const c = wooden ? PALETTE.wood : PALETTE.stone;
        const dark = wooden ? PALETTE.woodDark : PALETTE.stoneDark;
        drawDiamond(ctx, sx, sy, rgb(c.r + v * 2, c.g + v * 2, c.b + v * 2));
        if (wooden) {
            // plank seams along the deck
            ctx.fillStyle = rgb(dark.r + v * 2, dark.g + v * 2, dark.b + v * 2);
            ctx.fillRect(sx - TW / 4, sy + TH / 4 - 0.5, TW / 2, 1);
            ctx.fillRect(sx - TW / 4, sy + (TH * 3) / 4 - 0.5, TW / 2, 1);
        }
        // The deck carries the road: bands along the bridge's recorded
        // crossing axis only (the deck's along-channel neighbours are
        // bridge tiles too — masking by road-neighbours alone would
        // waffle the deck), so the stone/wood margins read at the edges.
        const bridge = (map.bridges ?? []).find(
            (b) => gx >= b.span.x0 && gx <= b.span.x1 && gy >= b.span.y0 && gy <= b.span.y1,
        );
        const axisLinks = bridge
            ? EDGE_MIDPOINTS.slice(0, 4).filter((e) => (bridge.axis === "h" ? e.dy === 0 : e.dx === 0))
            : EDGE_MIDPOINTS.slice(0, 4).filter((e) => {
                  const t = map.getTile(gx + e.dx, gy + e.dy);
                  return map.isRoad(gx + e.dx, gy + e.dy) || t === TILES.BRIDGE_STONE || t === TILES.BRIDGE_WOOD;
              });
        drawRoadStrips(ctx, sx, sy, axisLinks, v, {
            surface: "tarmac",
            kerb: null,
            dash: "roadDash",
            verge: null,
            width: 8,
        });
        ctx.fillStyle = rgb(dark.r + v * 2, dark.g + v * 2, dark.b + v * 2);
        const waterAt = (dx, dy) => {
            const t = map.getTile(gx + dx, gy + dy);
            return map.isWaterTile(t);
        };
        if (waterAt(0, -1)) ctx.fillRect(sx - TW / 2, sy - 2, TW, 3);
        if (waterAt(0, 1)) ctx.fillRect(sx - TW / 2, sy + TH - 1, TW, 3);
        if (waterAt(-1, 0)) {
            ctx.beginPath();
            ctx.moveTo(sx - TW / 2, sy + TH / 2 - 2);
            ctx.lineTo(sx, sy - 2);
            ctx.lineTo(sx, sy + 2);
            ctx.lineTo(sx - TW / 2, sy + TH / 2 + 2);
            ctx.closePath();
            ctx.fill();
        }
        if (waterAt(1, 0)) {
            ctx.beginPath();
            ctx.moveTo(sx + TW / 2, sy + TH / 2 - 2);
            ctx.lineTo(sx, sy - 2);
            ctx.lineTo(sx, sy + 2);
            ctx.lineTo(sx + TW / 2, sy + TH / 2 + 2);
            ctx.closePath();
            ctx.fill();
        }
    },
    flat(ctx, { sx, sy }, _time, _map, visual, v) {
        const c = PALETTE[visual.color];
        const m = visual.variation;
        drawDiamond(ctx, sx, sy, rgb(c.r + v * m.r, c.g + v * m.g, c.b + v * m.b));
    },
    elevated(ctx, { sx, sy, gx, gy, tile }, time, map, visual, v) {
        const frac = map.getDamageFraction(gx, gy);
        const h = Math.round(map.tileHeight(tile) * frac);
        drawElevatedTile(ctx, sx, sy, h, PALETTE[visual.top], PALETTE[visual.left], PALETTE[visual.right], v);
        if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
    },
    building(ctx, { sx, sy, gx, gy, tile }, time, map) {
        const frac = map.getDamageFraction(gx, gy);
        drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time);
    },
};

/**
 * Draw one tile at its projected screen position.
 * @param {{gx:number, gy:number, tile:number, sx:number, sy:number}} tilePos
 */
export function drawTile(ctx, { gx, gy, tile, sx, sy }, time, map) {
    const visual = TILE_VISUALS[tile];
    if (!visual) return;

    // Colour variation per tile based on position.
    const v = ((gx * 7 + gy * 13) % 5) - 2; // −2 … +2

    DRAW_KINDS[visual.draw]?.(ctx, { gx, gy, tile, sx, sy }, time, map, visual, v);
    // "none" (base-structure tile) has no entry and draws nothing.
}

/** Draw a flat isometric diamond (top face of a ground-level tile). */
function drawDiamond(ctx, sx, sy, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + TW / 2, sy + TH / 2);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx - TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();
}

/** Draw an elevated tile (top face + two visible side faces). */
function drawElevatedTile(ctx, sx, sy, h, topC, leftC, rightC, v) {
    // Left (SW) side
    ctx.fillStyle = rgb(leftC.r + v * 2, leftC.g + v * 2, leftC.b + v * 2);
    ctx.beginPath();
    ctx.moveTo(sx - TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx - TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();

    // Right (SE) side
    ctx.fillStyle = rgb(rightC.r + v * 2, rightC.g + v * 2, rightC.b + v * 2);
    ctx.beginPath();
    ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx, sy + TH);
    ctx.lineTo(sx + TW / 2, sy + TH / 2);
    ctx.closePath();
    ctx.fill();

    // Top face
    ctx.fillStyle = rgb(topC.r + v * 3, topC.g + v * 3, topC.b + v * 3);
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
    ctx.closePath();
    ctx.fill();
}
