/**
 * Entry point – state machine that switches between the menu and gameplay.
 *
 *   MENU  ──Enter──▶  PLAYING  ──R──▶  MENU
 *                       │ Space/Enter (game over) → rematch
 */

import { InputManager } from './input.js';
import { Game }         from './game.js';
import { Renderer }     from './renderer.js';
import { AudioManager } from './audio.js';
import { Menu }         from './menu.js';

/* ── Singletons ───────────────────────────────────────────── */

const canvas   = document.getElementById('game-canvas');
const input    = new InputManager();
const audio    = new AudioManager();
const renderer = new Renderer(canvas);
const menu     = new Menu();

let game       = null;
let state      = 'menu';          // 'menu' | 'playing'
let lastMode   = 'pvp';           // remember for rematch

/* ── Game loop ────────────────────────────────────────────── */

let lastTime = 0;

function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    if (state === 'menu') {
        menu.update(dt, input, audio);
        menu.render(renderer.ctx, renderer.canvas);

        if (menu.confirmed) {
            menu.confirmed = false;
            lastMode = menu.selectedMode;
            startGame(lastMode);
        }

    } else {
        // ── Playing ──
        if (game.gameOver) {
            // Rematch (same mode, fresh map)
            if (input.wasPressed('Space') || input.wasPressed('Enter')) {
                audio.init();
                game.restart();
                audio.hookIntoGame(game);   // re-subscribe (new ParticleSystem)
            }
            // Back to menu
            if (input.wasPressed('KeyR')) {
                state = 'menu';
                menu.reset();
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

function startGame(mode) {
    audio.init();
    game  = new Game(input, mode);
    audio.hookIntoGame(game);
    state = 'playing';
}

/* ── Kick off ─────────────────────────────────────────────── */

requestAnimationFrame((ts) => {
    lastTime = ts;
    requestAnimationFrame(loop);
});
