/**
 * Infantry squad sprites — each soldier drawn at its own world position
 * (billboards), plus the shared soldier/weapon helpers.
 */
import { DEFAULT_SQUAD_SLOTS } from "../../formation.js";
import { HTH, HTW, makeProjection, spriteVisible } from "../projection.js";

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
