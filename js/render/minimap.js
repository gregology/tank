/**
 * Per-viewport minimap: a top-down square-colour map with vehicle
 * markers (shape varies by vehicle type), base-compound outlines, and
 * a border tinted with the local player's team colour.
 */

import { TILE_VISUALS, VEHICLES } from "../config.js";

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

/** One terrain layer per map, shared by every viewport and dropped with its map. */
const terrainLayers = new WeakMap();

/**
 * The map's terrain at `px` pixels per tile, repainted only after a tile
 * changes: repainting every tile for every viewport each frame held a
 * four-player match to 24 fps on the Steam Machine.
 */
function terrainLayer(map, px) {
    let layer = terrainLayers.get(map);
    if (!layer) {
        const canvas = new OffscreenCanvas(map.width * px, map.height * px);
        layer = { canvas, ctx: canvas.getContext("2d"), revision: null };
        terrainLayers.set(map, layer);
    }
    if (layer.revision !== map.tileRevision) {
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                layer.ctx.fillStyle = TILE_VISUALS[map.getTile(gx, gy)]?.mapColor ?? "#000";
                layer.ctx.fillRect(gx * px, gy * px, px, px);
            }
        }
        layer.revision = map.tileRevision;
    }
    return layer.canvas;
}

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

    ctx.drawImage(terrainLayer(map, px), mmX, mmY);

    // Tank dots (shape varies by vehicle type)
    for (const t of game.allTanks) {
        if (!t.alive) continue;
        ctx.fillStyle = t.color;
        const dx = mmX + t.x * px;
        const dy = mmY + t.y * px;
        (MARKERS[VEHICLES[t.vehicleType]?.minimapShape] ?? MARKERS.square)(ctx, dx, dy);
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
