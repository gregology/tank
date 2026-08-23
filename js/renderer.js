/**
 * Renderer — thin composition shell over the js/render/ package.
 *
 * Owns the canvas and the per-frame layout (viewports → terrain →
 * entities → HUD → game-over overlay); every actual drawing concern
 * lives in a focused module under js/render/:
 *
 *   viewport.js   two-pass depth-sort orchestration + viewport borders
 *   tiles.js      flat + elevated tiles, damage overlay
 *   buildings.js  destructible buildings
 *   vehicles.js   tank / IFV / SPG / drone / squad sprites (also used
 *                 by menu.js for previews)
 *   structures.js base walls, watch towers, HQ tent
 *   effects.js    bullets (incl. arcing shells) + particles
 *   hud.js        score HUD (Skirmish) + battle HUD (Battle)
 *   minimap.js    per-player minimap
 *   overlay.js    game-over screen + SPG targeting indicator
 *
 * Split-screen modes show two side-by-side viewports.  Rendering is
 * depth-sorted so elevated terrain correctly occludes entities behind it
 * (see viewport.js for the two-pass contract).
 */

import { layoutViewports } from "./layout.js";
import { drawBattleHUD, drawScoreHUD } from "./render/hud.js";
import { drawGameOver } from "./render/overlay.js";
import { drawViewportBorders, renderViewport } from "./render/viewport.js";

/** HUD draw functions, keyed by the mode strategy's `hud` field. */
const HUD_DRAWERS = { battle: drawBattleHUD, score: drawScoreHUD };

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.resize();
        window.addEventListener("resize", () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    /* ── public entry point ───────────────────────────────── */

    render(game) {
        const ctx = this.ctx;
        const cw = this.canvas.width,
            ch = this.canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        const humans = game.humanTanks;
        const rects = layoutViewports(humans.length, cw, ch);

        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const tank = humans[i];
            renderViewport(ctx, game, tank, game.cameras[i], r.x, r.y, r.w, r.h);
            (HUD_DRAWERS[game.mode.hud] ?? drawScoreHUD)(ctx, game, i, r.x, r.y, r.w, r.h, tank);
        }

        drawViewportBorders(ctx, rects, cw, ch);

        if (game.gameOver) drawGameOver(ctx, game, cw, ch);
    }
}
