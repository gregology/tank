/**
 * Camera-follow system — track a human's tank in screen space.
 *
 * This used to live as `Game._updateCamera`; it is a pure projection of the
 * tank's world position and facing into the camera's follow target.
 */

import { CONFIG, VEHICLES } from "../config.js";
import { worldToScreen } from "../utils.js";

/** Steer a camera toward its human's tank (no-op while the tank is dead). */
export function updateCamera(cam, tank, dt) {
    if (tank.alive) {
        const s = worldToScreen(tank.x, tank.y);
        const la = VEHICLES[tank.vehicleType]?.cameraLookAhead ?? CONFIG.CAMERA_LOOK_AHEAD;
        const aim = tank.turretWorld;
        const dx = Math.cos(aim) * la;
        const dy = Math.sin(aim) * la;
        cam.follow(s.x + (dx - dy) * (CONFIG.TILE_WIDTH / 2), s.y + (dx + dy) * (CONFIG.TILE_HEIGHT / 2), dt);
    }
}
