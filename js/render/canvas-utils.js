/**
 * Shared colour palette and canvas/geometry helpers for the render package.
 *
 * Every draw module gets its colours here so a visual tweak (e.g. damage
 * darkening) is one change, not a re-derivation in each sprite.
 */

/* ── Colour palette ───────────────────────────────────────── */

export const PALETTE = {
    deepWater: { r: 22, g: 50, b: 82 },
    shallowWater: { r: 38, g: 82, b: 128 },
    sand: { r: 210, g: 185, b: 150 },
    grass: { r: 72, g: 124, b: 60 },
    darkGrass: { r: 55, g: 100, b: 42 },
    dirt: { r: 155, g: 130, b: 95 },
    stone: { r: 150, g: 145, b: 135 },
    stoneDark: { r: 100, g: 95, b: 88 },
    wood: { r: 146, g: 112, b: 74 },
    woodDark: { r: 96, g: 72, b: 46 },
    field: { r: 168, g: 144, b: 88 },
    hay: { r: 215, g: 190, b: 110 },
    verge: { r: 122, g: 106, b: 84 },
    tarmac: { r: 58, g: 58, b: 64 },
    tarmacKerb: { r: 96, g: 96, b: 100 },
    roadDash: { r: 226, g: 220, b: 190 },
    bushDark: { r: 38, g: 74, b: 34 },
    treeCanopy: { r: 42, g: 88, b: 36 },
    treeCanopyLight: { r: 58, g: 110, b: 48 },
    bldgBarn: { wall: { r: 165, g: 70, b: 52 }, roof: { r: 80, b: 78, g: 78 }, trim: { r: 125, g: 55, b: 42 } },
    bldgSilo: { wall: { r: 168, g: 170, b: 176 }, roof: { r: 88, g: 92, b: 100 }, trim: { r: 130, g: 132, b: 138 } },
    hillTop: { r: 140, g: 115, b: 80 },
    hillLeft: { r: 105, g: 82, b: 55 },
    hillRight: { r: 125, g: 100, b: 68 },
    rockTop: { r: 130, g: 130, b: 130 },
    rockLeft: { r: 90, g: 90, b: 90 },
    rockRight: { r: 110, g: 110, b: 110 },
    // Buildings — each has wall, roof, and trim colours
    bldgSmall: { wall: { r: 180, g: 165, b: 140 }, roof: { r: 160, g: 75, b: 55 }, trim: { r: 120, g: 110, b: 95 } },
    bldgMedium: { wall: { r: 195, g: 185, b: 170 }, roof: { r: 80, g: 110, b: 150 }, trim: { r: 140, g: 130, b: 115 } },
    bldgLarge: { wall: { r: 170, g: 165, b: 160 }, roof: { r: 55, g: 65, b: 80 }, trim: { r: 110, g: 105, b: 100 } },
};

export function rgb(r, g, b) {
    return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Parse "#rrggbb" into [r, g, b]. */
export function hexToRgb(hex) {
    return [
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
    ];
}

/** Darken (f < 1) or lighten (f > 1) a hex colour, clamped to 0-255. */
export function shadeHex(hex, f) {
    const [r, g, b] = hexToRgb(hex);
    const c = (v) => Math.max(0, Math.min(255, v * f));
    return rgb(c(r), c(g), c(b));
}

/** Blend two [r,g,b] triples into an rgb() string: t = 0 → a, t = 1 → b. */
export function mixRgb(a, b, t) {
    return rgb(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/** Blend two hex colours: t = 0 → a, t = 1 → b. */
export function mixHex(a, b, t) {
    return mixRgb(hexToRgb(a), hexToRgb(b), t);
}

/** Blend a hex colour toward a grey value: t = 0 → hex, t = 1 → grey. */
export function mixGrey(hex, grey, t) {
    const c = hexToRgb(hex);
    return rgb(c[0] + (grey - c[0]) * t, c[1] + (grey - c[1]) * t, c[2] + (grey - c[2]) * t);
}

/** Darken a hex colour by an amount in [0,1] (0 = unchanged, 1 = 50% darker). */
export function darken(hex, amt) {
    return shadeHex(hex, 1 - amt * 0.5);
}

/** Scale a palette {r,g,b} colour, clamped. */
export function scaleRgb(c, f) {
    const cl = (v) => Math.max(0, Math.min(255, v * f));
    return rgb(cl(c.r), cl(c.g), cl(c.b));
}

/** Linear interpolation between two [x, y] points. */
export function lerpPt(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Trace a rounded-rectangle path on the context (does not fill/stroke). */
export function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

/**
 * Health-bar fill colour: green above 50%, amber above 25%, red below.
 * `full` is the "healthy" colour (defaults to the shared green ramp).
 */
export function healthColor(frac, full = "#4a4") {
    return frac > 0.5 ? full : frac > 0.25 ? "#da4" : "#d44";
}

/** Draw a small health bar (dark backing + coloured fill) at (x, y). */
export function drawHealthBar(ctx, x, y, w, h, frac, full = "#4a4") {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = healthColor(frac, full);
    ctx.fillRect(x, y, w * frac, h);
}
