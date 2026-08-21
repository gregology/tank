/**
 * Viewport layout for local split-screen play.
 *
 * Pure geometry, kept separate from renderer.js so it can be unit-tested
 * without pulling the canvas code into coverage.
 *
 *   1 → full screen
 *   2 → two side-by-side, full height
 *   3 → centred top (same size as the bottom cells) + two bottom
 *   4 → 2×2 grid
 */

/**
 * Compute viewport rectangles for `n` local players.
 *
 * @param {number} n  number of human players (clamped to 1..4)
 * @param {number} w  canvas width
 * @param {number} h  canvas height
 * @returns {{x:number, y:number, w:number, h:number}[]}
 */
export function layoutViewports(n, w, h) {
    const count = Math.max(1, Math.min(4, n));
    if (count === 1) return [{ x: 0, y: 0, w, h }];
    if (count === 2) {
        const hw = w / 2;
        return [
            { x: 0, y: 0, w: hw, h },
            { x: hw, y: 0, w: hw, h },
        ];
    }
    if (count === 3) {
        const hw = w / 2,
            hh = h / 2;
        return [
            { x: hw / 2, y: 0, w: hw, h: hh }, // top, centred
            { x: 0, y: hh, w: hw, h: hh }, // bottom-left
            { x: hw, y: hh, w: hw, h: hh }, // bottom-right
        ];
    }
    const hw = w / 2,
        hh = h / 2;
    return [
        { x: 0, y: 0, w: hw, h: hh },
        { x: hw, y: 0, w: hw, h: hh },
        { x: 0, y: hh, w: hw, h: hh },
        { x: hw, y: hh, w: hw, h: hh },
    ];
}
