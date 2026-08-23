/**
 * Full-screen overlays: the game-over dim + winner banner, and the SPG
 * targeting indicator drawn in camera space while an SPG charges.
 */

/** Dim the whole canvas and announce the winner with rematch/menu prompts. */
export function drawGameOver(ctx, game, cw, ch) {
    // Dim
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.textAlign = "center";

    // Winner label
    const label = game.winnerLabel;
    const winColor = game.winnerColor;

    ctx.font = 'bold 48px "Courier New", monospace';
    ctx.fillStyle = winColor;
    ctx.fillText(`${label} WINS!`, cw / 2, ch / 2 - 30);

    // Prompts
    ctx.font = '20px "Courier New", monospace';
    ctx.fillStyle = "#aaa";
    ctx.fillText("Space / Enter   Rematch", cw / 2, ch / 2 + 20);
    ctx.fillStyle = "#666";
    ctx.fillText("R   Menu", cw / 2, ch / 2 + 50);

    ctx.restore();
}

/**
 * Isometric diamond reticle showing the SPG's current charge range,
 * pulsing hotter as it approaches the maximum.
 */
export function drawTargetIndicator(ctx, sx, sy, currentRange, maxRange, time) {
    const pulse = Math.sin(time * 8) * 0.3 + 0.7;
    const frac = currentRange / maxRange;
    const hot = frac > 0.9;

    // Outer isometric diamond
    const r = 14;
    ctx.strokeStyle = hot ? `rgba(255,50,0,${0.7 * pulse})` : `rgba(255,160,0,${0.5 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r / 2);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx, sy + r / 2);
    ctx.lineTo(sx - r, sy);
    ctx.closePath();
    ctx.stroke();

    // Inner diamond (pulsing)
    const r2 = 7;
    ctx.strokeStyle = hot ? `rgba(255,80,0,${0.5 * pulse})` : `rgba(255,200,50,${0.35 * pulse})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r2 / 2);
    ctx.lineTo(sx + r2, sy);
    ctx.lineTo(sx, sy + r2 / 2);
    ctx.lineTo(sx - r2, sy);
    ctx.closePath();
    ctx.stroke();

    // Centre dot
    ctx.fillStyle = hot ? `rgba(255,60,0,${0.9 * pulse})` : `rgba(255,180,0,${0.7 * pulse})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Crosshair lines
    ctx.strokeStyle = `rgba(255,180,50,${0.3 * pulse})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx - r - 4, sy);
    ctx.lineTo(sx - r + 2, sy);
    ctx.moveTo(sx + r - 2, sy);
    ctx.lineTo(sx + r + 4, sy);
    ctx.moveTo(sx, sy - r / 2 - 3);
    ctx.lineTo(sx, sy - r / 2 + 1);
    ctx.moveTo(sx, sy + r / 2 - 1);
    ctx.lineTo(sx, sy + r / 2 + 3);
    ctx.stroke();
}
