/**
 * Tank sprite — a fully-rotated isometric tank with visible 3-D depth.
 * The default sprite, also used as the fallback for unknown vehicle types.
 */

import { createDrawHelpers } from "../../draw-helpers.js";
import { mixHex, shadeHex } from "../canvas-utils.js";
import { makeProjection, spriteVisible } from "../projection.js";

/**
 * Draw a fully-rotated isometric tank with visible 3-D depth.
 *
 * Layers stack ground → tracks → wheels → side skirts → hull → barrel →
 * turret.  Walls are shaded per-face by `slabLit` (screen-space normals),
 * so the lighting stays consistent as the tank rotates.  The hull and
 * tracks use the hull angle; turret, mantlet and barrel use the
 * world-space turretWorld (hull angle + turret offset).
 */
export function drawTank(ctx, tank, sx, sy) {
    const { drop, fill, lift, outline, slab, slabLit } = createDrawHelpers(ctx);
    if (!spriteVisible(tank)) return;

    const { P, PT } = makeProjection(sx, sy, tank.angle, tank.turretWorld);

    /* ── local-space dimensions (world units) ───────── */
    const THL = 0.38; // track half-length
    const TYO = 0.3; // track outer Y
    const TYI = 0.21; // track inner Y
    const HR = -0.28; // hull rear X
    const HF = 0.24; // hull front X
    const HT = 0.34; // hull pointed tip X
    const HW = 0.2; // hull half-width Y
    const TR = 0.13; // turret radius
    const BHW = 0.03; // barrel half-width
    const BX0 = 0.1; // barrel start X
    let BX1 = 0.52; // barrel end X
    const TRACK_H = 4; // track extrusion height (px)
    const HULL_H = 7; // hull extrusion height (px)
    const TURR_H = 5; // turret extrusion height (px)
    const BARR_H = 3; // barrel extrusion height (px)

    if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.1;

    // ── Vertical offsets (cumulative, lower = further down screen) ──
    const trackTop = -TRACK_H; // tracks sit on ground
    const hullTop = -(TRACK_H + HULL_H); // hull sits on tracks
    const turrTop = -(TRACK_H + HULL_H + TURR_H); // turret on hull
    const barrTop = -(TRACK_H + HULL_H + BARR_H); // barrel on hull

    // Directional wall shades matching the terrain lighting
    // (SW faces dark, SE faces bright).
    const hullColor = tank.damaged ? tank.darkColor : tank.color;
    const wallL = tank.damaged ? "#101010" : shadeHex(tank.darkColor, 0.7);
    const wallR = tank.damaged ? "#1e1e1e" : tank.darkColor;

    /* ── 1. Shadow ──────────────────────────────────── */
    fill(
        drop(
            [
                P(-THL - 0.04, -TYO - 0.02),
                P(THL + 0.04, -TYO - 0.02),
                P(THL + 0.04, TYO + 0.02),
                P(-THL - 0.04, TYO + 0.02),
            ],
            6,
        ),
        "rgba(0,0,0,0.18)",
    );

    /* ── 2. Tracks (hull angle) ─────────────────────── */
    const lTrackColor = tank.leftTrackDisabled ? "#5a2a1a" : "#2a2a2a";
    const lTrackWall = tank.leftTrackDisabled ? "#3a1a0a" : "#111";
    const lTrackTop = lift([P(-THL, -TYO), P(THL, -TYO), P(THL, -TYI), P(-THL, -TYI)], trackTop);
    slab(lTrackTop, TRACK_H, lTrackColor, lTrackWall);

    const rTrackColor = tank.rightTrackDisabled ? "#5a2a1a" : "#2a2a2a";
    const rTrackWall = tank.rightTrackDisabled ? "#3a1a0a" : "#111";
    const rTrackTop = lift([P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)], trackTop);
    slab(rTrackTop, TRACK_H, rTrackColor, rTrackWall);

    // Tread marks on the track top faces (scroll with movement).
    // Skipped on disabled tracks; outer part hides under the skirts.
    const TREAD_N = 8;
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < TREAD_N; i++) {
        const t = (i / TREAD_N + tank.treadPhase) % 1;
        const lx = -THL + t * THL * 2;
        if (!tank.leftTrackDisabled) {
            const a1 = lift([P(lx, -TYO)], trackTop)[0];
            const a2 = lift([P(lx, -TYI)], trackTop)[0];
            ctx.moveTo(a1[0], a1[1]);
            ctx.lineTo(a2[0], a2[1]);
        }
        if (!tank.rightTrackDisabled) {
            const b1 = lift([P(lx, TYI)], trackTop)[0];
            const b2 = lift([P(lx, TYO)], trackTop)[0];
            ctx.moveTo(b1[0], b1[1]);
            ctx.lineTo(b2[0], b2[1]);
        }
    }
    ctx.stroke();

    /* ── 3. Road wheels (two-tone, peeking beside the skirts) ── */
    for (const side of [-1, 1]) {
        const disabled = side < 0 ? tank.leftTrackDisabled : tank.rightTrackDisabled;
        const cy = side * 0.235;
        for (let i = 0; i < 4; i++) {
            const lx = THL * (-0.72 + i * 0.48);
            const c = lift([P(lx, cy)], trackTop)[0];
            // Tyre
            ctx.fillStyle = disabled ? "#2a150a" : "#131313";
            ctx.beginPath();
            ctx.arc(c[0], c[1], 2.5, 0, Math.PI * 2);
            ctx.fill();
            // Rim
            ctx.fillStyle = disabled ? "#452312" : "#3f3f3f";
            ctx.beginPath();
            ctx.arc(c[0], c[1], 1.4, 0, Math.PI * 2);
            ctx.fill();
            // Hub
            ctx.fillStyle = disabled ? "#2a150a" : "#666";
            ctx.beginPath();
            ctx.arc(c[0], c[1], 0.55, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Damage cracks on disabled tracks
    if (tank.leftTrackDisabled) {
        ctx.strokeStyle = "#2a0a00";
        ctx.lineWidth = 1;
        const c1 = lift([P(-THL * 0.3, -(TYO + TYI) / 2)], trackTop)[0];
        const c2 = lift([P(THL * 0.3, -(TYO * 0.7 + TYI * 0.3))], trackTop)[0];
        ctx.beginPath();
        ctx.moveTo(c1[0], c1[1]);
        ctx.lineTo(c2[0], c2[1]);
        ctx.stroke();
    }
    if (tank.rightTrackDisabled) {
        ctx.strokeStyle = "#2a0a00";
        ctx.lineWidth = 1;
        const c1 = lift([P(-THL * 0.2, (TYO + TYI) / 2)], trackTop)[0];
        const c2 = lift([P(THL * 0.2, TYO * 0.7 + TYI * 0.3)], trackTop)[0];
        ctx.beginPath();
        ctx.moveTo(c1[0], c1[1]);
        ctx.lineTo(c2[0], c2[1]);
        ctx.stroke();
    }

    /* ── 4. Side skirts (armour plates over the tracks) ── */
    const skirtIn = 0.27;
    const mkSkirt = (side) =>
        lift(
            [
                P(-THL * 0.96, side * (TYO + 0.012)),
                P(THL * 0.92, side * (TYO + 0.012)),
                P(THL * 0.92, side * skirtIn),
                P(-THL * 0.96, side * skirtIn),
            ],
            trackTop - 1,
        );
    const skirtTopL = tank.leftTrackDisabled ? "#4a2a18" : mixHex(hullColor, "#000000", 0.25);
    const skirtWallL = tank.leftTrackDisabled ? "#2a150a" : mixHex(hullColor, "#000000", 0.55);
    slab(mkSkirt(-1), 3, skirtTopL, skirtWallL);
    const skirtTopR = tank.rightTrackDisabled ? "#4a2a18" : mixHex(hullColor, "#000000", 0.25);
    const skirtWallR = tank.rightTrackDisabled ? "#2a150a" : mixHex(hullColor, "#000000", 0.55);
    slab(mkSkirt(1), 3, skirtTopR, skirtWallR);

    /* ── 5. Hull (hull angle) ───────────────────────── */
    const hullPts = lift([P(HR, -HW), P(HF, -HW), P(HT, 0), P(HF, HW), P(HR, HW)], hullTop);
    slabLit(hullPts, HULL_H, hullColor, wallL, wallR);
    outline(hullPts, wallL, 0.5);

    // Sloped glacis plate highlight (front wedge)
    fill(lift([P(HF, -HW * 0.9), P(HT - 0.01, 0), P(HF, HW * 0.9)], hullTop - 0.4), mixHex(hullColor, "#ffffff", 0.12));

    // Engine deck vents (rear)
    ctx.strokeStyle = wallL;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
        const v0 = lift([P(HR + 0.05 + i * 0.04, -HW * 0.72)], hullTop)[0];
        const v1 = lift([P(HR + 0.05 + i * 0.04, HW * 0.72)], hullTop)[0];
        ctx.moveTo(v0[0], v0[1]);
        ctx.lineTo(v1[0], v1[1]);
    }
    ctx.stroke();

    // Exhaust outlet (rear-left corner)
    const ex = lift([P(HR - 0.005, -HW * 0.55)], hullTop + 1)[0];
    ctx.fillStyle = "#1c1c1c";
    ctx.beginPath();
    ctx.arc(ex[0], ex[1], 1.4, 0, Math.PI * 2);
    ctx.fill();

    /* ── 6. Barrel (turret angle) ───────────────────── */
    const barrColor = tank.turretDisabled ? "#444" : "#5e6368";
    const barrDark = tank.turretDisabled ? "#222" : "#303338";
    const barrPts = lift([PT(BX0, -BHW), PT(BX1, -BHW), PT(BX1, BHW), PT(BX0, BHW)], barrTop);
    slab(barrPts, BARR_H, barrColor, barrDark);

    // Fume extractor (bulge ~55 % along the barrel)
    const fmX = BX0 + (BX1 - BX0) * 0.55;
    const fume = lift(
        [
            PT(fmX - 0.018, -BHW - 0.009),
            PT(fmX + 0.018, -BHW - 0.009),
            PT(fmX + 0.018, BHW + 0.009),
            PT(fmX - 0.018, BHW + 0.009),
        ],
        barrTop,
    );
    slab(fume, BARR_H + 0.5, tank.turretDisabled ? "#484848" : barrColor, tank.turretDisabled ? "#262626" : barrDark);

    // Muzzle brake (wider tip)
    const MZ = 0.04;
    const muzzle = lift(
        [
            PT(BX1 - MZ, -BHW - 0.015),
            PT(BX1 + 0.01, -BHW - 0.015),
            PT(BX1 + 0.01, BHW + 0.015),
            PT(BX1 - MZ, BHW + 0.015),
        ],
        barrTop,
    );
    slab(muzzle, BARR_H, tank.turretDisabled ? "#555" : "#777", tank.turretDisabled ? "#333" : "#444");

    /* ── 7. Turret (turret angle) ───────────────────── */
    const turretColor = tank.turretDisabled ? "#555" : tank.color;
    const turretWallL = tank.turretDisabled ? "#2c2c2c" : wallL;
    const turretWallR = tank.turretDisabled ? "#3d3d3d" : wallR;
    // Angular heptagon: pointed nose, wide mid, flat rear
    const turrRaw = [
        [1.05, 0],
        [0.55, -0.8],
        [-0.55, -0.92],
        [-0.95, -0.5],
        [-0.95, 0.5],
        [-0.55, 0.92],
        [0.55, 0.8],
    ];
    // Turret ring: dark footprint on the hull, seats the turret
    fill(
        lift(
            turrRaw.map(([px, py]) => PT(px * TR * 1.12, py * TR * 1.12)),
            hullTop,
        ),
        turretWallL,
    );
    const tPts = lift(
        turrRaw.map(([px, py]) => PT(px * TR, py * TR)),
        turrTop,
    );
    slabLit(tPts, TURR_H, turretColor, turretWallL, turretWallR);
    outline(tPts, turretWallL, 0.5);

    // Gun mantlet (reinforced block where the barrel emerges)
    const MW = TR * 0.34;
    const mant = lift([PT(TR * 0.72, -MW), PT(TR * 1.14, -MW), PT(TR * 1.14, MW), PT(TR * 0.72, MW)], turrTop + 1);
    slab(mant, TURR_H - 1, tank.turretDisabled ? "#4a4a4a" : "#4d5257", tank.turretDisabled ? "#2a2a2a" : "#2c3033");

    // Commander hatch (slightly rear-left of centre)
    const hatchC = [-TR * 0.18, -TR * 0.15];
    const hN = 8,
        hR = TR * 0.34;
    const hatch = [];
    for (let i = 0; i < hN; i++) {
        const a = (i / hN) * Math.PI * 2;
        hatch.push(lift([PT(hatchC[0] + Math.cos(a) * hR, hatchC[1] + Math.sin(a) * hR)], turrTop - 1)[0]);
    }
    fill(hatch, tank.turretDisabled ? "#3a3a3a" : shadeHex(tank.color, 0.8));
    outline(hatch, turretWallL, 0.5);

    // Periscopes (two small blocks ahead of the hatch)
    ctx.fillStyle = "#1d2530";
    for (const off of [
        [TR * 0.32, -TR * 0.28],
        [TR * 0.34, -TR * 0.02],
    ]) {
        const p = lift([PT(hatchC[0] + off[0], hatchC[1] + off[1])], turrTop - 0.5)[0];
        ctx.fillRect(p[0] - 0.7, p[1] - 0.6, 1.4, 1.2);
    }

    // Rear stowage basket (thin U-shaped outline)
    ctx.strokeStyle = turretWallL;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    const bPts = [
        [-0.98, -0.42],
        [-1.18, -0.42],
        [-1.18, 0.42],
        [-0.98, 0.42],
    ].map(([px, py]) => lift([PT(px * TR, py * TR)], turrTop + 1)[0]);
    ctx.moveTo(bPts[0][0], bPts[0][1]);
    for (let i = 1; i < bPts.length; i++) ctx.lineTo(bPts[i][0], bPts[i][1]);
    ctx.stroke();

    // Antenna whip (turret rear-right)
    if (!tank.turretDisabled) {
        const ant = lift([PT(-TR * 0.8, -TR * 0.55)], turrTop)[0];
        ctx.strokeStyle = "rgba(40,40,40,0.8)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(ant[0], ant[1]);
        ctx.lineTo(ant[0] + 1, ant[1] - 11);
        ctx.stroke();
    }

    // Disabled-turret marker: red ✕ over the turret centre
    if (tank.turretDisabled) {
        ctx.strokeStyle = "#cc2222";
        ctx.lineWidth = 1.5;
        const x1 = lift([PT(-TR * 0.25, -TR * 0.25)], turrTop)[0];
        const x2 = lift([PT(TR * 0.25, TR * 0.25)], turrTop)[0];
        const x3 = lift([PT(-TR * 0.25, TR * 0.25)], turrTop)[0];
        const x4 = lift([PT(TR * 0.25, -TR * 0.25)], turrTop)[0];
        ctx.beginPath();
        ctx.moveTo(x1[0], x1[1]);
        ctx.lineTo(x2[0], x2[1]);
        ctx.moveTo(x3[0], x3[1]);
        ctx.lineTo(x4[0], x4[1]);
        ctx.stroke();
    }
}
