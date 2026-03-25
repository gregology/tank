/**
 * Entry point – wires everything together and runs the game loop.
 */

import { InputManager } from './input.js';
import { Game }         from './game.js';
import { Renderer }     from './renderer.js';

/* ── Bootstrap ────────────────────────────────────────────── */

const canvas   = document.getElementById('game-canvas');
const input    = new InputManager();
const game     = new Game(input);
const renderer = new Renderer(canvas);

/* ── Game loop ────────────────────────────────────────────── */

let lastTime = 0;

function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);  // cap to 50 ms
    lastTime = timestamp;

    // Global key handling (restart)
    if (game.gameOver && input.wasPressed('KeyR')) {
        game.restart();
    }

    game.update(dt);
    renderer.render(game);
    input.endFrame();

    requestAnimationFrame(loop);
}

// Kick off
requestAnimationFrame((ts) => {
    lastTime = ts;
    requestAnimationFrame(loop);
});
