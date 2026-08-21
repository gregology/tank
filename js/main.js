/**
 * Entry point – state machine that switches between the menu and gameplay.
 *
 *   MENU  ──host confirms──▶  PLAYING  ──back──▶  MENU (lobby, joins kept)
 *                                 └──confirm (game over)──▶ rematch
 */

import { AudioManager } from "./audio.js";
import { ACTIONS } from "./config.js";
import { Game } from "./game.js";
import { InputManager } from "./input.js";
import { Menu } from "./menu.js";
import { Renderer } from "./renderer.js";

/* ── Singletons ───────────────────────────────────────────── */

const canvas = document.getElementById("game-canvas");
const input = new InputManager();
const audio = new AudioManager();
const renderer = new Renderer(canvas);
const menu = new Menu();

let game = null;
let state = "menu"; // 'menu' | 'playing'

/* ── Game loop ────────────────────────────────────────────── */

let lastTime = 0;

function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    input.poll(); // refresh devices + edges before anything reads input

    if (state === "menu") {
        menu.update(dt, input, audio);
        menu.render(renderer.ctx, renderer.canvas);

        if (menu.confirmed) {
            menu.confirmed = false;
            startGame(menu.match);
        }
    } else {
        // ── Playing ──
        if (game.gameOver) {
            // Rematch (same match, fresh map) — any device confirms.
            if (anyPressed(ACTIONS.confirm)) {
                audio.init();
                game.restart();
                audio.hookIntoGame(game); // re-subscribe (new ParticleSystem)
            }
            // Back to the lobby (joins preserved) — any device backs out.
            if (anyPressed(ACTIONS.back)) {
                state = "menu";
                game = null;
            }
        }

        if (game) {
            game.update(dt);
            renderer.render(game);
        }
    }

    input.endFrame();
    requestAnimationFrame(loop);
}

/* ── Helpers ──────────────────────────────────────────────── */

/** True if any device (keyboard or connected pad) pressed the action. */
function anyPressed(action) {
    if (input.keyboard.wasPressed(action)) return true;
    for (const gp of input.connectedGamepads) {
        if (gp.wasPressed(action)) return true;
    }
    return false;
}

function startGame(matchConfig) {
    audio.init();
    game = new Game(matchConfig);
    audio.hookIntoGame(game);
    state = "playing";
}

/* ── Kick off ─────────────────────────────────────────────── */

requestAnimationFrame((ts) => {
    lastTime = ts;
    requestAnimationFrame(loop);
});
