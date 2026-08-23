/**
 * Isometric building drawing (small/medium/large destructible buildings).
 *
 * Height shrinks with damage; below 55 % the roof has collapsed (dark
 * rubble top, no windows).  Windows and doors lie in the wall planes,
 * so they are drawn as skewed parallelograms rather than rectangles.
 */

import { TILES as T, TILE_PROPS } from "../config.js";
import { createDrawHelpers } from "../draw-helpers.js";
import { lerpPt, PALETTE, scaleRgb } from "./canvas-utils.js";
import { drawDamageOverlay } from "./damage.js";
import { TH, TW } from "./projection.js";

/** Per-building-size draw data: palette + roof profile. */
const BUILDING_STYLES = {
    [T.BLDG_SMALL]: { palette: PALETTE.bldgSmall, roof: "gable", roofRise: 7 },
    [T.BLDG_MEDIUM]: { palette: PALETTE.bldgMedium, roof: "gable", roofRise: 9 },
    [T.BLDG_LARGE]: { palette: PALETTE.bldgLarge, roof: "flat" },
};

/**
 * Draw an isometric building with realistic detail:
 *   - Ground contact shadow and ambient occlusion at the wall base
 *   - Pitched gable roofs with ridge, tile rows, and eave overhang
 *     (small + medium; ridge direction varies for village variety)
 *   - Flat parapet roof with clutter for large buildings
 *   - In-plane windows (frame, glass, reflection, mullion) and doors
 *   - Chimney drawn as a small 3-D box sitting on the roof slope
 */
export function drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time) {
    const { fill } = createDrawHelpers(ctx);
    const style = BUILDING_STYLES[tile];
    const pal = style.palette;
    const fullH = TILE_PROPS[tile].height;
    const h = Math.max(2, Math.round(fullH * frac));
    const v = ((gx * 7 + gy * 13) % 3) - 1;
    const dmg = 1 - frac;
    const intact = frac > 0.55;

    const w = pal.wall,
        rf = pal.roof,
        tr = pal.trim;

    // Soot: walls darken as damage accumulates
    const soot = 1 - dmg * 0.35;
    const wallR = scaleRgb(w, soot); // right (SE) wall — lit side
    const wallL = scaleRgb(tr, soot); // left (SW) wall — shadow side
    const roofC = scaleRgb(rf, (1 - dmg * 0.25) * (1 + v * 0.04));

    // Wall-top diamond corners; wall-base corners are the tile diamond
    const N = [sx, sy - h];
    const E = [sx + TW / 2, sy + TH / 2 - h];
    const S = [sx, sy + TH - h];
    const Wp = [sx - TW / 2, sy + TH / 2 - h];
    const Eb = [sx + TW / 2, sy + TH / 2];
    const Sb = [sx, sy + TH];
    const Wb = [sx - TW / 2, sy + TH / 2];

    /* ── 1. Ground contact shadow ── */
    fill(
        [
            [sx, sy + 2],
            [sx + TW / 2 + 3, sy + TH / 2 + 2],
            [sx, sy + TH + 4],
            [sx - TW / 2 - 3, sy + TH / 2 + 2],
        ],
        "rgba(0,0,0,0.14)",
    );

    /* ── 2. Walls ── */
    fill([Wp, S, Sb, Wb], wallL); // left (SW) wall
    fill([S, E, Eb, Sb], wallR); // right (SE) wall

    // Ambient occlusion band near the ground
    const aoH = Math.min(4, Math.max(0.5, h * 0.25));
    fill([[Wp[0], Wp[1] + h - aoH], [S[0], S[1] + h - aoH], Sb, Wb], "rgba(0,0,0,0.18)");
    fill([[S[0], S[1] + h - aoH], [E[0], E[1] + h - aoH], Eb, Sb], "rgba(0,0,0,0.13)");

    // Crisp silhouette edges
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(Wp[0], Wp[1]);
    ctx.lineTo(S[0], S[1]);
    ctx.lineTo(E[0], E[1]);
    ctx.moveTo(S[0], S[1]);
    ctx.lineTo(Sb[0], Sb[1]);
    ctx.stroke();

    /* ── 3. Roof ── */
    if (!intact) {
        // Collapsed roof: dark rubble at wall top with jagged beams
        fill([N, E, S, Wp], scaleRgb(tr, 0.45));
        ctx.strokeStyle = "rgba(40,28,16,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const b1 = lerpPt(N, S, 0.3),
            b2 = lerpPt(Wp, E, 0.45);
        ctx.moveTo(b1[0], b1[1]);
        ctx.lineTo(b2[0], b2[1]);
        const b3 = lerpPt(N, S, 0.6),
            b4 = lerpPt(Wp, E, 0.7);
        ctx.moveTo(b3[0], b3[1]);
        ctx.lineTo(b4[0], b4[1]);
        ctx.stroke();
    } else if (style.roof === "flat") {
        drawFlatRoof(ctx, N, E, S, Wp, tr, rf, soot);
    } else {
        const roofDark = scaleRgb(rf, (1 - dmg * 0.25) * 0.8);
        drawGableRoof(ctx, N, E, S, Wp, style.roofRise, roofC, roofDark, tr);
    }

    /* ── 4. Windows and doors (intact buildings only) ── */
    if (intact && h >= 10) {
        const frameL = scaleRgb(tr, 1.15),
            frameR = scaleRgb(w, 0.82);
        if (tile === T.BLDG_SMALL) {
            drawWallWindow(ctx, E, S, 3, 0.3, 0.62, 5, frameR);
            drawWallDoor(ctx, Wp, S, h, 0.52, 0.8, frameL);
        } else if (tile === T.BLDG_MEDIUM) {
            drawWallWindow(ctx, E, S, 4, 0.14, 0.38, 6, frameR);
            drawWallWindow(ctx, E, S, 4, 0.58, 0.84, 6, frameR);
            drawWallWindow(ctx, Wp, S, 4, 0.14, 0.38, 6, frameL);
            drawWallDoor(ctx, Wp, S, h, 0.56, 0.84, frameL);
        } else {
            // Large: two storeys of windows
            const row2 = Math.min(h - 9, h * 0.55);
            for (const y0 of [5, row2]) {
                drawWallWindow(ctx, E, S, y0, 0.16, 0.4, 6.5, frameR);
                drawWallWindow(ctx, E, S, y0, 0.56, 0.82, 6.5, frameR);
                drawWallWindow(ctx, Wp, S, y0, 0.16, 0.4, 6.5, frameL);
            }
            drawWallDoor(ctx, Wp, S, h, 0.58, 0.86, frameL);
        }
    }

    /* ── 5. Damage overlay ── */
    if (frac < 1) {
        drawDamageOverlay(ctx, sx, sy, h, frac, time);
    }
}

/**
 * Pitched roof with two triangular slopes meeting at a centre
 * crease — the classic isometric cottage roof.  The back (N) corner
 * of the footprint is raised by the roof rise, so both slopes face
 * the viewer and the roof always reads as a complete surface (no
 * hidden far side).  The SE slope is lit, the SW slope shaded;
 * includes tile rows, eave overhang with shadow, and a small 3-D
 * chimney on the lit slope.
 */
function drawGableRoof(ctx, N, E, S, Wp, roofRise, roofC, roofDark, tr) {
    const { fill } = createDrawHelpers(ctx);
    const rh = roofRise; // peak rise above wall top
    const ov = 2.5; // eave overhang (px)

    const peak = [N[0], N[1] - rh]; // raised back corner
    const Eo = [E[0] + ov, E[1]]; // eave corners with overhang
    const So = [S[0], S[1] + ov];
    const Wo = [Wp[0] - ov, Wp[1]];

    // Eave shadow cast onto the walls below the overhang
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Wp[0], Wp[1] + 1);
    ctx.lineTo(S[0], S[1] + 1);
    ctx.lineTo(E[0], E[1] + 1);
    ctx.stroke();

    // Left (SW) slope — shaded; right (SE) slope — lit
    fill([peak, So, Wo], roofDark);
    fill([peak, Eo, So], roofC);

    // Tile rows parallel to each slope's eave edge
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const t of [0.38, 0.7]) {
        const r0 = lerpPt(peak, Eo, t);
        const r1 = lerpPt(peak, So, t);
        ctx.moveTo(r0[0], r0[1]);
        ctx.lineTo(r1[0], r1[1]);
        const l0 = lerpPt(peak, Wo, t);
        const l1 = lerpPt(peak, So, t);
        ctx.moveTo(l0[0], l0[1]);
        ctx.lineTo(l1[0], l1[1]);
    }
    ctx.stroke();

    // Centre crease (hip fold from the peak to the front eave corner)
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo(So[0], So[1]);
    ctx.stroke();

    // Peak highlight
    const hl = lerpPt(peak, So, 0.18);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo(hl[0], hl[1]);
    ctx.stroke();

    // Eave edges (define the overhang) and back silhouette
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Eo[0], Eo[1]);
    ctx.lineTo(So[0], So[1]);
    ctx.lineTo(Wo[0], Wo[1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo(Eo[0], Eo[1]);
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo(Wo[0], Wo[1]);
    ctx.stroke();

    // Chimney — small 3-D box sitting on the lit (right) slope
    const bx = (peak[0] + Eo[0] + So[0]) / 3 + 1;
    const by = (peak[1] + Eo[1] + So[1]) / 3;
    const cw2 = 2.2,
        chH = 5.5;
    const cap = [
        [bx, by - chH - cw2 * 0.5],
        [bx + cw2, by - chH],
        [bx, by - chH + cw2 * 0.5],
        [bx - cw2, by - chH],
    ];
    const drop = 4.5;
    fill([cap[3], cap[2], [cap[2][0], cap[2][1] + drop], [cap[3][0], cap[3][1] + drop]], scaleRgb(tr, 0.7));
    fill([cap[2], cap[1], [cap[1][0], cap[1][1] + drop], [cap[2][0], cap[2][1] + drop]], scaleRgb(tr, 0.9));
    fill(cap, scaleRgb(tr, 0.5));
}

/**
 * Flat roof with a parapet rim and rooftop clutter (large buildings).
 */
function drawFlatRoof(ctx, N, E, S, Wp, tr, rf, soot) {
    const { fill, outline } = createDrawHelpers(ctx);
    const lip = 2; // parapet height
    const rim = [
        [N[0], N[1] - lip],
        [E[0], E[1] - lip],
        [S[0], S[1] - lip],
        [Wp[0], Wp[1] - lip],
    ];
    fill(rim, scaleRgb(tr, soot));
    // Roof surface: inset diamond, slightly lower
    const cx = (N[0] + S[0]) / 2,
        cy = (N[1] + S[1]) / 2 - lip;
    const inset = (p) => [p[0] + (cx - p[0]) * 0.14, p[1] + (cy + lip - p[1]) * 0.14 - lip];
    const surf = [inset(rim[0]), inset(rim[1]), inset(rim[2]), inset(rim[3])];
    fill(surf, scaleRgb(rf, soot * 0.9));
    outline(surf, "rgba(0,0,0,0.3)", 0.5);

    // Stair bulkhead (small box near the W corner)
    const bx = (rim[0][0] + rim[3][0]) / 2 + 1,
        by = (rim[0][1] + rim[3][1]) / 2 + 1;
    const bw2 = 3.5,
        bh2 = 1.8,
        bH = 4;
    const bTop = [
        [bx, by - bH - bh2],
        [bx + bw2, by - bH],
        [bx, by - bH + bh2],
        [bx - bw2, by - bH],
    ];
    fill([bTop[3], bTop[2], [bTop[2][0], bTop[2][1] + bH], [bTop[3][0], bTop[3][1] + bH]], scaleRgb(tr, 0.65));
    fill([bTop[2], bTop[1], [bTop[1][0], bTop[1][1] + bH], [bTop[2][0], bTop[2][1] + bH]], scaleRgb(tr, 0.85));
    fill(bTop, scaleRgb(tr, 1.05));

    // Vent pipe near the E corner
    const vx = (rim[1][0] + rim[2][0]) / 2,
        vy = (rim[1][1] + rim[2][1]) / 2;
    ctx.strokeStyle = scaleRgb(tr, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx, vy - 5);
    ctx.stroke();
    fill(
        [
            [vx - 1.5, vy - 6],
            [vx + 1.5, vy - 6],
            [vx + 1.5, vy - 4.5],
            [vx - 1.5, vy - 4.5],
        ],
        scaleRgb(tr, 0.75),
    );
}

/**
 * Draw a window lying in a wall plane (skewed parallelogram).
 * a→b = wall top edge (screen points), y0 = px below the wall top,
 * t0..t1 = window span as fractions along the edge, wh = height.
 */
function drawWallWindow(ctx, a, b, y0, t0, t1, wh, frameCol) {
    const { fill } = createDrawHelpers(ctx);
    const topL = lerpPt(a, b, t0),
        topR = lerpPt(a, b, t1);
    const down = (p, d) => [p[0], p[1] + d];
    // Frame
    fill([down(topL, y0 - 1), down(topR, y0 - 1), down(topR, y0 + wh + 1), down(topL, y0 + wh + 1)], frameCol);
    // Glass
    fill([down(topL, y0), down(topR, y0), down(topR, y0 + wh), down(topL, y0 + wh)], "#2e3d46");
    // Reflection streak
    ctx.strokeStyle = "rgba(200,225,240,0.35)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    const r0 = down(lerpPt(a, b, t0 + (t1 - t0) * 0.18), y0 + 1);
    const r1 = down(lerpPt(a, b, t0 + (t1 - t0) * 0.5), y0 + wh - 1);
    ctx.moveTo(r0[0], r0[1]);
    ctx.lineTo(r1[0], r1[1]);
    ctx.stroke();
    // Centre mullion
    const m0 = down(lerpPt(a, b, (t0 + t1) / 2), y0);
    ctx.strokeStyle = "rgba(10,15,20,0.55)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(m0[0], m0[1]);
    ctx.lineTo(m0[0], m0[1] + wh);
    ctx.stroke();
}

/**
 * Draw a door lying in a wall plane, anchored at the wall base.
 * a→b = wall top edge, h = wall height, t0..t1 = door span.
 */
function drawWallDoor(ctx, a, b, h, t0, t1, frameCol) {
    const { fill } = createDrawHelpers(ctx);
    const doorH = Math.min(h * 0.55, 10),
        y0 = h - doorH;
    const topL = lerpPt(a, b, t0),
        topR = lerpPt(a, b, t1);
    const down = (p, d) => [p[0], p[1] + d];
    // Frame
    fill([down(topL, y0 - 1), down(topR, y0 - 1), down(topR, h), down(topL, h)], frameCol);
    // Door panel
    fill([down(topL, y0), down(topR, y0), down(topR, h), down(topL, h)], "#4a3020");
    // Lintel highlight
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(topL[0], topL[1] + y0);
    ctx.lineTo(topR[0], topR[1] + y0);
    ctx.stroke();
}
