/**
 * Menu screens rendered on the game canvas: title, lobby, and vehicle info.
 *
 * The lobby is a console-style match setup: players press A/Start to join,
 * press ◀▶ / X to switch team, B to leave, and the host (first joiner)
 * selects the game type (Skirmish / Battle) and match options.
 *
 * All match-setup state lives in the pure Lobby (lobby.js), which resolves
 * to a MatchConfig that main.js hands to the Game.  This module is just
 * input orchestration + rendering over that state.
 *
 * Vehicle previews use the EXACT same geometry as the in-game renderer
 * (js/render/vehicles.js drawVehicle), projected at a configurable scale.
 */

import { ACTIONS, GAME_OPTIONS, MAX_PLAYERS, PLAYER_COLORS, VEHICLES } from "./config.js";
import { Lobby } from "./lobby.js";
import { roundedRect } from "./render/canvas-utils.js";
import { drawVehicle } from "./render/vehicles.js";

/* ── Vehicle descriptions (UI text, not gameplay constants) ── */

const VEHICLE_INFO = [
    {
        type: "tank",
        name: "TANK",
        tagline: "Main Battle Tank",
        color: "#cc3333",
        dark: "#882222",
        stats: { SPD: 3.0, ARM: 2, DMG: 1.0, ROF: "Med", TUR: "Yes" },
        desc: [
            "The backbone of any fighting force.",
            "Independent rotating turret lets you",
            "aim while driving in any direction.",
            "",
            "2-hit directional armour system:",
            " \u2022 Front hit \u2192 turret disabled",
            " \u2022 Side hit  \u2192 track disabled",
            " \u2022 Rear hit  \u2192 instant kill",
            " \u2022 2nd hit   \u2192 destroyed",
        ],
    },
    {
        type: "ifv",
        name: "IFV",
        tagline: "Infantry Fighting Vehicle",
        color: "#3366dd",
        dark: "#223399",
        stats: { SPD: 4.5, ARM: 1, DMG: 0.25, ROF: "Fast", TUR: "No" },
        desc: [
            "Fast wheeled recon vehicle with a",
            "rapid-fire autocannon. Fixed forward",
            "gun \u2014 aim by steering the hull.",
            "",
            "High speed makes it perfect for",
            "flanking and scouting. Very fragile:",
            "any single hit is an instant kill.",
            "",
            "4 shots = 1 tank shell of damage.",
        ],
    },
    {
        type: "drone",
        name: "DRONE",
        tagline: "FPV Kamikaze Quadcopter",
        color: "#44bb44",
        dark: "#228822",
        stats: { SPD: 6.0, ARM: 1, DMG: "1.0 AoE", ROF: "N/A", TUR: "No" },
        desc: [
            "Extremely fast FPV drone that flies",
            "over ALL terrain including water,",
            "hills, rocks, and buildings.",
            "",
            "No gun \u2014 press FIRE to detonate!",
            "Deals area-of-effect blast damage",
            "that falls off with distance.",
            "",
            "One-use: always self-destructs.",
        ],
    },
    {
        type: "spg",
        name: "SPG",
        tagline: "Self-Propelled Gun",
        color: "#dd8833",
        dark: "#885522",
        stats: { SPD: 2.0, ARM: 1, DMG: 1.5, ROF: "Slow", TUR: "Yes" },
        desc: [
            "Heavy artillery that lobs shells in",
            "a high arc OVER terrain obstacles.",
            "",
            "HOLD fire to charge range, then",
            "RELEASE to launch. Longer hold =",
            "longer range (up to 25 units).",
            "",
            "Devastating splash damage on impact.",
            "Slow and fragile \u2014 stay at range!",
        ],
    },
    {
        type: "squad",
        name: "SQUAD",
        tagline: "Infantry Fireteam",
        color: "#55aa44",
        dark: "#337722",
        stats: { SPD: 2.6, ARM: 1, DMG: 1.0, ROF: "Auto", TUR: "No" },
        desc: [
            "Five-man squad that fights on its own.",
            "Each member auto-fires at its target:",
            " \u2022 RPG        \u2192 vehicles",
            " \u2022 Shotgun    \u2192 drones",
            " \u2022 Rifles/MG  \u2192 enemy squads",
            "",
            "Members drop as the squad takes hits.",
            "FIRE to dig in; buildings give cover.",
        ],
    },
];

const GAME_TYPE_LABELS = {
    skirmish: "SKIRMISH",
    battle: "BATTLE",
};

const GAME_TYPE_DESC = {
    skirmish: "kill race \u00b7 teams optional \u00b7 tanks only",
    battle: "tower/base objective \u00b7 2 teams \u00b7 all vehicles",
};

/* ================================================================== */

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
    }

    reset() {
        this.confirmed = false;
        this.match = null;
        this._screen = "main";
        this._aboutIndex = 0;
        this.lobby = new Lobby();
    }

    /* ── update ───────────────────────────────────────────── */

    update(dt, input, audio) {
        this._time += dt;
        if (this._screen === "about") {
            this._updateAbout(input, audio);
            return;
        }
        if (this._screen === "main") {
            this._updateMain(input, audio);
            return;
        }
        this._updateLobby(input, audio);
    }

    _updateMain(input, audio) {
        // Any device's confirm → join as P1 and enter the lobby.
        const joiner = this._firstJoiner(input);
        if (joiner) {
            this.lobby.join(joiner);
            this._screen = "lobby";
            this.lobby.cursor = 0;
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
            return;
        }
        // Back → vehicle info.
        if (this._anyPressed(input, ACTIONS.back)) {
            this._screen = "about";
            this._aboutIndex = 0;
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
        }
    }

    _updateLobby(input, audio) {
        // ── Joins (any unjoined device pressing confirm) ──
        for (const device of this._joinCandidates(input)) {
            if (this.lobby.players.length < MAX_PLAYERS) {
                this.lobby.join(device);
                if (audio) {
                    audio.init();
                    audio.playConfirm();
                }
            }
        }

        const host = this.lobby.host;

        // ── Non-host players: switch team / leave ──
        for (const p of this.lobby.players) {
            if (p === host) continue;
            if (
                p.device.wasPressed(ACTIONS.cycleTeam) ||
                p.device.wasPressed(ACTIONS.left) ||
                p.device.wasPressed(ACTIONS.right)
            ) {
                this.lobby.cycleTeam(p);
                if (audio) {
                    audio.init();
                    audio.playSelect();
                }
            }
            if (p.device.wasPressed(ACTIONS.back)) this.lobby.leave(p);
        }

        // ── Host: settings cursor, team, start, leave ──
        if (host) {
            const d = host.device;
            if (d.wasPressed(ACTIONS.cycleTeam)) this.lobby.cycleTeam(host);

            const rows = this.lobby.rows();
            if (d.wasPressed(ACTIONS.up)) {
                this.lobby.cursor = (this.lobby.cursor - 1 + rows.length) % rows.length;
                if (audio) {
                    audio.init();
                    audio.playSelect();
                }
            }
            if (d.wasPressed(ACTIONS.down)) {
                this.lobby.cursor = (this.lobby.cursor + 1) % rows.length;
                if (audio) {
                    audio.init();
                    audio.playSelect();
                }
            }
            if (d.wasPressed(ACTIONS.left) || d.wasPressed(ACTIONS.right)) {
                this.lobby.changeRow(rows[this.lobby.cursor], d.wasPressed(ACTIONS.right));
                if (audio) {
                    audio.init();
                    audio.playSelect();
                }
            }
            if (d.wasPressed(ACTIONS.confirm)) this._startMatch();
            if (d.wasPressed(ACTIONS.back)) {
                this.lobby.leave(host);
                if (this.lobby.players.length === 0) this._screen = "main";
            }
        } else if (this._anyPressed(input, ACTIONS.back)) {
            this._screen = "main";
        }
    }

    _updateAbout(input, audio) {
        const left = this._anyPressed(input, ACTIONS.left);
        const right = this._anyPressed(input, ACTIONS.right);
        const back = this._anyPressed(input, ACTIONS.back);
        const go = this._anyPressed(input, ACTIONS.confirm);

        if (left) {
            this._aboutIndex = (this._aboutIndex - 1 + VEHICLE_INFO.length) % VEHICLE_INFO.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (right) {
            this._aboutIndex = (this._aboutIndex + 1) % VEHICLE_INFO.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (back || go) {
            this._screen = "main";
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
        }
    }

    _startMatch() {
        if (this.lobby.players.length === 0) return;
        this.match = this.lobby.buildMatch();
        this.confirmed = true;
    }

    /* ── input helpers ────────────────────────────────────── */

    _joinCandidates(input) {
        const out = [];
        if (!this.lobby.isJoined(input.keyboard) && input.keyboard.wasPressed(ACTIONS.confirm))
            out.push(input.keyboard);
        for (const gp of input.connectedGamepads) {
            if (!this.lobby.isJoined(gp) && gp.wasPressed(ACTIONS.confirm)) out.push(gp);
        }
        return out;
    }

    _firstJoiner(input) {
        return this._joinCandidates(input)[0] ?? null;
    }

    _anyPressed(input, action) {
        if (input.keyboard?.wasPressed(action)) return true;
        for (const gp of input.connectedGamepads) {
            if (gp.wasPressed(action)) return true;
        }
        return false;
    }

    /* ── rendering ────────────────────────────────────────── */

    render(ctx, canvas) {
        if (this._screen === "about") this._renderAbout(ctx, canvas);
        else if (this._screen === "lobby") this._renderLobby(ctx, canvas);
        else this._renderMain(ctx, canvas);
    }

    /* ── MAIN / title screen ──────────────────────────────── */

    _renderMain(ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = this._time;

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        this._drawGrid(ctx, W, H, t);
        ctx.textAlign = "center";

        // Title
        ctx.font = 'bold 58px "Courier New", monospace';
        ctx.fillStyle = "#cc3333";
        ctx.fillText("TANK", cx - 90, 130);
        ctx.fillStyle = "#3366dd";
        ctx.fillText("BATTLE", cx + 100, 130);
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText("ISOMETRIC  WARFARE", cx, 157);

        // Vehicle showcase
        const vehicleY = 230;
        const spacing = Math.min(150, (W - 80) / (VEHICLE_INFO.length - 1));
        const startX = cx - spacing * ((VEHICLE_INFO.length - 1) / 2);
        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const v = VEHICLE_INFO[i];
            const vx = startX + i * spacing;
            ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.sin(t * 2 + i * 1.5) * 0.02})`;
            ctx.beginPath();
            ctx.arc(vx, vehicleY, 36, 0, Math.PI * 2);
            ctx.fill();
            this._drawMenuVehicle(ctx, vx, vehicleY, t * (0.8 + i * 0.15), v.type, v.color, v.dark, 1.2);
            ctx.font = 'bold 12px "Courier New", monospace';
            ctx.fillStyle = v.color;
            ctx.fillText(v.name, vx, vehicleY + 40);
            ctx.font = '9px "Courier New", monospace';
            ctx.fillStyle = "#555";
            ctx.fillText(v.tagline, vx, vehicleY + 52);
        }

        // Call to action (pulsing)
        const pulse = 0.6 + Math.sin(t * 4) * 0.3;
        ctx.font = 'bold 26px "Courier New", monospace';
        ctx.fillStyle = `rgba(255,255,255,${pulse})`;
        ctx.fillText("PRESS  A / START", cx, H / 2 + 120);

        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#666";
        ctx.fillText("first to press becomes Player 1", cx, H / 2 + 152);

        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("B / Esc   Vehicle info", cx, H - 30);
    }

    /* ── LOBBY screen ─────────────────────────────────────── */

    _renderLobby(ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = this._time;
        const rows = this.lobby.rows();

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        this._drawGrid(ctx, W, H, t);
        ctx.textAlign = "center";

        // ── Header ──
        ctx.font = 'bold 30px "Courier New", monospace';
        ctx.fillStyle = "#777";
        ctx.fillText("MATCH  SETUP", cx, 44);
        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText(GAME_TYPE_DESC[this.lobby.gameType], cx, 66);

        // Game type toggle (cursor row 0)
        const gtY = 92;
        if (this.lobby.cursor === 0) this._cursorBar(ctx, cx - 200, gtY - 20, 400, 32);
        ctx.font = 'bold 22px "Courier New", monospace';
        for (const [i, type] of ["skirmish", "battle"].entries()) {
            const x = cx + (i === 0 ? -90 : 90);
            ctx.fillStyle = this.lobby.gameType === type ? "#fff" : "#555";
            ctx.fillText(GAME_TYPE_LABELS[type], x, gtY + 3);
        }
        ctx.font = 'bold 18px "Courier New", monospace';
        ctx.fillStyle = "#888";
        ctx.fillText("\u25C4", cx - 24, gtY + 3);
        ctx.fillText("\u25BA", cx + 24, gtY + 3);

        // ── Player cards ──
        const cardY = 120;
        const cardW = Math.min(170, (W - 70) / MAX_PLAYERS);
        const cardH = 96;
        const totalW = cardW * MAX_PLAYERS + 20 * (MAX_PLAYERS - 1);
        const startX = cx - totalW / 2;
        for (let i = 0; i < MAX_PLAYERS; i++) {
            const x = startX + i * (cardW + 20);
            const p = this.lobby.players[i];
            const col = p ? PLAYER_COLORS[p.team - 1] : null;

            ctx.fillStyle = p ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)";
            roundedRect(ctx, x, cardY, cardW, cardH, 6);
            ctx.fill();
            if (p) {
                ctx.strokeStyle = col.color;
                ctx.lineWidth = 2;
                roundedRect(ctx, x, cardY, cardW, cardH, 6);
                ctx.stroke();
            }

            const swY = cardY + 26;
            ctx.fillStyle = col ? col.color : "#333";
            ctx.beginPath();
            ctx.arc(x + cardW / 2, swY, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#111";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.font = 'bold 16px "Courier New", monospace';
            ctx.fillStyle = p ? "#eee" : "#555";
            ctx.fillText(`P${i + 1}`, x + cardW / 2, cardY + 54);

            ctx.font = 'bold 13px "Courier New", monospace';
            if (p) {
                ctx.fillStyle = col.color;
                ctx.fillText(col.label, x + cardW / 2, cardY + 76);
            } else {
                ctx.fillStyle = "#444";
                ctx.fillText("PRESS A", x + cardW / 2, cardY + 76);
            }
        }

        // ── Settings rows ──
        const listY = cardY + cardH + 28;
        const rowH = 34;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const y = listY + i * rowH;
            if (i === this.lobby.cursor) this._cursorBar(ctx, cx - 220, y - 8, 440, 30);

            let label;
            let value = "";
            if (row.type === "gameType") {
                label = "GAME TYPE";
                value = GAME_TYPE_LABELS[this.lobby.gameType];
            } else if (row.type === "start") {
                label = "";
                value = "START";
            } else {
                const opt = GAME_OPTIONS.find((o) => o.key === row.key);
                label = opt?.label ?? row.key;
                if (opt?.type === "enum") value = opt.choices[this.lobby.optionValues.get(row.key)].label;
                else if (opt?.type === "range")
                    value = `${this.lobby.optionValues.get(row.key)} / ${this.lobby.effectiveMax(opt)}`;
            }

            ctx.textAlign = "left";
            ctx.font = 'bold 15px "Courier New", monospace';
            ctx.fillStyle = i === this.lobby.cursor ? "#ccc" : "#666";
            ctx.fillText(label, cx - 200, y + 12);
            ctx.textAlign = "right";
            ctx.font = 'bold 15px "Courier New", monospace';
            ctx.fillStyle = i === this.lobby.cursor ? "#fff" : "#999";
            ctx.fillText(value, cx + 200, y + 12);
            ctx.textAlign = "center";
        }

        // ── Hints ──
        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText(
            "A join  \u00b7  X/Tab switch team  \u00b7  B leave  \u00b7  host: \u2191\u2193 select  \u25C4\u25BA change  \u00b7  A start",
            cx,
            H - 24,
        );
    }

    /** Pulsing highlight bar for the host's cursor. */
    _cursorBar(ctx, x, y, w, h) {
        const pulse = 0.05 + Math.sin(this._time * 4) * 0.02;
        ctx.fillStyle = `rgba(255,255,255,${pulse})`;
        roundedRect(ctx, x, y, w, h, 4);
        ctx.fill();
    }

    /* ── ABOUT screen ─────────────────────────────────────── */

    _renderAbout(ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = this._time;
        const vi = VEHICLE_INFO[this._aboutIndex];

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        this._drawGrid(ctx, W, H, t);

        ctx.textAlign = "center";

        ctx.font = 'bold 36px "Courier New", monospace';
        ctx.fillStyle = "#777";
        ctx.fillText("VEHICLE  INFO", cx, 50);

        // Tab bar
        const tabY = 80;
        const tabSpacing = Math.min(180, (W - 40) / VEHICLE_INFO.length);
        const tabStart = cx - (tabSpacing * (VEHICLE_INFO.length - 1)) / 2;

        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const tx = tabStart + i * tabSpacing;
            const sel = i === this._aboutIndex;
            if (sel) {
                ctx.fillStyle = "rgba(255,255,255,0.06)";
                roundedRect(ctx, tx - tabSpacing / 2 + 5, tabY - 14, tabSpacing - 10, 24, 4);
                ctx.fill();
                ctx.fillStyle = VEHICLE_INFO[i].color;
            } else {
                ctx.fillStyle = "#444";
            }
            ctx.font = 'bold 14px "Courier New", monospace';
            ctx.fillText(VEHICLE_INFO[i].name, tx, tabY);
        }

        // Vehicle preview (larger)
        const previewY = 165;
        const glow = 0.06 + Math.sin(t * 2) * 0.02;
        ctx.fillStyle = `rgba(255,255,255,${glow})`;
        ctx.beginPath();
        ctx.arc(cx, previewY, 55, 0, Math.PI * 2);
        ctx.fill();

        this._drawMenuVehicle(ctx, cx, previewY, t * 0.9, vi.type, vi.color, vi.dark, 2.0);

        ctx.font = 'bold 28px "Courier New", monospace';
        ctx.fillStyle = vi.color;
        ctx.fillText(vi.name, cx, previewY + 65);

        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#666";
        ctx.fillText(vi.tagline, cx, previewY + 82);

        // Stats row
        const statsY = previewY + 106;
        const statKeys = Object.keys(vi.stats);
        const statSpacing = Math.min(110, (W - 60) / statKeys.length);
        const statStart = cx - (statSpacing * (statKeys.length - 1)) / 2;

        ctx.fillStyle = "rgba(255,255,255,0.03)";
        roundedRect(ctx, statStart - statSpacing / 2, statsY - 16, statSpacing * statKeys.length, 32, 6);
        ctx.fill();

        ctx.font = 'bold 11px "Courier New", monospace';
        for (let i = 0; i < statKeys.length; i++) {
            const sx = statStart + i * statSpacing;
            const key = statKeys[i];
            ctx.fillStyle = "#555";
            ctx.fillText(key, sx, statsY - 2);
            ctx.fillStyle = vi.color;
            ctx.fillText(`${vi.stats[key]}`, sx, statsY + 12);
        }

        // Description
        const descStartY = statsY + 44;
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#999";
        for (let i = 0; i < vi.desc.length; i++) {
            if (vi.desc[i] !== "") ctx.fillText(vi.desc[i], cx, descStartY + i * 20);
        }

        // Stat bars
        const barY = descStartY + vi.desc.length * 20 + 16;
        this._drawStatCompare(ctx, cx, barY, vi.type, vi.color, W);

        // Nav hints
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("\u25C4  A/D  \u25BA   Switch Vehicle          Enter / Esc   Back", cx, H - 38);

        const arrowPulse = Math.sin(t * 3) * 3;
        ctx.font = "bold 28px sans-serif";
        ctx.fillStyle = "#333";
        ctx.textAlign = "left";
        ctx.fillText("\u25C4", 15 + arrowPulse, H / 2);
        ctx.textAlign = "right";
        ctx.fillText("\u25BA", W - 15 - arrowPulse, H / 2);
        ctx.textAlign = "center";

        // Page dots
        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const dx = cx + (i - (VEHICLE_INFO.length - 1) / 2) * 18;
            ctx.fillStyle = i === this._aboutIndex ? vi.color : "#333";
            ctx.beginPath();
            ctx.arc(dx, H - 60, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── stat comparison bars ─────────────────────────────── */

    _drawStatCompare(ctx, cx, y, activeType, activeColor, canvasW) {
        const metrics = [
            { label: "SPEED", key: "speed", max: 7 },
            { label: "DAMAGE", key: "dmg", max: 2 },
            { label: "ARMOUR", key: "armour", max: 3 },
            { label: "FIRE RATE", key: "rof", max: 6 },
        ];
        const getVal = (type, key) => {
            const v = VEHICLES[type];
            if (type === "squad") {
                if (key === "speed") return v.speed;
                if (key === "dmg") return 1.0;
                if (key === "armour") return 1;
                if (key === "rof") return 6;
                return 0;
            }
            if (key === "speed") return v.speed;
            if (key === "dmg") return type === "drone" ? v.blastDamage : v.bulletDamage;
            if (key === "armour") return type === "tank" ? 2 : 1;
            if (key === "rof") {
                if (type === "drone") return 0;
                return v.bulletCooldown > 0 ? 1 / v.bulletCooldown : 0;
            }
            return 0;
        };
        const barW = Math.min(260, canvasW * 0.35);
        const barH = 8;
        const rowH = 28;
        const startX = cx - barW / 2;
        const labelW = 80;

        ctx.textAlign = "right";
        for (let i = 0; i < metrics.length; i++) {
            const m = metrics[i];
            const my = y + i * rowH;
            const val = getVal(activeType, m.key);
            const frac = Math.min(1, val / m.max);

            ctx.font = 'bold 10px "Courier New", monospace';
            ctx.fillStyle = "#555";
            ctx.fillText(m.label, startX + labelW - 8, my + barH / 2 + 3);

            ctx.fillStyle = "rgba(255,255,255,0.04)";
            ctx.fillRect(startX + labelW, my, barW - labelW, barH);
            ctx.fillStyle = activeColor;
            ctx.fillRect(startX + labelW, my, (barW - labelW) * frac, barH);

            ctx.textAlign = "left";
            ctx.font = '9px "Courier New", monospace';
            ctx.fillStyle = "#666";
            ctx.fillText(
                m.key === "rof" && activeType === "drone" ? "N/A" : val.toFixed(1),
                startX + barW + 6,
                my + barH / 2 + 3,
            );
            ctx.textAlign = "right";
        }
        ctx.textAlign = "center";
    }

    /* ── private drawing helpers ───────────────────────────── */

    _drawGrid(ctx, W, H, t) {
        ctx.strokeStyle = "rgba(255,255,255,0.025)";
        ctx.lineWidth = 1;
        const off = (t * 8) % 64;
        for (let x = -off; x < W + 64; x += 64) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        const offy = (t * 4) % 32;
        for (let y = -offy; y < H + 32; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
    }

    /**
     * Draw a vehicle preview at a configurable scale.  Delegates to the
     * shared vehicle sprite module (the same one the in-game renderer uses).
     */
    _drawMenuVehicle(ctx, sx, sy, angle, type, color, dark, scale) {
        const s = scale !== undefined ? scale : 1.0;
        const fakeTank = {
            alive: true,
            flashTimer: 0,
            vehicleType: type,
            angle,
            turretWorld: angle,
            color,
            darkColor: dark,
            damaged: false,
            leftTrackDisabled: false,
            rightTrackDisabled: false,
            turretDisabled: false,
            recoilTimer: 0,
            treadPhase: (this._time * 2.5) % 1,
            isCharging: false,
            chargeTime: 0,
        };
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(s, s);
        drawVehicle(ctx, fakeTank, 0, 0);
        ctx.restore();
    }
}
