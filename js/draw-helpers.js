/**
 * Shared isometric drawing helpers used by renderer.js and menu.js.
 *
 * Returns closure-bound helpers that capture the canvas 2D context,
 * so callers don't need to pass ctx to every draw call.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @returns {{ fill, outline, drop, lift, slab, slabLit }}
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

    /**
     * Draw a 3-D extruded slab with per-edge directional shading.
     *
     * Each edge whose outward screen-normal points downward (toward the
     * viewer) gets its own wall quad: right-facing edges use `rightColor`,
     * left-facing edges use `leftColor`, matching the terrain lighting
     * (SE faces bright, SW faces dark).  Because shading follows the
     * screen-space normals, lighting stays correct as the shape rotates.
     */
    const slabLit = (topPts, h, topColor, leftColor, rightColor) => {
        let cx = 0,
            cy = 0;
        for (const [x, y] of topPts) {
            cx += x;
            cy += y;
        }
        cx /= topPts.length;
        cy /= topPts.length;
        for (let i = 0; i < topPts.length; i++) {
            const a = topPts[i];
            const b = topPts[(i + 1) % topPts.length];
            // Outward normal: perpendicular to the edge, pointing away
            // from the centroid (winding-independent).
            let nx = b[1] - a[1];
            let ny = -(b[0] - a[0]);
            const mx = (a[0] + b[0]) / 2 - cx;
            const my = (a[1] + b[1]) / 2 - cy;
            if (nx * mx + ny * my < 0) {
                nx = -nx;
                ny = -ny;
            }
            if (ny <= 0.0001) continue; // back-facing edge: wall not visible
            fill([a, b, [b[0], b[1] + h], [a[0], a[1] + h]], nx >= 0 ? rightColor : leftColor);
        }
        fill(topPts, topColor);
    };

    return { fill, outline, drop, lift, slab, slabLit };
}
