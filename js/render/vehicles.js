/**
 * Vehicle sprites — one draw function per vehicle type plus the shared
 * dispatch.  This is the module `menu.js` imports for its vehicle
 * previews, so `drawVehicle` is the stable public entry point for drawing
 * a tank-like object (a real `Tank` or a menu `fakeTank`).
 *
 * Every sprite is defined in local space (+x = forward, +y = right),
 * rotated by the vehicle's angle and projected through the shared
 * isometric transform (`projection.js`).  Vertical height is faked by
 * drawing each layer at a screen-Y offset.
 */

import { VEHICLES } from "../config.js";
import { createDrawHelpers } from "../draw-helpers.js";
import { DEFAULT_SQUAD_SLOTS } from "../formation.js";
import { hexToRgb, mixHex, mixRgb, shadeHex } from "./canvas-utils.js";
import { HTH, HTW, makeProjection, spriteVisible, TH } from "./projection.js";

/* ── vehicle drawing (dispatch) ───────────────────────────── */

export function drawVehicle(ctx, tank, sx, sy) {
    if (tank.vehicleType === "drone") {
        drawDrone(ctx, tank, sx, sy);
    } else if (tank.vehicleType === "ifv") {
        drawIFV(ctx, tank, sx, sy);
    } else if (tank.vehicleType === "spg") {
        drawSPG(ctx, tank, sx, sy);
    } else if (tank.vehicleType === "squad") {
        drawSquad(ctx, tank, sx, sy);
    } else {
        drawTank(ctx, tank, sx, sy);
    }
}

/* ── tank drawing ─────────────────────────────────────────── */

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

/* ── squad (infantry) drawing ─────────────────────────────── */

/**
 * Draw an infantry squad: each soldier at its own world position (set
 * by the Formation steered from the squad component).  Soldiers are
 * billboards (always upright); the weapon silhouette differs by member
 * type.  Sandbags appear while digging in / dug in.
 */
export function drawSquad(ctx, tank, sx, sy) {
    if (!spriteVisible(tank)) return;

    const ca = Math.cos(tank.angle),
        sa = Math.sin(tank.angle);

    // Squad forward direction in screen space (orients weapons).
    const fdx = (ca - sa) * HTW,
        fdy = (ca + sa) * HTH;
    const flen = Math.hypot(fdx, fdy) || 1;
    const fux = fdx / flen,
        fuy = fdy / flen;

    const members = tank.aliveMembers;
    if (members?.length) {
        // Real member positions (world space) projected relative to centre.
        for (const m of members) {
            const dx = m.x - tank.x,
                dy = m.y - tank.y;
            drawSoldier(ctx, sx + (dx - dy) * HTW, sy + (dx + dy) * HTH, m.type, tank, fux, fuy);
        }
    } else {
        // Menu preview fallback: a static wedge (no squad component).
        const { P } = makeProjection(sx, sy, tank.angle);
        const types = ["rifleman", "rifleman", "mg", "rpg", "shotgun"];
        for (let i = 0; i < types.length; i++) {
            const slot = DEFAULT_SQUAD_SLOTS[i] ?? [0, 0];
            const [px, py] = P(slot[0], slot[1]);
            drawSoldier(ctx, px, py, types[i], tank, fux, fuy);
        }
    }

    // Dig-in visuals: sandbag ring (partial while digging in, full when dug in).
    const state = tank.squad?.digIn?.state ?? "roaming";
    if (state === "diggingIn" || state === "dugIn") {
        const bags = state === "dugIn" ? 6 : 3;
        ctx.fillStyle = `rgba(64,52,30,${state === "dugIn" ? 0.9 : 0.55})`;
        for (let k = 0; k < bags; k++) {
            const a = (k / 6) * Math.PI * 2;
            ctx.fillRect(sx + Math.cos(a) * 9 - 2, sy + Math.sin(a) * 5.5 - 1.5, 4, 3);
        }
    }
}

/** Draw one upright soldier figure. */
export function drawSoldier(ctx, px, py, type, tank, fux, fuy) {
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(px, py + 0.5, 3.4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.strokeStyle = tank.darkColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px - 1.2, py - 1);
    ctx.lineTo(px - 1.2, py + 0.5);
    ctx.moveTo(px + 1.2, py - 1);
    ctx.lineTo(px + 1.2, py + 0.5);
    ctx.stroke();

    // Torso
    ctx.fillStyle = tank.color;
    ctx.fillRect(px - 1.8, py - 6, 3.6, 5);

    // Head (helmet)
    ctx.fillStyle = tank.darkColor;
    ctx.beginPath();
    ctx.arc(px, py - 7.4, 1.9, 0, Math.PI * 2);
    ctx.fill();

    // Weapon silhouette
    const w = soldierWeapon(type);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = w.width;
    ctx.beginPath();
    ctx.moveTo(px, py - 3);
    ctx.lineTo(px + fux * w.len, py - 3 + fuy * w.len);
    ctx.stroke();
}

/** Weapon barrel length/width per member type. */
export function soldierWeapon(type) {
    switch (type) {
        case "rpg":
            return { len: 7, width: 3 };
        case "shotgun":
            return { len: 5, width: 2.4 };
        case "mg":
            return { len: 6.5, width: 1.6 };
        default:
            return { len: 6, width: 1.2 };
    }
}

/* ── IFV drawing ──────────────────────────────────────────── */

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

/* ── SPG drawing ──────────────────────────────────────────── */

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

/* ── drone drawing ────────────────────────────────────────── */

/**
 * Draw an FPV kamikaze quadcopter drone from isometric perspective.
 *
 * Drones hover above the ground, so the entire sprite is drawn with a
 * vertical offset and a shadow ellipse sits at ground level.
 */
export function drawDrone(ctx, tank, sx, sy) {
    const { drop, fill, lift } = createDrawHelpers(ctx);
    if (!spriteVisible(tank)) return;

    const { P } = makeProjection(sx, sy, tank.angle);

    // Hover height (bobbing)
    const hoverH = 20 + Math.sin(performance.now() / 300) * 2;

    // ── 1. Shadow on ground ──
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + TH / 4, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── 2. Arms ──
    const armLen = 0.2;
    const arms = [
        { lx: armLen, ly: armLen },
        { lx: armLen, ly: -armLen },
        { lx: -armLen, ly: armLen },
        { lx: -armLen, ly: -armLen },
    ];

    const centre = lift([P(0, 0)], -hoverH)[0];

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    for (const arm of arms) {
        const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];
        ctx.beginPath();
        ctx.moveTo(centre[0], centre[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
    }

    // ── 3. Rotor discs (fast-spinning blur) ──
    const rotorPhase = performance.now() / 40;
    for (let ai = 0; ai < arms.length; ai++) {
        const arm = arms[ai];
        const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];

        // Motion-blur disc
        ctx.fillStyle = "rgba(180,180,180,0.2)";
        ctx.beginPath();
        ctx.arc(tip[0], tip[1], 6, 0, Math.PI * 2);
        ctx.fill();

        // Blade lines (2 per rotor, rotating)
        const bladeAngle = rotorPhase + ai * 0.7;
        ctx.strokeStyle = "rgba(80,80,80,0.5)";
        ctx.lineWidth = 1.5;
        const r = 5;
        ctx.beginPath();
        for (let b = 0; b < 2; b++) {
            const a = bladeAngle + (b * Math.PI) / 2;
            const dx = Math.cos(a) * r;
            const dy = Math.sin(a) * r * 0.5; // isometric squish
            ctx.moveTo(tip[0] - dx, tip[1] - dy);
            ctx.lineTo(tip[0] + dx, tip[1] + dy);
        }
        ctx.stroke();
    }

    // ── 4. Central body ──
    const bw = 0.09,
        bh = 0.06;
    const body = lift([P(-bw, -bh), P(bw, -bh), P(bw, bh), P(-bw, bh)], -hoverH);
    fill(drop(body, 2), tank.darkColor); // body thickness
    fill(body, tank.color);
    ctx.strokeStyle = tank.darkColor;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(body[0][0], body[0][1]);
    for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
    ctx.closePath();
    ctx.stroke();

    // Warhead band (dark stripe around the payload)
    const band = lift([P(-0.015, -bh), P(0.015, -bh), P(0.015, bh), P(-0.015, bh)], -hoverH + 0.5);
    fill(band, "#26221e");

    // Dark underside indicator (payload)
    const payload = lift([P(-0.04, -0.03), P(0.04, -0.03), P(0.04, 0.03), P(-0.04, 0.03)], -hoverH + 2);
    fill(payload, tank.darkColor);

    // Camera gimbal (small ball under the nose)
    const gim = lift([P(bw + 0.02, 0)], -hoverH + 2.5)[0];
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(gim[0], gim[1], 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a5a78";
    ctx.beginPath();
    ctx.arc(gim[0] + 0.5, gim[1] + 0.3, 0.7, 0, Math.PI * 2);
    ctx.fill();

    // ── 5. Front LED (white dot, blinks) ──
    const ledOn = Math.sin(performance.now() / 200) > 0;
    if (ledOn) {
        const nose = lift([P(bw + 0.03, 0)], -hoverH)[0];
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(nose[0], nose[1], 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
}
