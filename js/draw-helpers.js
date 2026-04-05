/**
 * Shared isometric drawing helpers used by renderer.js and menu.js.
 *
 * Returns closure-bound helpers that capture the canvas 2D context,
 * so callers don't need to pass ctx to every draw call.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @returns {{ fill, outline, drop, lift, slab }}
 */
export function createDrawHelpers(ctx) {
    /** Fill a polygon defined by [[x,y], …] with a solid color. */
    const fill = (pts, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
    };

    /** Stroke a polygon outline. */
    const outline = (pts, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
    };

    /** Shift every point down by `d` pixels. */
    const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);

    /** Shift every point by `dy` pixels (alias for vertical offset). */
    const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

    /**
     * Draw a 3-D extruded slab: side wall of height h, then top face.
     * `wallColor` is for the visible side wall, `topColor` for the top.
     */
    const slab = (topPts, h, topColor, wallColor) => {
        fill(drop(topPts, h), wallColor);
        fill(topPts, topColor);
    };

    return { fill, outline, drop, lift, slab };
}
