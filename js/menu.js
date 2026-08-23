/**
 * Menu screens rendered on the game canvas: title, lobby, and vehicle info.
 *
 * This module is the thin shell over the js/menu/ package: it owns the
 * screen state machine and hands each frame to the active screen
 * strategy (`update` + `render` hooks, like the mode/vehicle strategy
 * pattern).  Each screen reads and mutates the menu as its context —
 * the same strategy-context arrangement Game uses with modes.
 *
 * The lobby is a console-style match setup: players press A/Start to
 * join, press ◀▶ / X to switch team, B to leave, and the host (first
 * joiner) selects the game type (Skirmish / Battle) and match options.
 *
 * All match-setup state lives in the pure Lobby (lobby.js), which resolves
 * to a MatchConfig that main.js hands to the Game.
 *
 * Vehicle previews use the EXACT same geometry as the in-game renderer
 * (js/render/vehicles.js drawVehicle), projected at a configurable scale
 * (js/menu/background.js).
 */

import { Lobby } from "./lobby.js";
import { aboutScreen } from "./menu/about-screen.js";
import { lobbyScreen } from "./menu/lobby-screen.js";
import { mainScreen } from "./menu/main-screen.js";

export class Menu {
    constructor() {
        this._screen = "main"; // 'main' | 'lobby' | 'about'
        this._aboutIndex = 0;
        this._time = 0;
        /** Set true (with `match` populated) when the host starts. */
        this.confirmed = false;
        /** Resolved MatchConfig (populated when confirmed). */
        this.match = null;

        this.lobby = new Lobby();
        this._screens = { main: mainScreen, lobby: lobbyScreen, about: aboutScreen };
    }

    reset() {
        this.confirmed = false;
        this.match = null;
        this._screen = "main";
        this._aboutIndex = 0;
        this.lobby = new Lobby();
    }

    /** Switch the active screen (called by the screen strategies). */
    show(name) {
        this._screen = name;
    }

    /* ── update / render dispatch ────────────────────────── */

    update(dt, input, audio) {
        this._time += dt;
        this._screens[this._screen].update(this, input, audio);
    }

    render(ctx, canvas) {
        this._screens[this._screen].render(this, ctx, canvas);
    }

    /** Build the MatchConfig and flag the match as confirmed. */
    startMatch() {
        if (this.lobby.players.length === 0) return;
        this.match = this.lobby.buildMatch();
        this.confirmed = true;
    }
}
