/**
 * Shared isometric-block primitive.
 *
 * Draws the three visible faces (left, right, top) of a 1×1 isometric
 * block at a projected screen position.  The wall and tower sprites share
 * this so they don't each re-derive the same face geometry.
 */

export function drawIsoBlock(ctx, sx, sy, h, { top, left, right, bw, bd }) {
    // Left (SW) face
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(sx - bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx, sy + bd);
    ctx.lineTo(sx - bw, sy);
    ctx.closePath();
    ctx.fill();

    // Right (SE) face
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx, sy + bd);
    ctx.lineTo(sx + bw, sy);
    ctx.closePath();
    ctx.fill();

    // Top face
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(sx, sy - bd - h);
    ctx.lineTo(sx + bw, sy - h);
    ctx.lineTo(sx, sy + bd - h);
    ctx.lineTo(sx - bw, sy - h);
    ctx.closePath();
    ctx.fill();
}
