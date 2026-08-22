/**
 * Base-structure rendering — thin barrel over `js/render/structures/`.
 *
 * One sprite module per structure type (`wall.js`, `tower.js`, `hq.js`),
 * a shared isometric-block primitive (`block.js`), and a `drawBaseStructure`
 * dispatch via the `STRUCTURE_SPRITES` registry (`index.js`).  Callers keep
 * importing `drawBaseStructure` (and the individual sprites) from here.
 */

export * from "./structures/index.js";
