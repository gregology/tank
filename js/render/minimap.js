/**
 * Per-viewport minimap: a top-down square-colour map with vehicle
 * markers (shape varies by vehicle type), base-compound outlines, and
 * a border tinted with the local player's team colour.
 */

import { ROLE_PRESENTATION, TILE_VISUALS, VEHICLES } from "../config.js";

/** Marker draw functions, keyed by `VEHICLES[type].minimapShape`. */
const MARKERS = {
    cross(ctx, dx, dy) {
        ctx.fillRect(dx - 0.5, dy - 2, 1.5, 4.5);
        ctx.fillRect(dx - 2, dy - 0.5, 4.5, 1.5);
    },
    diamond(ctx, dx, dy) {
        ctx.beginPath();
        ctx.moveTo(dx, dy - 1.5);
        ctx.lineTo(dx + 1.5, dy);
        ctx.lineTo(dx, dy + 1.5);
        ctx.lineTo(dx - 1.5, dy);
        ctx.closePath();
        ctx.fill();
    },
    triangle(ctx, dx, dy) {
        ctx.beginPath();
        ctx.moveTo(dx, dy - 2);
        ctx.lineTo(dx + 2, dy + 1.5);
        ctx.lineTo(dx - 2, dy + 1.5);
        ctx.closePath();
        ctx.fill();
    },
    dot(ctx, dx, dy) {
        ctx.beginPath();
        ctx.arc(dx, dy, 1.6, 0, Math.PI * 2);
        ctx.fill();
    },
    square(ctx, dx, dy) {
        ctx.fillRect(dx - 1, dy - 1, 3, 3);
    },
};

export function drawMinimap(ctx, game, playerNum, vx, vy, vw, vh) {
    const map = game.map;
    const px = Math.max(1, Math.min(2, Math.floor(140 / Math.max(map.width, map.height)))); // scale to fit
    const mmW = map.width * px;
    const mmH = map.height * px;
    const pad = 10;
    const mmX = vx + vw - mmW - pad;
    const mmY = vy + vh - mmH - pad;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

    // Tiles (simple top-down coloured squares)
    for (let gy = 0; gy < map.height; gy++) {
        for (let gx = 0; gx < map.width; gx++) {
            const t = map.getTile(gx, gy);
            ctx.fillStyle = TILE_VISUALS[t]?.mapColor ?? "#000";
            ctx.fillRect(mmX + gx * px, mmY + gy * px, px, px);
        }
    }

    // Tank dots (shape varies by vehicle type) + role letters in team mode
    for (const t of game.allTanks) {
        if (!t.alive) continue;
        ctx.fillStyle = t.color;
        const dx = mmX + t.x * px;
        const dy = mmY + t.y * px;
        (MARKERS[VEHICLES[t.vehicleType]?.minimapShape] ?? MARKERS.square)(ctx, dx, dy);

        // Show role letter for allied bots in team mode.
        const role = game.bots?.find((b) => b.tank === t)?.role;
        if (role) {
            const letter = ROLE_PRESENTATION[role]?.letter ?? "?";
            ctx.font = "bold 7px monospace";
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.fillText(letter, dx, dy - 3);
        }
    }

    // Base compound markers
    for (const base of game.bases) {
        // Draw compound outline
        const bOx = mmX + base.origin.x * px;
        const bOy = mmY + base.origin.y * px;
        ctx.strokeStyle = base.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bOx, bOy, (base.compoundSize ?? 10) * px, (base.compoundSize ?? 10) * px);

        // HQ marker
        if (base.hq?.alive) {
            ctx.fillStyle = base.color;
            const hx = mmX + base.hq.x * px;
            const hy = mmY + base.hq.y * px;
            ctx.fillRect(hx - 2, hy - 2, 5, 5);
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(hx - 2, hy - 2, 5, 5);
        }
    }

    // Border highlight for this player
    const borderTank = game.allTanks.find((t) => t.team === playerNum) ?? game.allTanks[0];
    ctx.strokeStyle = borderTank ? borderTank.color : "#888";
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
}
