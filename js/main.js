/**
 * Entry point – state machine that switches between the menu and gameplay.
 *
 *   MENU  ──host confirms──▶  PLAYING  ──players leave──▶  MENU (lobby, joins kept)
 *
 * `window.tankedShell` exists only under the desktop shell (electron/), which
 * supplies the pads because the Gamepad API can't tell Steam's virtual pads
 * apart.  In a browser it is absent and pads come from the Gamepad API.
 */

import { AudioManager } from "./audio.js";
import { demoMatch } from "./demo.js";
import { InputManager } from "./input.js";
import { MatchSession } from "./match-session.js";
import { Menu } from "./menu.js";
import { Renderer } from "./renderer.js";

/* ── Singletons ───────────────────────────────────────────── */

const canvas = document.getElementById("game-canvas");
const shell = globalThis.tankedShell;
const input = new InputManager(shell?.readPads);
const audio = new AudioManager();
const renderer = new Renderer(canvas);
const menu = new Menu();

/** The running match, or null while the menu is showing. */
let session = null;

/* ── Game loop ────────────────────────────────────────────── */

let lastTime = 0;

function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    input.poll(); // refresh devices + edges before anything reads input

    if (session === null) {
        menu.update(dt, input, audio);
        menu.render(renderer.ctx, renderer.canvas);

        if (menu.confirmed) {
            menu.confirmed = false;
            startMatch(menu.match);
        }
    } else if (session.update(dt, input)) {
        renderer.render(session);
    } else {
        session = null;
    }

    input.endFrame();
    requestAnimationFrame(loop);
}

function startMatch(matchConfig) {
    audio.init();
    session = new MatchSession(matchConfig, audio);
}

/* ── Kick off ─────────────────────────────────────────────── */

if (shell?.demoScenario) startMatch(demoMatch(shell.demoScenario));

requestAnimationFrame((ts) => {
    lastTime = ts;
    requestAnimationFrame(loop);
});
