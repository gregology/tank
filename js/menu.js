/**
 * Start-screen menu rendered on the game canvas.
 *
 * Modes are organised into three categories:
 *   DUEL (1v1)      — duel_split, duel_bot
 *   SKIRMISH (2v2)  — skirmish_coop
 *   BATTLE (5v5)    — battle_split, battle_coop, battle_solo
 *
 * Sub-screens:
 *   • main    — mode selection with vehicle showcase
 *   • options — per-game settings (map size, density, etc.)
 *   • about   — scrollable vehicle info cards
 *
 * After selecting a mode the player sees the options screen.
 * Press Enter/Space to accept defaults and start immediately,
 * or adjust values with ←/→ then confirm.
 *
 * Vehicle previews use the EXACT same geometry as the in-game
 * renderer (renderer.js _drawTank / _drawIFV / _drawDrone / _drawSPG),
 * projected at a configurable scale.
 */

import {
    CATEGORY_OPTIONS,
    GAME_OPTIONS,
    getDefaultOptionValues,
    MODE_DEFS,
    resolveSettings,
    VEHICLES,
} from "./config.js";
import { Renderer } from "./renderer.js";

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
];

/* ── Menu items with category headers ─────────────────────── */

const MENU_ITEMS = [
    { type: "header", label: "DUEL  (1v1)" },
    { type: "mode", label: "SPLIT SCREEN", mode: "duel_split", desc: "2 players, tanks" },
    { type: "mode", label: "vs BOT", mode: "duel_bot", desc: "1 player vs AI" },
    { type: "header", label: "SKIRMISH  (2v2)" },
    { type: "mode", label: "CO-OP vs BOTS", mode: "skirmish_coop", desc: "2 players vs 2 AI" },
    { type: "header", label: "BATTLE  (5v5)" },
    { type: "mode", label: "SPLIT SCREEN", mode: "battle_split", desc: "1+4 vs 1+4, bases" },
    { type: "mode", label: "CO-OP", mode: "battle_coop", desc: "2+3 vs 5 AI, bases" },
    { type: "mode", label: "vs BOTS", mode: "battle_solo", desc: "1+4 vs 5 AI, bases" },
    { type: "header", label: "" },
    { type: "mode", label: "VEHICLE INFO", mode: "_about", desc: "" },
];

/* ================================================================== */

export class Menu {
    constructor() {
        // Build selectable indices (skip headers)
        this._items = MENU_ITEMS;
        this._selectableIndices = MENU_ITEMS.map((item, i) => (item.type === "mode" ? i : -1)).filter((i) => i >= 0);
        this._selCursor = 0; // index into _selectableIndices
        this.confirmed = false;
        this.selectedMode = "duel_split";
        /** Resolved settings object (populated when confirmed). */
        this.settings = {};

        // Sub-screen state
        this._screen = "main"; // 'main' | 'options' | 'about'
        this._aboutIndex = 0;

        // Options screen state
        this._optionKeys = []; // keys visible for current mode
        this._optionValues = null; // Map<string, number> of current values
        this._optionCursor = 0; // which option row is highlighted

        // decorative
        this._time = 0;
    }

    /** Currently highlighted item index (into MENU_ITEMS). */
    get selectedIndex() {
        return this._selectableIndices[this._selCursor];
    }

    reset() {
        this.confirmed = false;
        this._screen = "main";
        this._aboutIndex = 0;
        this._optionCursor = 0;
    }

    update(dt, input, audio) {
        this._time += dt;

        if (this._screen === "about") {
            this._updateAbout(input, audio);
            return;
        }
        if (this._screen === "options") {
            this._updateOptions(input, audio);
            return;
        }

        const up = input.wasPressed("ArrowUp") || input.wasPressed("KeyW");
        const down = input.wasPressed("ArrowDown") || input.wasPressed("KeyS");
        const go = input.wasPressed("Enter") || input.wasPressed("Space");

        if (up) {
            this._selCursor = (this._selCursor - 1 + this._selectableIndices.length) % this._selectableIndices.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (down) {
            this._selCursor = (this._selCursor + 1) % this._selectableIndices.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (go) {
            const chosen = this._items[this.selectedIndex];
            if (chosen.mode === "_about") {
                this._screen = "about";
                this._aboutIndex = 0;
                if (audio) {
                    audio.init();
                    audio.playConfirm();
                }
            } else {
                // Transition to options screen
                this.selectedMode = chosen.mode;
                this._enterOptions(chosen.mode);
                if (audio) {
                    audio.init();
                    audio.playConfirm();
                }
            }
        }
    }

    _updateAbout(input, audio) {
        const left = input.wasPressed("ArrowLeft") || input.wasPressed("KeyA");
        const right = input.wasPressed("ArrowRight") || input.wasPressed("KeyD");
        const back = input.wasPressed("Escape") || input.wasPressed("Backspace") || input.wasPressed("KeyR");
        const go = input.wasPressed("Enter") || input.wasPressed("Space");

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

    /* ── rendering ────────────────────────────────────────── */

    render(ctx, canvas) {
        if (this._screen === "about") this._renderAbout(ctx, canvas);
        else if (this._screen === "options") this._renderOptions(ctx, canvas);
        else this._renderMain(ctx, canvas);
    }

    /* ── OPTIONS sub-screen ────────────────────────────────── */

    /** Initialise the options screen for the given mode. */
    _enterOptions(mode) {
        const def = MODE_DEFS[mode];
        const category = def?.category ?? "duel";
        this._optionKeys = CATEGORY_OPTIONS[category] ?? [];
        this._optionValues = getDefaultOptionValues(mode);
        this._optionCursor = 0;
        this._screen = "options";
    }

    /** Effective max for a range option, accounting for maxByMapSize. */
    _effectiveMax(opt) {
        if (opt.maxByMapSize) {
            const msIdx = this._optionValues.get("mapSize") ?? 0;
            return opt.maxByMapSize[msIdx] ?? opt.max;
        }
        return opt.max;
    }

    /** Clamp range options whose max depends on another option (e.g. mapSize). */
    _clampDependentOptions(keys) {
        for (const k of keys) {
            const o = GAME_OPTIONS.find((d) => d.key === k);
            if (!o || o.type !== "range" || !o.maxByMapSize) continue;
            const cur = this._optionValues.get(k);
            const effMax = this._effectiveMax(o);
            if (cur > effMax) this._optionValues.set(k, effMax);
        }
    }

    _updateOptions(input, audio) {
        const up = input.wasPressed("ArrowUp") || input.wasPressed("KeyW");
        const down = input.wasPressed("ArrowDown") || input.wasPressed("KeyS");
        const left = input.wasPressed("ArrowLeft") || input.wasPressed("KeyA");
        const right = input.wasPressed("ArrowRight") || input.wasPressed("KeyD");
        const go = input.wasPressed("Enter") || input.wasPressed("Space");
        const back = input.wasPressed("Escape") || input.wasPressed("Backspace") || input.wasPressed("KeyR");

        const keys = this._optionKeys;
        if (!keys.length) {
            // No options for this mode — confirm immediately
            this.settings = {};
            this.confirmed = true;
            return;
        }

        if (up) {
            this._optionCursor = (this._optionCursor - 1 + keys.length) % keys.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (down) {
            this._optionCursor = (this._optionCursor + 1) % keys.length;
            if (audio) {
                audio.init();
                audio.playSelect();
            }
        }
        if (left || right) {
            const key = keys[this._optionCursor];
            const opt = GAME_OPTIONS.find((o) => o.key === key);
            if (opt) {
                const cur = this._optionValues.get(key);
                if (opt.type === "enum") {
                    const n = opt.choices.length;
                    const next = right ? (cur + 1) % n : (cur - 1 + n) % n;
                    this._optionValues.set(key, next);
                    this._clampDependentOptions(keys);
                } else if (opt.type === "range") {
                    const delta = right ? opt.step : -opt.step;
                    const effMax = this._effectiveMax(opt);
                    const next = Math.min(effMax, Math.max(opt.min, cur + delta));
                    this._optionValues.set(key, next);
                }
                if (audio) {
                    audio.init();
                    audio.playSelect();
                }
            }
        }
        if (go) {
            this.settings = resolveSettings(this._optionValues);
            this.confirmed = true;
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
        }
        if (back) {
            this._screen = "main";
            if (audio) {
                audio.init();
                audio.playConfirm();
            }
        }
    }

    _renderOptions(ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = this._time;
        const keys = this._optionKeys;

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        this._drawGrid(ctx, W, H, t);
        ctx.textAlign = "center";

        // Title
        const modeItem = this._items[this.selectedIndex];
        ctx.font = 'bold 36px "Courier New", monospace';
        ctx.fillStyle = "#777";
        ctx.fillText("GAME  OPTIONS", cx, 60);

        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#555";
        const modeLabel = modeItem ? modeItem.label : this.selectedMode;
        ctx.fillText(modeLabel, cx, 85);

        // Options list
        const startY = 140;
        const rowH = 48;

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const opt = GAME_OPTIONS.find((o) => o.key === key);
            if (!opt) continue;
            const y = startY + i * rowH;
            const sel = i === this._optionCursor;
            const cur = this._optionValues.get(key);

            // Highlight bar
            if (sel) {
                const pulse = 0.06 + Math.sin(t * 4) * 0.02;
                ctx.fillStyle = `rgba(255,255,255,${pulse})`;
                this._roundedRect(ctx, cx - 240, y - 6, 480, 38, 4);
                ctx.fill();
            }

            // Label
            ctx.font = 'bold 15px "Courier New", monospace';
            ctx.fillStyle = sel ? "#ccc" : "#666";
            ctx.textAlign = "left";
            ctx.fillText(opt.label, cx - 220, y + 16);

            // Value display
            ctx.textAlign = "center";
            let valueText = "";
            if (opt.type === "enum") {
                valueText = opt.choices[cur].label;
            } else if (opt.type === "range") {
                const effMax = this._effectiveMax(opt);
                valueText = `${cur} / ${effMax}`;
            }

            if (sel) {
                // Arrows + value
                const arrowPulse = Math.sin(t * 4) * 2;
                ctx.font = 'bold 18px "Courier New", monospace';
                ctx.fillStyle = "#888";
                ctx.fillText("\u25C4", cx + 60 - arrowPulse, y + 17);
                ctx.fillText("\u25BA", cx + 220 + arrowPulse, y + 17);

                ctx.font = 'bold 16px "Courier New", monospace';
                ctx.fillStyle = "#fff";
                ctx.fillText(valueText, cx + 140, y + 17);
            } else {
                ctx.font = '15px "Courier New", monospace';
                ctx.fillStyle = "#888";
                ctx.fillText(valueText, cx + 140, y + 17);
            }
        }

        // Hints
        const hintY = startY + keys.length * rowH + 30;
        ctx.textAlign = "center";
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("\u2191 \u2193  Select     \u25C4 \u25BA  Change     Enter  Start     Esc  Back", cx, hintY);

        // Bottom note
        ctx.font = '12px "Courier New", monospace';
        ctx.fillStyle = "#333";
        ctx.fillText("Press Enter / Space to accept defaults and start", cx, H - 30);
    }

    /* ── MAIN MENU screen ─────────────────────────────────── */

    _renderMain(ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2,
            cy = H / 2 - 50;
        const t = this._time;

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        this._drawGrid(ctx, W, H, t);

        ctx.textAlign = "center";

        // Title
        ctx.font = 'bold 58px "Courier New", monospace';
        ctx.fillStyle = "#cc3333";
        ctx.fillText("TANK", cx - 90, cy - 210);
        ctx.fillStyle = "#3366dd";
        ctx.fillText("BATTLE", cx + 100, cy - 210);

        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText("ISOMETRIC  WARFARE", cx, cy - 183);

        // Vehicle showcase
        const vehicleY = cy - 130;
        const spacing = Math.min(160, (W - 80) / 4);
        const startX = cx - spacing * 1.5;

        for (let i = 0; i < VEHICLE_INFO.length; i++) {
            const v = VEHICLE_INFO[i];
            const vx = startX + i * spacing;

            const glow = 0.04 + Math.sin(t * 2 + i * 1.5) * 0.02;
            ctx.fillStyle = `rgba(255,255,255,${glow})`;
            ctx.beginPath();
            ctx.arc(vx, vehicleY, 36, 0, Math.PI * 2);
            ctx.fill();

            const angle = t * (0.8 + i * 0.15);
            this._drawMenuVehicle(ctx, vx, vehicleY, angle, v.type, v.color, v.dark, 1.2);

            ctx.font = 'bold 12px "Courier New", monospace';
            ctx.fillStyle = v.color;
            ctx.textAlign = "center";
            ctx.fillText(v.name, vx, vehicleY + 40);

            ctx.font = '9px "Courier New", monospace';
            ctx.fillStyle = "#555";
            ctx.fillText(v.tagline, vx, vehicleY + 52);
        }

        // ── Menu items with category headers ──
        const menuStartY = cy - 50;
        const rowH = 30;
        const headerH = 26;
        let y = menuStartY;

        for (let i = 0; i < this._items.length; i++) {
            const item = this._items[i];
            const sel = item.type === "mode" && i === this.selectedIndex;

            if (item.type === "header") {
                // Category header (non-selectable, dim)
                if (item.label) {
                    y += 6; // extra gap before header
                    ctx.font = 'bold 13px "Courier New", monospace';
                    ctx.fillStyle = "#444";
                    ctx.fillText(`\u2500\u2500  ${item.label}  \u2500\u2500`, cx, y);
                }
                y += headerH;
            } else {
                // Selectable mode item
                if (sel) {
                    const pulse = 0.05 + Math.sin(t * 4) * 0.02;
                    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
                    ctx.fillRect(cx - 200, y - 16, 400, rowH);
                    ctx.font = 'bold 20px "Courier New", monospace';
                    ctx.fillStyle = "#fff";
                    ctx.fillText(`\u25BA  ${item.label}`, cx - 20, y + 4);
                    // Description on the right
                    if (item.desc) {
                        ctx.font = '11px "Courier New", monospace';
                        ctx.fillStyle = "#888";
                        ctx.textAlign = "right";
                        ctx.fillText(item.desc, cx + 190, y + 4);
                        ctx.textAlign = "center";
                    }
                } else {
                    ctx.font = 'bold 18px "Courier New", monospace';
                    ctx.fillStyle = "#555";
                    ctx.fillText(`   ${item.label}`, cx - 20, y + 4);
                }
                y += rowH;
            }
        }

        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = "#444";
        ctx.fillText("\u2191 \u2193   Select          Enter   Start", cx, y + 16);

        // ── Controls panel (anchored to bottom, contextual) ──
        const chosen = this._items[this.selectedIndex];
        const modeDef = chosen.mode && chosen.mode !== "_about" ? MODE_DEFS[chosen.mode] : null;
        if (modeDef) {
            const isSplit = modeDef.split;
            const panelH = isSplit ? 84 : 68;
            const panelY = H - panelH - 30;

            // Background
            ctx.fillStyle = "rgba(255,255,255,0.04)";
            this._roundedRect(ctx, cx - 230, panelY, 460, panelH, 6);
            ctx.fill();

            ctx.font = 'bold 11px "Courier New", monospace';
            ctx.fillStyle = "#666";
            ctx.fillText("──  CONTROLS  ──", cx, panelY + 14);

            ctx.font = '13px "Courier New", monospace';
            if (isSplit) {
                ctx.fillStyle = "#cc3333";
                ctx.fillText("P1", cx - 185, panelY + 32);
                ctx.fillStyle = "#aaa";
                ctx.fillText("WASD move  ·  QE turret  ·  SPACE fire", cx + 10, panelY + 32);

                ctx.fillStyle = "#3366dd";
                ctx.fillText("P2", cx - 185, panelY + 50);
                ctx.fillStyle = "#aaa";
                ctx.fillText("Arrows move  ·  ,. turret  ·  ENTER fire", cx + 10, panelY + 50);

                ctx.fillStyle = "#44bb44";
                ctx.fillText("PAD", cx - 185, panelY + 68);
                ctx.fillStyle = "#aaa";
                ctx.fillText("Y fwd · X rev · Stick steer · A fire", cx + 10, panelY + 68);
            } else {
                ctx.fillStyle = "#aaa";
                ctx.fillText("WASD move  ·  QE turret  ·  SPACE fire", cx, panelY + 30);
                ctx.fillStyle = "#888";
                ctx.fillText("Gamepad:  Y fwd  ·  X rev  ·  Stick steer  ·  A fire", cx, panelY + 48);
            }

            ctx.font = '10px "Courier New", monospace';
            ctx.fillStyle = "#555";
            ctx.fillText("R  back to menu  ·  Space / Enter  rematch after game", cx, panelY + panelH - 6);
        }

        ctx.fillText("W/S also navigate  \u00b7  Sound auto-enabled", cx, H - 20);
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
                this._roundedRect(ctx, tx - tabSpacing / 2 + 5, tabY - 14, tabSpacing - 10, 24, 4);
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
        this._roundedRect(ctx, statStart - statSpacing / 2, statsY - 16, statSpacing * statKeys.length, 32, 6);
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
     * Draw a vehicle preview at a configurable scale.
     *
     * Delegates to the in-game vehicle renderers in renderer.js via a
     * prototype-only instance, so menu previews always match the
     * gameplay art.  A lightweight fake tank object satisfies the
     * renderer's interface; menu time drives tread scroll.
     */
    _drawMenuVehicle(ctx, sx, sy, angle, type, color, dark, scale) {
        const s = scale !== undefined ? scale : 1.0;
        if (!this._vehicleRenderer) this._vehicleRenderer = Object.create(Renderer.prototype);
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
        this._vehicleRenderer._drawVehicle(ctx, fakeTank, 0, 0);
        ctx.restore();
    }

    /* ── utility ──────────────────────────────────────────── */

    _roundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }
}
