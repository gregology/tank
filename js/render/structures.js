/**
 * Base-compound structure drawing: fortification walls, watch towers, and
 * the 1×2 HQ tent.  All three shrink with damage and darken toward the
 * team colour as they are hit; damaged structures get the shared tile
 * damage overlay.
 */

import { BASE_STRUCTURES } from "../config.js";
import { darken, mixGrey } from "./canvas-utils.js";
import { drawDamageOverlay } from "./damage.js";
import { TH, TW } from "./projection.js";

/** Dispatch to the appropriate draw function for a base structure. */
export function drawBaseStructure(ctx, entity, sx, sy, time) {
    switch (entity.entityType) {
        case "baseWall":
            drawBaseWall(ctx, entity, sx, sy, time);
            break;
        case "baseTower":
            drawWatchTower(ctx, entity, sx, sy, time);
            break;
        case "baseHQ":
            drawBaseHQ(ctx, entity, sx, sy, time);
            break;
    }
}

/**
 * Draw a 1×1 fortification wall block.  Team-coloured, shrinks with damage.
 */
export function drawBaseWall(ctx, wall, sx, sy, time) {
    const frac = wall.damageFraction;
    const cfg = BASE_STRUCTURES.baseWall;
    const fullH = cfg.visHeight;
    const h = Math.max(2, Math.round(fullH * frac));

    const S = 0.45;
    const bw = S * TW;
    const bd = S * TH;

    const dmg = 1 - frac;

    // Mix team colour with concrete grey, then darken with damage
    const topCol = darken(mixGrey(wall.color, 160, 0.5), dmg);
    const leftCol = darken(mixGrey(wall.darkColor, 100, 0.5), dmg);
    const rightCol = darken(mixGrey(wall.darkColor, 120, 0.5), dmg * 0.7);

    // Left (SW) wall
    ctx.fillStyle = leftCol;
    ctx.beginPath();
    ctx.moveTo(sx - bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx, sy + bd);
    ctx.lineTo(sx - bw, sy);
    ctx.closePath();
    ctx.fill();

    // Right (SE) wall
    ctx.fillStyle = rightCol;
    ctx.beginPath();
    ctx.moveTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx, sy + bd);
    ctx.lineTo(sx + bw, sy);
    ctx.closePath();
    ctx.fill();

    // Top face
    ctx.fillStyle = topCol;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bd - h);
    ctx.lineTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx - bw, sy - h);
    ctx.closePath();
    ctx.fill();

    // Horizontal mortar line on top
    if (h >= 5) {
        ctx.strokeStyle = leftCol;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx - bw * 0.6, sy - h + 1);
        ctx.lineTo(sx + bw * 0.6, sy - h + 1);
        ctx.stroke();
    }

    if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
}

/**
 * Draw a 1×1 watch tower — twice wall height, with a gun barrel.
 */
export function drawWatchTower(ctx, tower, sx, sy, time) {
    const frac = tower.damageFraction;
    const cfg = BASE_STRUCTURES.baseTower;
    const fullH = cfg.visHeight;
    const h = Math.max(3, Math.round(fullH * frac));

    const S = 0.45;
    const bw = S * TW;
    const bd = S * TH;

    const dmg = 1 - frac;

    const topCol = darken(tower.color, dmg);
    const leftCol = darken(tower.darkColor, dmg);
    const rightCol = darken(tower.darkColor, dmg * 0.7);

    // Left (SW) wall
    ctx.fillStyle = leftCol;
    ctx.beginPath();
    ctx.moveTo(sx - bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx, sy + bd);
    ctx.lineTo(sx - bw, sy);
    ctx.closePath();
    ctx.fill();

    // Right (SE) wall
    ctx.fillStyle = rightCol;
    ctx.beginPath();
    ctx.moveTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx, sy + bd);
    ctx.lineTo(sx + bw, sy);
    ctx.closePath();
    ctx.fill();

    // Top face (platform)
    ctx.fillStyle = topCol;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bd - h);
    ctx.lineTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx - bw, sy - h);
    ctx.closePath();
    ctx.fill();

    // Platform edge (darker line)
    ctx.strokeStyle = leftCol;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bd - h);
    ctx.lineTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx - bw, sy - h);
    ctx.closePath();
    ctx.stroke();

    // Crenellations at top
    if (frac > 0.3) {
        const mH = 4;
        const mw = bw * 0.25;
        ctx.fillStyle = leftCol;
        const merlons = [
            [sx, sy - bd - h - mH],
            [sx + bw * 0.7, sy - h - mH + 2],
            [sx - bw * 0.7, sy - h - mH + 2],
        ];
        for (const [mx, my] of merlons) {
            ctx.fillRect(mx - mw / 2, my, mw, mH);
        }
    }

    // Gun barrel (rotates toward target)
    if (frac > 0.2) {
        const gunLen = 10;
        const gunY = sy - h - 2;
        const angle = tower.turretAngle;
        // Project barrel tip through isometric transform
        const dx = Math.cos(angle) * gunLen;
        const dy = Math.sin(angle) * gunLen * 0.5; // iso squish
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(sx, gunY);
        ctx.lineTo(sx + dx, gunY + dy);
        ctx.stroke();
        // Muzzle
        ctx.fillStyle = "#666";
        ctx.beginPath();
        ctx.arc(sx + dx, gunY + dy, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // HP bar
    const barW = 30,
        barH = 4;
    const barX = sx - barW / 2,
        barY = sy - h - 14;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = frac > 0.5 ? "#4a4" : frac > 0.25 ? "#da4" : "#d44";
    ctx.fillRect(barX, barY, barW * frac, barH);

    if (frac < 1) drawDamageOverlay(ctx, sx, sy, h, frac, time);
}

/**
 * Draw a 1×2 HQ building as a simple cuboid spanning 2 tiles.
 * Same isometric block approach as walls but using the exact
 * 2-tile diamond footprint.  Team-coloured, shrinks with damage.
 */
export function drawBaseHQ(ctx, hq, sx, sy, time) {
    const frac = hq.damageFraction;
    const fullH = BASE_STRUCTURES.baseHQ.visHeight;
    const h = Math.max(3, Math.round(fullH * frac));

    const dmg = 1 - frac;

    // Exact 2-tile isometric diamond vertices relative to entity centre
    const isHoriz = hq.tilePositions[1].gx !== hq.tilePositions[0].gx;
    const hw = TW / 4,
        hh = (3 * TH) / 4;
    const lw = (3 * TW) / 4,
        lh = TH / 4;
    let N, E, S, W;
    if (isHoriz) {
        N = { x: sx - hw, y: sy - hh };
        E = { x: sx + lw, y: sy + lh };
        S = { x: sx + hw, y: sy + hh };
        W = { x: sx - lw, y: sy - lh };
    } else {
        N = { x: sx + hw, y: sy - hh };
        E = { x: sx + lw, y: sy - lh };
        S = { x: sx - hw, y: sy + hh };
        W = { x: sx - lw, y: sy + lh };
    }

    const topCol = darken(hq.color, dmg);
    const leftCol = darken(hq.darkColor, dmg);
    const rightCol = darken(hq.darkColor, dmg * 0.7);

    // -- Back walls (fill behind the visible faces) --

    // NE back wall (N->E)
    ctx.fillStyle = rightCol;
    ctx.beginPath();
    ctx.moveTo(N.x, N.y - h);
    ctx.lineTo(E.x, E.y - h);
    ctx.lineTo(E.x, E.y);
    ctx.lineTo(N.x, N.y);
    ctx.closePath();
    ctx.fill();

    // NW back wall (W->N)
    ctx.fillStyle = leftCol;
    ctx.beginPath();
    ctx.moveTo(W.x, W.y - h);
    ctx.lineTo(N.x, N.y - h);
    ctx.lineTo(N.x, N.y);
    ctx.lineTo(W.x, W.y);
    ctx.closePath();
    ctx.fill();

    // -- Front walls --

    // Left (SW) wall: W->S
    ctx.fillStyle = leftCol;
    ctx.beginPath();
    ctx.moveTo(W.x, W.y - h);
    ctx.lineTo(S.x, S.y - h);
    ctx.lineTo(S.x, S.y);
    ctx.lineTo(W.x, W.y);
    ctx.closePath();
    ctx.fill();

    // Right (SE) wall: S->E
    ctx.fillStyle = rightCol;
    ctx.beginPath();
    ctx.moveTo(S.x, S.y - h);
    ctx.lineTo(E.x, E.y - h);
    ctx.lineTo(E.x, E.y);
    ctx.lineTo(S.x, S.y);
    ctx.closePath();
    ctx.fill();

    // -- Top face --
    ctx.fillStyle = topCol;
    ctx.beginPath();
    ctx.moveTo(N.x, N.y - h);
    ctx.lineTo(E.x, E.y - h);
    ctx.lineTo(S.x, S.y - h);
    ctx.lineTo(W.x, W.y - h);
    ctx.closePath();
    ctx.fill();

    // -- Edge outlines --
    ctx.strokeStyle = leftCol;
    ctx.lineWidth = 0.7;
    // Bottom visible edges
    ctx.beginPath();
    ctx.moveTo(W.x, W.y);
    ctx.lineTo(S.x, S.y);
    ctx.lineTo(E.x, E.y);
    ctx.stroke();
    // Top face outline
    ctx.beginPath();
    ctx.moveTo(N.x, N.y - h);
    ctx.lineTo(E.x, E.y - h);
    ctx.lineTo(S.x, S.y - h);
    ctx.lineTo(W.x, W.y - h);
    ctx.closePath();
    ctx.stroke();
    // Vertical corner edges
    ctx.beginPath();
    ctx.moveTo(W.x, W.y);
    ctx.lineTo(W.x, W.y - h);
    ctx.moveTo(S.x, S.y);
    ctx.lineTo(S.x, S.y - h);
    ctx.moveTo(E.x, E.y);
    ctx.lineTo(E.x, E.y - h);
    ctx.stroke();

    // -- HP bar --
    const topY = Math.min(N.y, W.y) - h;
    const barW = 44,
        barH = 5;
    const barX = sx - barW / 2,
        barY = topY - 12;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = frac > 0.5 ? "#4a4" : frac > 0.25 ? "#da4" : "#d44";
    ctx.fillRect(barX, barY, barW * frac, barH);
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.ceil(hq.hp)}/${hq.maxHp}`, sx, barY + barH + 9);

    // -- Damage overlay --
    if (frac < 1) {
        drawDamageOverlay(ctx, sx, sy + hh, h, frac, time);
    }
}
