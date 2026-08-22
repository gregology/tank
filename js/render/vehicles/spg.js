/**
 * SPG sprite — a hold-to-charge self-propelled artillery piece.
 */
import { VEHICLES } from "../../config.js";
import { createDrawHelpers } from "../../draw-helpers.js";
import { hexToRgb, mixRgb } from "../canvas-utils.js";
import { makeProjection, spriteVisible } from "../projection.js";

/**
 * Draw a Self-Propelled Gun (artillery).  Visually very different from a tank:
 *   - Much longer chassis with rear-mounted turret
 *   - Massive boxy turret (tallest vehicle in the game)
 *   - Very long barrel with visible upward elevation
 *   - Rear hydraulic spade/stabiliser
 *   - Stowage bins and camo netting on hull
 *   - Olive-tinted hull colour mixed with team colour
 */
export function drawSPG(ctx, tank, sx, sy) {
    const { drop, fill, lift, outline, slab } = createDrawHelpers(ctx);
    if (!spriteVisible(tank)) return;

    const { P, PT } = makeProjection(sx, sy, tank.angle, tank.turretWorld);

    // Olive drab tint: mix team colour with military green
    const teamRGB = hexToRgb(tank.color);
    const teamDarkRGB = hexToRgb(tank.darkColor);
    const olive = [85, 95, 55];
    const oliveDark = [50, 58, 32];
    const hullColor = tank.damaged ? mixRgb(teamDarkRGB, oliveDark, 0.45) : mixRgb(teamRGB, olive, 0.45);
    const hullDark = tank.damaged ? "#1a1a1a" : mixRgb(teamDarkRGB, oliveDark, 0.45);
    const hullAccent = tank.damaged ? mixRgb(teamDarkRGB, oliveDark, 0.6) : mixRgb(teamRGB, olive, 0.6);

    /* ── SPG dimensions — MUCH longer chassis, rear turret ── */
    const THL = 0.5; // track half-length (much longer than tank 0.38)
    const TYO = 0.32; // track outer Y (wider)
    const TYI = 0.22; // track inner Y
    const HR = -0.46; // hull rear X (extends far back)
    const HF = 0.36; // hull front X
    const HW = 0.24; // hull half-width (wider)

    // Turret is rear-mounted: centred at -0.08 (behind hull centre)
    const TURR_CX = -0.08;
    const TRX = 0.22; // turret half-length X (big)
    const TRY = 0.18; // turret half-width Y (big)

    // Barrel — very long, with upward elevation (screen-Y offset)
    const BHW = 0.04; // barrel half-width (thick)
    const BX0 = TURR_CX + TRX - 0.02; // starts at turret front
    let BX1 = 0.72; // barrel end X (very long)
    const BARR_ELEV = 6; // pixels the barrel tip is raised above base

    const TRACK_H = 5; // taller tracks (heavier feel)
    const HULL_H = 6;
    const TURR_H = 9; // very tall turret (tallest vehicle)
    const BARR_H = 3;

    if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.14;

    const trackTop = -TRACK_H;
    const hullTop = -(TRACK_H + HULL_H);
    const turrTop = -(TRACK_H + HULL_H + TURR_H);
    const barrBase = -(TRACK_H + HULL_H + BARR_H + 2); // barrel sits high

    /* ── 1. Shadow (longer) ── */
    fill(
        drop(
            [
                P(-THL - 0.06, -TYO - 0.03),
                P(THL + 0.06, -TYO - 0.03),
                P(THL + 0.06, TYO + 0.03),
                P(-THL - 0.06, TYO + 0.03),
            ],
            7,
        ),
        "rgba(0,0,0,0.2)",
    );

    /* ── 2. Tracks (wider, heavier — red-brown if disabled) ── */
    const lTrackColor = tank.leftTrackDisabled ? "#5a2a1a" : "#282828";
    const lTrackWall = tank.leftTrackDisabled ? "#3a1a0a" : "#0e0e0e";
    const lTrack = lift([P(-THL, -TYO), P(THL, -TYO), P(THL, -TYI), P(-THL, -TYI)], trackTop);
    slab(lTrack, TRACK_H, lTrackColor, lTrackWall);
    const rTrackColor = tank.rightTrackDisabled ? "#5a2a1a" : "#282828";
    const rTrackWall = tank.rightTrackDisabled ? "#3a1a0a" : "#0e0e0e";
    const rTrack = lift([P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)], trackTop);
    slab(rTrack, TRACK_H, rTrackColor, rTrackWall);

    // Tread marks (more treads = heavier vehicle)
    const TREAD_N = 14;
    ctx.strokeStyle = "#3e3e3e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < TREAD_N; i++) {
        const t = (i / TREAD_N + tank.treadPhase) % 1;
        const lx = -THL + t * THL * 2;
        const a1 = lift([P(lx, -TYO)], trackTop)[0];
        const a2 = lift([P(lx, -TYI)], trackTop)[0];
        ctx.moveTo(a1[0], a1[1]);
        ctx.lineTo(a2[0], a2[1]);
        const b1 = lift([P(lx, TYI)], trackTop)[0];
        const b2 = lift([P(lx, TYO)], trackTop)[0];
        ctx.moveTo(b1[0], b1[1]);
        ctx.lineTo(b2[0], b2[1]);
    }
    ctx.stroke();

    // Track wheels (5 road wheels — heavier)
    ctx.fillStyle = "#181818";
    for (let i = 0; i < 5; i++) {
        const lx = -THL * 0.8 + i * THL * 0.4;
        for (const side of [-1, 1]) {
            const cy = side > 0 ? (TYO + TYI) / 2 : -(TYO + TYI) / 2;
            const c = lift([P(lx, cy)], trackTop)[0];
            ctx.beginPath();
            ctx.arc(c[0], c[1], 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── 3. Hull — long flat bed with sloped front ── */
    // Sloped glacis plate at front (angled, not flat like IFV)
    const hullPts = lift(
        [
            P(HR, -HW), // rear left
            P(HF - 0.08, -HW), // front left
            P(HF, -HW + 0.06), // glacis left
            P(HF, HW - 0.06), // glacis right
            P(HF - 0.08, HW), // front right
            P(HR, HW), // rear right
        ],
        hullTop,
    );
    slab(hullPts, HULL_H, hullColor, hullDark);
    outline(hullPts, hullDark, 0.6);

    // ── Rear spade / stabiliser (distinctive SPG feature) ──
    // Two angled arms extending down and back from the rear hull
    const spadeW = 0.06;
    const spadeL = 0.14;
    for (const side of [-1, 1]) {
        const sy2 = HW * 0.5 * side;
        const spadePts = lift(
            [
                P(HR, sy2 - spadeW),
                P(HR - spadeL, sy2 - spadeW * 1.5),
                P(HR - spadeL, sy2 + spadeW * 1.5),
                P(HR, sy2 + spadeW),
            ],
            hullTop,
        );
        slab(spadePts, HULL_H + 3, "#4a4a4a", "#2a2a2a");
        // Spade blade (flat plate at end)
        const bladePts = lift(
            [
                P(HR - spadeL, sy2 - spadeW * 2),
                P(HR - spadeL - 0.03, sy2 - spadeW * 2),
                P(HR - spadeL - 0.03, sy2 + spadeW * 2),
                P(HR - spadeL, sy2 + spadeW * 2),
            ],
            hullTop + 2,
        );
        fill(bladePts, "#3a3a3a");
    }

    // ── Hull rear panel ──
    fill(
        lift([P(HR, -HW + 0.03), P(HR + 0.04, -HW + 0.03), P(HR + 0.04, HW - 0.03), P(HR, HW - 0.03)], hullTop),
        hullDark,
    );

    // ── Engine deck at front (ahead of turret, lower profile) ──
    const deckPts = lift(
        [
            P(TURR_CX + TRX + 0.04, -HW + 0.03),
            P(HF - 0.1, -HW + 0.03),
            P(HF - 0.1, HW - 0.03),
            P(TURR_CX + TRX + 0.04, HW - 0.03),
        ],
        hullTop,
    );
    slab(deckPts, 2, hullAccent, hullDark);

    // Engine grille lines on deck
    ctx.strokeStyle = hullDark;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
        const fx = TURR_CX + TRX + 0.06 + i * 0.04;
        const g1 = lift([P(fx, -HW + 0.06)], hullTop)[0];
        const g2 = lift([P(fx, HW - 0.06)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(g1[0], g1[1]);
        ctx.lineTo(g2[0], g2[1]);
        ctx.stroke();
    }

    // ── Stowage bins on hull sides (olive boxes) ──
    for (const side of [-1, 1]) {
        const binY = HW * side;
        const bin = lift(
            [P(-0.3, binY - 0.04 * side), P(0.0, binY - 0.04 * side), P(0.0, binY), P(-0.3, binY)],
            hullTop,
        );
        slab(bin, 3, "#5a6340", "#3a4228");
        // Bin latch
        ctx.fillStyle = "#777";
        const latch = lift([P(-0.15, binY - 0.01 * side)], hullTop - 1)[0];
        ctx.fillRect(latch[0] - 1, latch[1], 2, 1.5);
    }

    // ── Camo netting draped over rear hull ──
    ctx.strokeStyle = "rgba(70,80,50,0.4)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
        const nx = HR + 0.08 + i * 0.06;
        const n1 = lift([P(nx, -HW * 0.8)], hullTop - 1)[0];
        const n2 = lift([P(nx + 0.04, HW * 0.3)], hullTop)[0];
        const n3 = lift([P(nx - 0.02, HW * 0.7)], hullTop - 1)[0];
        ctx.beginPath();
        ctx.moveTo(n1[0], n1[1]);
        ctx.quadraticCurveTo(n2[0], n2[1], n3[0], n3[1]);
        ctx.stroke();
    }

    /* ── 4. Barrel — very long, with upward elevation ── */
    // The barrel is drawn with the tip raised higher on screen to
    // simulate the howitzer's upward angle.  We interpolate the
    // vertical offset along the barrel length.
    const barrLen = BX1 - BX0;
    const barrSegs = 6; // draw as segmented trapezoid for elevation
    for (let i = 0; i < barrSegs; i++) {
        const t0 = i / barrSegs;
        const t1 = (i + 1) / barrSegs;
        const x0 = BX0 + barrLen * t0;
        const x1 = BX0 + barrLen * t1;
        const elev0 = barrBase - BARR_ELEV * t0;
        const elev1 = barrBase - BARR_ELEV * t1;
        const seg = [
            [PT(x0, -BHW)[0], PT(x0, -BHW)[1] + elev0],
            [PT(x1, -BHW)[0], PT(x1, -BHW)[1] + elev1],
            [PT(x1, BHW)[0], PT(x1, BHW)[1] + elev1],
            [PT(x0, BHW)[0], PT(x0, BHW)[1] + elev0],
        ];
        const shade = tank.turretDisabled ? (i % 2 === 0 ? "#3a3a3a" : "#404040") : i % 2 === 0 ? "#5a5a5a" : "#606060";
        slab(seg, BARR_H, shade, tank.turretDisabled ? "#222" : "#333");
    }

    // Muzzle brake (wide, distinctive)
    const mx = BX1;
    const mElev = barrBase - BARR_ELEV;
    const muzzle = [
        [PT(mx - 0.04, -BHW - 0.025)[0], PT(mx - 0.04, -BHW - 0.025)[1] + mElev],
        [PT(mx + 0.02, -BHW - 0.025)[0], PT(mx + 0.02, -BHW - 0.025)[1] + mElev],
        [PT(mx + 0.02, BHW + 0.025)[0], PT(mx + 0.02, BHW + 0.025)[1] + mElev],
        [PT(mx - 0.04, BHW + 0.025)[0], PT(mx - 0.04, BHW + 0.025)[1] + mElev],
    ];
    slab(muzzle, BARR_H, "#707070", "#404040");

    // Fume extractor (bulge mid-barrel)
    const fmX = BX0 + barrLen * 0.35;
    const fmElev = barrBase - BARR_ELEV * 0.35;
    const fume = [
        [PT(fmX - 0.025, -BHW - 0.015)[0], PT(fmX - 0.025, -BHW - 0.015)[1] + fmElev],
        [PT(fmX + 0.025, -BHW - 0.015)[0], PT(fmX + 0.025, -BHW - 0.015)[1] + fmElev],
        [PT(fmX + 0.025, BHW + 0.015)[0], PT(fmX + 0.025, BHW + 0.015)[1] + fmElev],
        [PT(fmX - 0.025, BHW + 0.015)[0], PT(fmX - 0.025, BHW + 0.015)[1] + fmElev],
    ];
    slab(fume, BARR_H + 1, "#686868", "#3a3a3a");

    /* ── 5. Turret — massive rear-mounted box (tallest vehicle) ── */
    const tPts = lift(
        [
            PT(TURR_CX - TRX, -TRY),
            PT(TURR_CX + TRX - 0.04, -TRY), // slight bevel
            PT(TURR_CX + TRX, -TRY + 0.04),
            PT(TURR_CX + TRX, TRY - 0.04),
            PT(TURR_CX + TRX - 0.04, TRY),
            PT(TURR_CX - TRX, TRY),
        ],
        turrTop,
    );
    const turretCol = tank.turretDisabled ? "#555" : mixRgb(teamRGB, olive, 0.3);
    const turretDark = tank.turretDisabled ? "#333" : hullDark;
    slab(tPts, TURR_H, turretCol, turretDark);
    outline(tPts, turretDark, 0.7);

    // Turret side armour plates (raised panels)
    for (const side of [-1, 1]) {
        const pY = TRY * side;
        const panel = lift(
            [
                PT(TURR_CX - TRX + 0.04, pY - 0.03 * side),
                PT(TURR_CX + TRX - 0.06, pY - 0.03 * side),
                PT(TURR_CX + TRX - 0.06, pY),
                PT(TURR_CX - TRX + 0.04, pY),
            ],
            turrTop,
        );
        fill(panel, hullDark);
    }

    // Turret bustle (overhang at rear for ammo storage)
    const bustle = lift(
        [
            PT(TURR_CX - TRX - 0.08, -TRY + 0.02),
            PT(TURR_CX - TRX, -TRY + 0.02),
            PT(TURR_CX - TRX, TRY - 0.02),
            PT(TURR_CX - TRX - 0.08, TRY - 0.02),
        ],
        turrTop,
    );
    slab(bustle, TURR_H - 1, "#5a6340", hullDark);

    // Commander's cupola (raised circle on turret roof)
    const cupN = 8,
        cupR = 0.055;
    const cupCX = TURR_CX - 0.06,
        cupCY = -TRY * 0.35;
    const cupPts = [];
    for (let i = 0; i < cupN; i++) {
        const a = (i / cupN) * Math.PI * 2;
        cupPts.push(lift([PT(cupCX + Math.cos(a) * cupR, cupCY + Math.sin(a) * cupR)], turrTop - 3)[0]);
    }
    slab(cupPts, 3, hullAccent, hullDark);

    // Periscopes (small rectangles on cupola)
    const periPts = lift(
        [
            PT(cupCX + cupR * 0.6, cupCY - 0.015),
            PT(cupCX + cupR * 0.6 + 0.025, cupCY - 0.015),
            PT(cupCX + cupR * 0.6 + 0.025, cupCY + 0.015),
            PT(cupCX + cupR * 0.6, cupCY + 0.015),
        ],
        turrTop - 4,
    );
    fill(periPts, "#224");

    // Turret front vision slit
    const vs1 = lift([PT(TURR_CX + TRX - 0.02, -TRY * 0.35)], turrTop)[0];
    const vs2 = lift([PT(TURR_CX + TRX - 0.02, TRY * 0.35)], turrTop)[0];
    ctx.strokeStyle = "#1a1a22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vs1[0], vs1[1]);
    ctx.lineTo(vs2[0], vs2[1]);
    ctx.stroke();

    // ── Antenna on turret rear ──
    const antBase = lift([PT(TURR_CX - TRX + 0.03, -TRY + 0.03)], turrTop)[0];
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(antBase[0], antBase[1]);
    ctx.lineTo(antBase[0] + 1, antBase[1] - 14);
    ctx.stroke();
    // Antenna tip
    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(antBase[0] + 1, antBase[1] - 14, 1, 0, Math.PI * 2);
    ctx.fill();

    /* ── 6. Charge indicator (ring above turret while charging) ── */
    if (tank.isCharging) {
        const vStats = VEHICLES.spg;
        const maxCharge = (vStats.maxRange - vStats.minRange) / vStats.chargeRate;
        const frac = Math.min(1, tank.chargeTime / maxCharge);
        const center = lift([PT(TURR_CX, 0)], turrTop - 8)[0];
        const ringR = 5 + frac * 7;
        ctx.strokeStyle = frac > 0.9 ? "rgba(255,50,0,0.85)" : "rgba(255,180,0,0.65)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(center[0], center[1], ringR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        // Tick mark at full charge
        if (frac > 0.95) {
            ctx.fillStyle = "rgba(255,50,0,0.9)";
            ctx.beginPath();
            ctx.arc(center[0], center[1] - ringR, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
