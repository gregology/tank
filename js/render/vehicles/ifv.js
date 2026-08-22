/**
 * IFV sprite — a wheeled, fixed-turret infantry fighting vehicle.
 */

import { createDrawHelpers } from "../../draw-helpers.js";
import { mixHex, shadeHex } from "../canvas-utils.js";
import { makeProjection, spriteVisible } from "../projection.js";

/**
 * Draw a wheeled IFV.  Visually very different from a tank:
 *   - Wide, flat-bodied APC shape (vs narrow pointed tank)
 *   - 4 large visible wheels per side (vs continuous tracks)
 *   - Olive/khaki hull tint overlaid on team colour
 *   - Small boxy fixed turret (vs circular rotating turret)
 *   - White chevron marking on hull top
 */
export function drawIFV(ctx, tank, sx, sy) {
    const { drop, fill, lift, outline, slab, slabLit } = createDrawHelpers(ctx);
    if (!spriteVisible(tank)) return;

    const { P } = makeProjection(sx, sy, tank.angle);

    /* ── IFV is WIDER and FLATTER than a tank ───── */
    const SHL = 0.36; // hull half-length
    const SHW = 0.26; // hull half-width (MUCH wider than tank's 0.20)
    const SWO = 0.3; // wheel outer Y (beyond hull)
    const BHW = 0.02; // barrel half-width (thin autocannon)
    const BX0 = 0.05; // barrel start X
    let BX1 = 0.48; // barrel end X
    const MHW = 0.07; // turret mount half-width
    const MHL = 0.1; // turret mount half-length

    const WHEEL_H = 4;
    const HULL_H = 4; // flat (vs tank 7)
    const MOUNT_H = 3;
    const BARR_H = 2;

    if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.06;

    const wheelTop = -WHEEL_H;
    const hullTop = -(WHEEL_H + HULL_H);
    const mountTop = -(WHEEL_H + HULL_H + MOUNT_H);
    const barrTop = -(WHEEL_H + HULL_H + BARR_H);

    // Darken hull colour when damaged
    const hullColor = tank.damaged ? tank.darkColor : tank.color;
    const hullDark = tank.damaged ? "#1a1a1a" : tank.darkColor;
    // Directional wall shades (terrain lighting: SW dark, SE bright)
    const wallL = tank.damaged ? "#101010" : shadeHex(tank.darkColor, 0.7);
    const wallR = tank.damaged ? "#1e1e1e" : tank.darkColor;

    /* ── 1. Shadow ──────────────────────────────────── */
    fill(
        drop(
            [
                P(-SHL - 0.04, -SWO - 0.03),
                P(SHL + 0.04, -SWO - 0.03),
                P(SHL + 0.04, SWO + 0.03),
                P(-SHL - 0.04, SWO + 0.03),
            ],
            5,
        ),
        "rgba(0,0,0,0.2)",
    );

    /* ── 2. Wheels — 4 per side, large and visible ──── */
    const wheelXs = [-0.24, -0.08, 0.08, 0.24];
    const wheelR = 4.5; // much larger than before (was 3.2)
    for (const wx of wheelXs) {
        for (const side of [-1, 1]) {
            const sideDisabled = side < 0 ? tank.leftTrackDisabled : tank.rightTrackDisabled;
            const wc = lift([P(wx, SWO * side)], wheelTop)[0];
            // Tyre (dark, red-brown if track disabled)
            ctx.fillStyle = sideDisabled ? "#5a2a1a" : "#1a1a1a";
            ctx.beginPath();
            ctx.arc(wc[0], wc[1], wheelR, 0, Math.PI * 2);
            ctx.fill();
            // Rim (lighter)
            ctx.fillStyle = sideDisabled ? "#6a3a2a" : "#555";
            ctx.beginPath();
            ctx.arc(wc[0], wc[1], wheelR * 0.5, 0, Math.PI * 2);
            ctx.fill();
            // Spinning hub cross (skip if disabled)
            if (!sideDisabled) {
                const spA = tank.treadPhase * Math.PI * 2;
                ctx.strokeStyle = "#777";
                ctx.lineWidth = 1;
                ctx.beginPath();
                const dx1 = Math.cos(spA) * wheelR * 0.35;
                const dy1 = Math.sin(spA) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx1, wc[1] - dy1 * 0.5);
                ctx.lineTo(wc[0] + dx1, wc[1] + dy1 * 0.5);
                const dx2 = Math.cos(spA + Math.PI / 2) * wheelR * 0.35;
                const dy2 = Math.sin(spA + Math.PI / 2) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx2, wc[1] - dy2 * 0.5);
                ctx.lineTo(wc[0] + dx2, wc[1] + dy2 * 0.5);
                ctx.stroke();
            }
        }
    }

    /* ── 2b. Fenders (thin mudguards over the wheels) ── */
    for (const side of [-1, 1]) {
        const fender = lift(
            [
                P(-SHL * 0.92, side * (SWO + 0.008)),
                P(SHL * 0.92, side * (SWO + 0.008)),
                P(SHL * 0.92, side * (SWO - 0.035)),
                P(-SHL * 0.92, side * (SWO - 0.035)),
            ],
            wheelTop - 1,
        );
        slab(fender, 2, mixHex(hullColor, "#000000", 0.35), mixHex(hullColor, "#000000", 0.6));
    }

    /* ── 3. Hull — wide box with a chamfered nose ── */
    // Sloped front corners suggest the glacis of a real APC
    const hullPts = lift(
        [
            P(-SHL, -SHW),
            P(SHL - 0.09, -SHW), // chamfer start
            P(SHL, -SHW + 0.08), // nose corner
            P(SHL, SHW - 0.08),
            P(SHL - 0.09, SHW),
            P(-SHL, SHW),
        ],
        hullTop,
    );
    slabLit(hullPts, HULL_H, hullColor, wallL, wallR);
    outline(hullPts, wallL, 0.7);

    // Vision ports on the chamfered nose faces
    ctx.fillStyle = "#1c242c";
    for (const vy of [-SHW * 0.55, SHW * 0.55]) {
        const vp = lift([P(SHL - 0.055, vy)], hullTop - 0.5)[0];
        ctx.fillRect(vp[0] - 1, vp[1] - 0.7, 2.2, 1.4);
    }

    // Rear panel
    fill(
        lift(
            [P(-SHL, -SHW + 0.03), P(-SHL + 0.04, -SHW + 0.03), P(-SHL + 0.04, SHW - 0.03), P(-SHL, SHW - 0.03)],
            hullTop,
        ),
        hullDark,
    );

    // ── White chevron on hull top (iconic IFV marking) ──
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    const chev1 = lift([P(0.12, -SHW * 0.6)], hullTop)[0];
    const chev2 = lift([P(0.22, 0)], hullTop)[0];
    const chev3 = lift([P(0.12, SHW * 0.6)], hullTop)[0];
    ctx.beginPath();
    ctx.moveTo(chev1[0], chev1[1]);
    ctx.lineTo(chev2[0], chev2[1]);
    ctx.lineTo(chev3[0], chev3[1]);
    ctx.stroke();

    // ── Side armour panels (thick white stripe) ──
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5;
    const s1 = lift([P(-SHL + 0.05, -SHW)], hullTop)[0];
    const s2 = lift([P(SHL - 0.05, -SHW)], hullTop)[0];
    ctx.beginPath();
    ctx.moveTo(s1[0], s1[1]);
    ctx.lineTo(s2[0], s2[1]);
    ctx.stroke();
    const s3 = lift([P(-SHL + 0.05, SHW)], hullTop)[0];
    const s4 = lift([P(SHL - 0.05, SHW)], hullTop)[0];
    ctx.beginPath();
    ctx.moveTo(s3[0], s3[1]);
    ctx.lineTo(s4[0], s4[1]);
    ctx.stroke();

    // Hull cross-bar detail
    ctx.strokeStyle = hullDark;
    ctx.lineWidth = 0.6;
    const cb1 = lift([P(-0.1, -SHW)], hullTop)[0];
    const cb2 = lift([P(-0.1, SHW)], hullTop)[0];
    ctx.beginPath();
    ctx.moveTo(cb1[0], cb1[1]);
    ctx.lineTo(cb2[0], cb2[1]);
    ctx.stroke();

    /* ── 4. Barrel (thin autocannon, hull angle) ────── */
    const barrPts = lift([P(BX0, -BHW), P(BX1, -BHW), P(BX1, BHW), P(BX0, BHW)], barrTop);
    slab(barrPts, BARR_H, "#777", "#444");

    // Muzzle brake
    const muzzle = lift(
        [
            P(BX1 - 0.02, -BHW - 0.008),
            P(BX1 + 0.005, -BHW - 0.008),
            P(BX1 + 0.005, BHW + 0.008),
            P(BX1 - 0.02, BHW + 0.008),
        ],
        barrTop,
    );
    slab(muzzle, BARR_H, "#888", "#555");

    /* ── 5. Gun mount — small angular box (NOT circular) ── */
    const mountPts = lift([P(-MHL, -MHW), P(MHL, -MHW), P(MHL, MHW), P(-MHL, MHW)], mountTop);
    slabLit(mountPts, MOUNT_H, hullColor, wallL, wallR);
    outline(mountPts, wallL, 0.5);

    // Hatch on the mount roof
    const hatch = lift(
        [P(-MHL * 0.5, -MHW * 0.45), P(MHL * 0.1, -MHW * 0.45), P(MHL * 0.1, MHW * 0.45), P(-MHL * 0.5, MHW * 0.45)],
        mountTop - 0.5,
    );
    fill(hatch, shadeHex(tank.color, 0.75));

    // Vision slit on front of mount
    ctx.fillStyle = "#222";
    const vs1 = lift([P(MHL - 0.01, -MHW * 0.5)], mountTop)[0];
    const vs2 = lift([P(MHL - 0.01, MHW * 0.5)], mountTop)[0];
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(vs1[0], vs1[1]);
    ctx.lineTo(vs2[0], vs2[1]);
    ctx.stroke();
}
