/**
 * Damage overlay for elevated terrain and structures: darkens the top
 * face proportionally to damage, strokes deterministic crack lines, and
 * flashes when the tile is nearly destroyed.
 *
 * Shared by tiles (hills/rocks), buildings, and base structures, so a
 * damage-visual change is one edit instead of three.
 */

import { TH, TW } from "./projection.js";

/**
 * Overlay cracks and darkening on a damaged elevated tile or structure.
 * `frac` = 1 (undamaged) → 0 (about to break).
 */
export function drawDamageOverlay(ctx, sx, sy, h, frac, time) {
    const dmg = 1 - frac; // 0 = no damage, 1 = nearly dead

    // Darken the top face proportionally to damage
    ctx.globalAlpha = dmg * 0.45;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
    ctx.lineTo(sx, sy + TH - h);
    ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Crack lines – more cracks at higher damage
    const crackCount = Math.ceil(dmg * 5);
    ctx.strokeStyle = `rgba(0,0,0,${0.3 + dmg * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Seed cracks deterministically from tile position
    const seedX = sx * 7 + sy * 13;
    for (let i = 0; i < crackCount; i++) {
        // Pseudo-random offsets within the top diamond
        const a = Math.sin(seedX + i * 37.7) * 0.35;
        const b = Math.cos(seedX + i * 53.3) * 0.35;
        const cx1 = sx + a * TW * 0.4;
        const cy1 = sy - h + TH / 2 + b * TH * 0.4;
        const a2 = Math.sin(seedX + i * 71.1) * 0.35;
        const b2 = Math.cos(seedX + i * 91.9) * 0.35;
        const cx2 = sx + a2 * TW * 0.4;
        const cy2 = sy - h + TH / 2 + b2 * TH * 0.4;
        ctx.moveTo(cx1, cy1);
        ctx.lineTo(cx2, cy2);
    }
    ctx.stroke();

    // Flash white briefly when at critical damage
    if (frac <= 0.34 && Math.sin(time * 10) > 0.5) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#ff4400";
        ctx.beginPath();
        ctx.moveTo(sx, sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}
