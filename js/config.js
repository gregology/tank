/**
 * Central configuration for the entire game.
 * Tweak values here to tune gameplay, visuals, and controls.
 *
 * This file is the single import point over the `js/config/` package:
 * each thematic data table lives in its own module and is re-exported
 * here, so every existing `import … from "./config.js"` keeps working.
 * The dependency leaf rule ("config imports nothing from the game") is
 * enforced by dependency-cruiser at the package boundary: `js/config.js`
 * and everything under `js/config/` may only import within the package.
 */

export * from "./config/actions.js";
export * from "./config/biomes.js";
export * from "./config/constants.js";
export * from "./config/options.js";
export * from "./config/players.js";
export * from "./config/structures.js";
export * from "./config/swarm.js";
export * from "./config/targets.js";
export * from "./config/tiles.js";
export * from "./config/vehicles.js";
