/**
 * Drawing helpers shared by the menu screens: the animated background
 * grid, the pulsing cursor bar, and the vehicle preview (which reuses
 * the exact in-game sprite geometry via js/render/vehicles.js).
 */

import { roundedRect } from "../render/canvas-utils.js";
import { drawVehicle } from "../render/vehicles.js";

/** Animated isometric-style background grid behind every screen. */
export function drawGrid(ctx, W, H, t) {
    ctx.strokeStyle = "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;
    const off = (t * 8) % 64;
    for (let x = -off; x < W + 64; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }
    const offy = (t * 4) % 32;
    for (let y = -offy; y < H + 32; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }
}

/** Pulsing highlight bar for the host's cursor. */
export function cursorBar(ctx, x, y, w, h, time) {
    const pulse = 0.05 + Math.sin(time * 4) * 0.02;
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    roundedRect(ctx, x, y, w, h, 4);
    ctx.fill();
}

/**
 * Draw a vehicle preview at a configurable scale.  Delegates to the
 * shared vehicle sprite module (the same one the in-game renderer uses),
 * fed with a hand-built tank-shaped object.
 */
export function drawMenuVehicle(ctx, sx, sy, angle, type, color, dark, scale, time) {
    const s = scale !== undefined ? scale : 1.0;
    const fakeTank = {
        alive: true,
        flashTimer: 0,
        vehicleType: type,
        angle,
        turretWorld: angle,
        color,
        darkColor: dark,
        damaged: false,
        leftTrackDisabled: false,
        rightTrackDisabled: false,
        turretDisabled: false,
        recoilTimer: 0,
        treadPhase: (time * 2.5) % 1,
        isCharging: false,
        chargeTime: 0,
    };
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    drawVehicle(ctx, fakeTank, 0, 0);
    ctx.restore();
}
