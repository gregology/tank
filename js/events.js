/**
 * Game event vocabulary — the single source of truth for event names on the
 * `Game` bus (`game.on` / `game.emit`).  Emitters and subscribers use these
 * constants rather than bare strings, so a typo fails loudly at import time.
 *
 * Payloads:
 *   fire             { source, bullet, sound }   source = tank | tower
 *   hit              { tank, zone }
 *   destroy          { entity }                  entity = tank | structure
 *   impact           { bullet } | { point }
 *   destroy_tile     { gx, gy }
 *   win              { winner }
 *   artillery_impact { bullet }
 *   drone_strike     { drone }
 *   terrain_changed  { gx, gy } | { structure }
 */
export const GAME_EVENTS = Object.freeze({
    FIRE: "fire",
    HIT: "hit",
    DESTROY: "destroy",
    IMPACT: "impact",
    DESTROY_TILE: "destroy_tile",
    WIN: "win",
    ARTILLERY_IMPACT: "artillery_impact",
    DRONE_STRIKE: "drone_strike",
    TERRAIN_CHANGED: "terrain_changed",
});
