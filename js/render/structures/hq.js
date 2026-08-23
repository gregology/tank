/**
 * Base-HQ sprite — a 1×2 command tent drawn as a cuboid over its two-tile
 * isometric diamond footprint, team-coloured and shrinking with damage.
 */

import { BASE_STRUCTURES } from "../../config.js";
import { darken, drawHealthBar } from "../canvas-utils.js";
import { drawDamageOverlay } from "../damage.js";
import { TH, TW } from "../projection.js";

export function drawBaseHQ(ctx, hq, sx, sy, time) {
    const frac = hq.damageFraction;
    const fullH = BASE_STRUCTURES.baseHQ.visHeight;
    const h = Math.max(3, Math.round(fullH * frac));

    const dmg = 1 - frac;

    // Exact 2-tile isometric diamond vertices relative to entity centre.
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
    drawHealthBar(ctx, barX, barY, barW, barH, frac);
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.ceil(hq.hp)}/${hq.maxHp}`, sx, barY + barH + 9);

    // -- Damage overlay --
    if (frac < 1) {
        drawDamageOverlay(ctx, sx, sy + hh, h, frac, time);
    }
}
