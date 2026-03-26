/**
 * Start-screen menu rendered on the game canvas.
 *
 * Modes are organised into three categories:
 *   DUEL (1v1)      — duel_split, duel_bot
 *   SKIRMISH (2v2)  — skirmish_coop
 *   BATTLE (5v5)    — battle_split, battle_coop, battle_solo
 *
 * Sub-screens:
 *   • main   — mode selection with vehicle showcase
 *   • about  — scrollable vehicle info cards
 *
 * Vehicle previews use the EXACT same geometry as the in-game
 * renderer (renderer.js _drawTank / _drawIFV / _drawDrone / _drawSPG),
 * projected at a configurable scale.
 */

import { CONFIG, MODE_DEFS, VEHICLES } from "./config.js";

const TW = CONFIG.TILE_WIDTH;
const TH = CONFIG.TILE_HEIGHT;

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

        // Sub-screen state
        this._screen = "main"; // 'main' | 'about'
        this._aboutIndex = 0;

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
    }

    update(dt, input, audio) {
        this._time += dt;

        if (this._screen === "about") {
            this._updateAbout(input, audio);
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
                this.selectedMode = chosen.mode;
                this.confirmed = true;
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
        else this._renderMain(ctx, canvas);
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
            const panelH = isSplit ? 68 : 52;
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
            } else {
                ctx.fillStyle = "#aaa";
                ctx.fillText("WASD move  ·  QE turret  ·  SPACE fire", cx, panelY + 32);
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

    _drawMenuVehicle(ctx, sx, sy, angle, type, color, dark, scale) {
        const s = scale !== undefined ? scale : 1.0;
        ctx.save();
        if (type === "tank") this._drawMenuTank(ctx, sx, sy, angle, color, dark, s);
        else if (type === "ifv") this._drawMenuIFV(ctx, sx, sy, angle, color, dark, s);
        else if (type === "drone") this._drawMenuDrone(ctx, sx, sy, angle, color, dark, s);
        else if (type === "spg") this._drawMenuSPG(ctx, sx, sy, angle, color, dark, s);
        ctx.restore();
    }

    /* ────────────────────────────────────────────────────────
     *  Vehicle drawing methods — identical to original menu.js
     *  (tank, IFV, drone, SPG preview renderers)
     * ──────────────────────────────────────────────────────── */

    _drawMenuTank(ctx, sx, sy, angle, color, dark, sc) {
        const ca = Math.cos(angle),
            sa = Math.sin(angle);
        const HTW = (TW / 2) * sc,
            HTH = (TH / 2) * sc;
        const treadPhase = (this._time * 2.5) % 1;

        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const PT = P;

        const fill = (pts, c) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const outline = (pts, c, w) => {
            ctx.strokeStyle = c;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);
        const slab = (topPts, h, topC, wallC) => {
            fill(drop(topPts, h), wallC);
            fill(topPts, topC);
        };

        const THL = 0.38,
            TYO = 0.3,
            TYI = 0.21;
        const HR = -0.28,
            HF = 0.24,
            HT = 0.34,
            HW = 0.2;
        const TR = 0.13,
            BHW = 0.03,
            BX0 = 0.1,
            BX1 = 0.52;
        const TRACK_H = 4 * sc,
            HULL_H = 7 * sc,
            TURR_H = 5 * sc,
            BARR_H = 3 * sc;

        const trackTop = -TRACK_H;
        const hullTop = -(TRACK_H + HULL_H);
        const turrTop = -(TRACK_H + HULL_H + TURR_H);
        const barrTop = -(TRACK_H + HULL_H + BARR_H);

        fill(
            drop(
                [
                    P(-THL - 0.04, -TYO - 0.02),
                    P(THL + 0.04, -TYO - 0.02),
                    P(THL + 0.04, TYO + 0.02),
                    P(-THL - 0.04, TYO + 0.02),
                ],
                6 * sc,
            ),
            "rgba(0,0,0,0.18)",
        );
        slab(lift([P(-THL, -TYO), P(THL, -TYO), P(THL, -TYI), P(-THL, -TYI)], trackTop), TRACK_H, "#2a2a2a", "#111");
        slab(lift([P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)], trackTop), TRACK_H, "#2a2a2a", "#111");

        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1.5 * sc;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const t = (i / 8 + treadPhase) % 1;
            const lx = -THL + t * THL * 2;
            const a1 = lift([P(lx, -TYO)], trackTop)[0];
            const a2 = lift([P(lx, -TYI)], trackTop)[0];
            ctx.moveTo(a1[0], a1[1]);
            ctx.lineTo(a2[0], a2[1]);
            const b1 = lift([P(lx, TYI)], trackTop)[0];
            const b2 = lift([P(lx, TYO)], trackTop)[0];
            ctx.moveTo(b1[0], b1[1]);
            ctx.lineTo(b2[0], b2[1]);
        }
        ctx.stroke();

        ctx.fillStyle = "#1a1a1a";
        for (let i = 0; i < 3; i++) {
            const lx = -THL * 0.6 + i * THL * 0.6;
            const cL = lift([P(lx, -(TYO + TYI) / 2)], trackTop)[0];
            ctx.beginPath();
            ctx.arc(cL[0], cL[1], 2 * sc, 0, Math.PI * 2);
            ctx.fill();
            const cR = lift([P(lx, (TYO + TYI) / 2)], trackTop)[0];
            ctx.beginPath();
            ctx.arc(cR[0], cR[1], 2 * sc, 0, Math.PI * 2);
            ctx.fill();
        }

        const hullPts = lift([P(HR, -HW), P(HF, -HW), P(HT, 0), P(HF, HW), P(HR, HW)], hullTop);
        slab(hullPts, HULL_H, color, dark);
        outline(hullPts, dark, 0.5);
        const rearW = HW - 0.03;
        fill(lift([P(HR, -rearW), P(HR + 0.05, -rearW), P(HR + 0.05, rearW), P(HR, rearW)], hullTop), dark);
        ctx.strokeStyle = dark;
        ctx.lineWidth = 1 * sc;
        const rg1 = lift([P(HR + 0.08, 0)], hullTop)[0];
        const rg2 = lift([P(HF - 0.04, 0)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(rg1[0], rg1[1]);
        ctx.lineTo(rg2[0], rg2[1]);
        ctx.stroke();
        ctx.lineWidth = 0.5;
        const sp1a = lift([P(HR + 0.04, -HW)], hullTop)[0];
        const sp1b = lift([P(HR + 0.04, HW)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(sp1a[0], sp1a[1]);
        ctx.lineTo(sp1b[0], sp1b[1]);
        ctx.stroke();

        const barrPts = lift([PT(BX0, -BHW), PT(BX1, -BHW), PT(BX1, BHW), PT(BX0, BHW)], barrTop);
        slab(barrPts, BARR_H, "#666", "#333");
        const MZ = 0.04;
        slab(
            lift(
                [
                    PT(BX1 - MZ, -BHW - 0.015),
                    PT(BX1 + 0.01, -BHW - 0.015),
                    PT(BX1 + 0.01, BHW + 0.015),
                    PT(BX1 - MZ, BHW + 0.015),
                ],
                barrTop,
            ),
            BARR_H,
            "#777",
            "#444",
        );

        const tPts = [],
            tHatch = [];
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            tPts.push(lift([PT(Math.cos(a) * TR, Math.sin(a) * TR)], turrTop)[0]);
            tHatch.push(lift([PT(Math.cos(a) * TR * 0.35, Math.sin(a) * TR * 0.35)], turrTop)[0]);
        }
        slab(tPts, TURR_H, color, dark);
        outline(tPts, dark, 0.5);
        fill(tHatch, dark);
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        const ht = lift([PT(0, -TR * 0.3)], turrTop)[0];
        const hb = lift([PT(0, TR * 0.3)], turrTop)[0];
        const hl = lift([PT(-TR * 0.3, 0)], turrTop)[0];
        const hr = lift([PT(TR * 0.3, 0)], turrTop)[0];
        ctx.beginPath();
        ctx.moveTo(ht[0], ht[1]);
        ctx.lineTo(hb[0], hb[1]);
        ctx.moveTo(hl[0], hl[1]);
        ctx.lineTo(hr[0], hr[1]);
        ctx.stroke();
    }

    _drawMenuIFV(ctx, sx, sy, angle, color, dark, sc) {
        // Simplified — same geometry as original, just compacted
        const ca = Math.cos(angle),
            sa = Math.sin(angle);
        const HTW = (TW / 2) * sc,
            HTH = (TH / 2) * sc;
        const treadPhase = (this._time * 2.5) % 1;
        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const fill = (pts, c) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const outline = (pts, c, w) => {
            ctx.strokeStyle = c;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);
        const slab = (topPts, h, topC, wallC) => {
            fill(drop(topPts, h), wallC);
            fill(topPts, topC);
        };

        const SHL = 0.36,
            SHW = 0.26,
            SWO = 0.3,
            BHW = 0.02,
            BX0 = 0.05,
            BX1 = 0.48,
            MHW = 0.07,
            MHL = 0.1;
        const WHEEL_H = 4 * sc,
            HULL_H = 4 * sc,
            MOUNT_H = 3 * sc,
            BARR_H = 2 * sc;
        const wheelTop = -WHEEL_H,
            hullTop = -(WHEEL_H + HULL_H),
            mountTop = -(WHEEL_H + HULL_H + MOUNT_H),
            barrTop = -(WHEEL_H + HULL_H + BARR_H);

        fill(
            drop(
                [
                    P(-SHL - 0.04, -SWO - 0.03),
                    P(SHL + 0.04, -SWO - 0.03),
                    P(SHL + 0.04, SWO + 0.03),
                    P(-SHL - 0.04, SWO + 0.03),
                ],
                5 * sc,
            ),
            "rgba(0,0,0,0.2)",
        );
        const wheelXs = [-0.24, -0.08, 0.08, 0.24],
            wheelR = 4.5 * sc;
        for (const wx of wheelXs) {
            for (const side of [-1, 1]) {
                const wc = lift([P(wx, SWO * side)], wheelTop)[0];
                ctx.fillStyle = "#1a1a1a";
                ctx.beginPath();
                ctx.arc(wc[0], wc[1], wheelR, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#555";
                ctx.beginPath();
                ctx.arc(wc[0], wc[1], wheelR * 0.5, 0, Math.PI * 2);
                ctx.fill();
                const spA = treadPhase * Math.PI * 2;
                ctx.strokeStyle = "#777";
                ctx.lineWidth = 1;
                ctx.beginPath();
                const dx1 = Math.cos(spA) * wheelR * 0.35,
                    dy1 = Math.sin(spA) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx1, wc[1] - dy1 * 0.5);
                ctx.lineTo(wc[0] + dx1, wc[1] + dy1 * 0.5);
                const dx2 = Math.cos(spA + Math.PI / 2) * wheelR * 0.35,
                    dy2 = Math.sin(spA + Math.PI / 2) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx2, wc[1] - dy2 * 0.5);
                ctx.lineTo(wc[0] + dx2, wc[1] + dy2 * 0.5);
                ctx.stroke();
            }
        }
        const hullPts = lift([P(-SHL, -SHW), P(SHL, -SHW), P(SHL, SHW), P(-SHL, SHW)], hullTop);
        slab(hullPts, HULL_H, color, dark);
        outline(hullPts, dark, 0.7);
        fill(
            lift(
                [P(-SHL, -SHW + 0.03), P(-SHL + 0.04, -SHW + 0.03), P(-SHL + 0.04, SHW - 0.03), P(-SHL, SHW - 0.03)],
                hullTop,
            ),
            dark,
        );
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2 * sc;
        const chev1 = lift([P(0.12, -SHW * 0.6)], hullTop)[0];
        const chev2 = lift([P(0.22, 0)], hullTop)[0];
        const chev3 = lift([P(0.12, SHW * 0.6)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(chev1[0], chev1[1]);
        ctx.lineTo(chev2[0], chev2[1]);
        ctx.lineTo(chev3[0], chev3[1]);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 2.5 * sc;
        const s1 = lift([P(-SHL + 0.05, -SHW)], hullTop)[0];
        const s2 = lift([P(SHL - 0.05, -SHW)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(s1[0], s1[1]);
        ctx.lineTo(s2[0], s2[1]);
        ctx.stroke();
        const s3 = lift([P(-SHL + 0.05, SHW)], hullTop)[0];
        const s4 = lift([P(SHL - 0.05, SHW)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(s3[0], s3[1]);
        ctx.lineTo(s4[0], s4[1]);
        ctx.stroke();
        ctx.strokeStyle = dark;
        ctx.lineWidth = 0.6;
        const cb1 = lift([P(-0.1, -SHW)], hullTop)[0];
        const cb2 = lift([P(-0.1, SHW)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(cb1[0], cb1[1]);
        ctx.lineTo(cb2[0], cb2[1]);
        ctx.stroke();
        slab(lift([P(BX0, -BHW), P(BX1, -BHW), P(BX1, BHW), P(BX0, BHW)], barrTop), BARR_H, "#777", "#444");
        slab(
            lift(
                [
                    P(BX1 - 0.02, -BHW - 0.008),
                    P(BX1 + 0.005, -BHW - 0.008),
                    P(BX1 + 0.005, BHW + 0.008),
                    P(BX1 - 0.02, BHW + 0.008),
                ],
                barrTop,
            ),
            BARR_H,
            "#888",
            "#555",
        );
        const mountPts = lift([P(-MHL, -MHW), P(MHL, -MHW), P(MHL, MHW), P(-MHL, MHW)], mountTop);
        slab(mountPts, MOUNT_H, color, dark);
        outline(mountPts, dark, 0.5);
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1.5 * sc;
        const vs1 = lift([P(MHL - 0.01, -MHW * 0.5)], mountTop)[0];
        const vs2 = lift([P(MHL - 0.01, MHW * 0.5)], mountTop)[0];
        ctx.beginPath();
        ctx.moveTo(vs1[0], vs1[1]);
        ctx.lineTo(vs2[0], vs2[1]);
        ctx.stroke();
    }

    _drawMenuDrone(ctx, sx, sy, angle, color, dark, sc) {
        const ca = Math.cos(angle),
            sa = Math.sin(angle);
        const HTW = (TW / 2) * sc,
            HTH = (TH / 2) * sc;
        const t = this._time;
        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const fill = (pts, c) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

        const hoverH = (20 + Math.sin(t * 3) * 2) * sc;
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath();
        ctx.ellipse(sx, sy + (TH / 4) * sc, 8 * sc, 4 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
        const armLen = 0.2;
        const arms = [
            { lx: armLen, ly: armLen },
            { lx: armLen, ly: -armLen },
            { lx: -armLen, ly: armLen },
            { lx: -armLen, ly: -armLen },
        ];
        const centre = lift([P(0, 0)], -hoverH)[0];
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 2 * sc;
        for (const arm of arms) {
            const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];
            ctx.beginPath();
            ctx.moveTo(centre[0], centre[1]);
            ctx.lineTo(tip[0], tip[1]);
            ctx.stroke();
        }
        const rotorPhase = t * 25;
        for (let ai = 0; ai < arms.length; ai++) {
            const arm = arms[ai];
            const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];
            ctx.fillStyle = "rgba(180,180,180,0.2)";
            ctx.beginPath();
            ctx.arc(tip[0], tip[1], 6 * sc, 0, Math.PI * 2);
            ctx.fill();
            const bladeAngle = rotorPhase + ai * 0.7;
            ctx.strokeStyle = "rgba(80,80,80,0.5)";
            ctx.lineWidth = 1.5 * sc;
            const r = 5 * sc;
            ctx.beginPath();
            for (let b = 0; b < 2; b++) {
                const a = bladeAngle + (b * Math.PI) / 2;
                const dx = Math.cos(a) * r;
                const dy = Math.sin(a) * r * 0.5;
                ctx.moveTo(tip[0] - dx, tip[1] - dy);
                ctx.lineTo(tip[0] + dx, tip[1] + dy);
            }
            ctx.stroke();
        }
        const bw = 0.09,
            bh = 0.06;
        const body = lift([P(-bw, -bh), P(bw, -bh), P(bw, bh), P(-bw, bh)], -hoverH);
        fill(body, color);
        ctx.strokeStyle = dark;
        ctx.lineWidth = 0.7 * sc;
        ctx.beginPath();
        ctx.moveTo(body[0][0], body[0][1]);
        for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
        ctx.closePath();
        ctx.stroke();
        fill(lift([P(-0.04, -0.03), P(0.04, -0.03), P(0.04, 0.03), P(-0.04, 0.03)], -hoverH + 2 * sc), dark);
        if (Math.sin(t * 5) > 0) {
            const nose = lift([P(bw + 0.03, 0)], -hoverH)[0];
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(nose[0], nose[1], 1.5 * sc, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _drawMenuSPG(ctx, sx, sy, angle, color, dark, sc) {
        const ca = Math.cos(angle),
            sa = Math.sin(angle);
        const ta = ca,
            tb = sa;
        const HTW = (TW / 2) * sc,
            HTH = (TH / 2) * sc;
        const treadPhase = (this._time * 2.5) % 1;
        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const PT = (lx, ly) => {
            const wx = lx * ta - ly * tb;
            const wy = lx * tb + ly * ta;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const fill = (pts, c) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const outline = (pts, c, w) => {
            ctx.strokeStyle = c;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);
        const slab = (topPts, h, topC, wallC) => {
            fill(drop(topPts, h), wallC);
            fill(topPts, topC);
        };

        const parseHex = (hex) => [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ];
        const teamRGB = parseHex(color);
        const teamDarkRGB = parseHex(dark);
        const olive = [85, 95, 55];
        const oliveDark = [50, 58, 32];
        const mix = (a, b, t) =>
            "rgb(" +
            ((a[0] * (1 - t) + b[0] * t) | 0) +
            "," +
            ((a[1] * (1 - t) + b[1] * t) | 0) +
            "," +
            ((a[2] * (1 - t) + b[2] * t) | 0) +
            ")";
        const hullColor = mix(teamRGB, olive, 0.45);
        const hullDark = mix(teamDarkRGB, oliveDark, 0.45);
        const hullAccent = mix(teamRGB, olive, 0.6);

        const THL = 0.5,
            TYO = 0.32,
            TYI = 0.22,
            HR = -0.46,
            HF = 0.36,
            HW = 0.24;
        const TURR_CX = -0.08,
            TRX = 0.22,
            TRY = 0.18;
        const BHW = 0.04,
            BX0 = TURR_CX + TRX - 0.02,
            BX1 = 0.72,
            BARR_ELEV = 6 * sc;
        const TRACK_H = 5 * sc,
            HULL_H = 6 * sc,
            TURR_H = 9 * sc,
            BARR_H = 3 * sc;
        const trackTop = -TRACK_H,
            hullTop = -(TRACK_H + HULL_H),
            turrTop = -(TRACK_H + HULL_H + TURR_H),
            barrBase = -(TRACK_H + HULL_H + BARR_H + 2 * sc);

        fill(
            drop(
                [
                    P(-THL - 0.06, -TYO - 0.03),
                    P(THL + 0.06, -TYO - 0.03),
                    P(THL + 0.06, TYO + 0.03),
                    P(-THL - 0.06, TYO + 0.03),
                ],
                7 * sc,
            ),
            "rgba(0,0,0,0.2)",
        );
        slab(lift([P(-THL, -TYO), P(THL, -TYO), P(THL, -TYI), P(-THL, -TYI)], trackTop), TRACK_H, "#282828", "#0e0e0e");
        slab(lift([P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)], trackTop), TRACK_H, "#282828", "#0e0e0e");
        ctx.strokeStyle = "#3e3e3e";
        ctx.lineWidth = 1.5 * sc;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
            const t = (i / 14 + treadPhase) % 1;
            const lx = -THL + t * THL * 2;
            const a1 = lift([P(lx, -TYO)], trackTop)[0];
            const a2 = lift([P(lx, -TYI)], trackTop)[0];
            ctx.moveTo(a1[0], a1[1]);
            ctx.lineTo(a2[0], a2[1]);
            const b1 = lift([P(lx, TYI)], trackTop)[0];
            const b2 = lift([P(lx, TYO)], trackTop)[0];
            ctx.moveTo(b1[0], b1[1]);
            ctx.lineTo(b2[0], b2[1]);
        }
        ctx.stroke();
        ctx.fillStyle = "#181818";
        for (let i = 0; i < 5; i++) {
            const lx = -THL * 0.8 + i * THL * 0.4;
            for (const side of [-1, 1]) {
                const cy = side > 0 ? (TYO + TYI) / 2 : -(TYO + TYI) / 2;
                const c = lift([P(lx, cy)], trackTop)[0];
                ctx.beginPath();
                ctx.arc(c[0], c[1], 2.2 * sc, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        const hullPts = lift(
            [P(HR, -HW), P(HF - 0.08, -HW), P(HF, -HW + 0.06), P(HF, HW - 0.06), P(HF - 0.08, HW), P(HR, HW)],
            hullTop,
        );
        slab(hullPts, HULL_H, hullColor, hullDark);
        outline(hullPts, hullDark, 0.6);
        const spadeW = 0.06,
            spadeL = 0.14;
        for (const side of [-1, 1]) {
            const sy2 = HW * 0.5 * side;
            slab(
                lift(
                    [
                        P(HR, sy2 - spadeW),
                        P(HR - spadeL, sy2 - spadeW * 1.5),
                        P(HR - spadeL, sy2 + spadeW * 1.5),
                        P(HR, sy2 + spadeW),
                    ],
                    hullTop,
                ),
                HULL_H + 3 * sc,
                "#4a4a4a",
                "#2a2a2a",
            );
            fill(
                lift(
                    [
                        P(HR - spadeL, sy2 - spadeW * 2),
                        P(HR - spadeL - 0.03, sy2 - spadeW * 2),
                        P(HR - spadeL - 0.03, sy2 + spadeW * 2),
                        P(HR - spadeL, sy2 + spadeW * 2),
                    ],
                    hullTop + 2 * sc,
                ),
                "#3a3a3a",
            );
        }
        fill(
            lift([P(HR, -HW + 0.03), P(HR + 0.04, -HW + 0.03), P(HR + 0.04, HW - 0.03), P(HR, HW - 0.03)], hullTop),
            hullDark,
        );
        slab(
            lift(
                [
                    P(TURR_CX + TRX + 0.04, -HW + 0.03),
                    P(HF - 0.1, -HW + 0.03),
                    P(HF - 0.1, HW - 0.03),
                    P(TURR_CX + TRX + 0.04, HW - 0.03),
                ],
                hullTop,
            ),
            2 * sc,
            hullAccent,
            hullDark,
        );
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 4; i++) {
            const fx = TURR_CX + TRX + 0.06 + i * 0.04;
            const g1 = lift([P(fx, -HW + 0.06)], hullTop)[0];
            const g2 = lift([P(fx, HW - 0.06)], hullTop)[0];
            ctx.beginPath();
            ctx.moveTo(g1[0], g1[1]);
            ctx.lineTo(g2[0], g2[1]);
            ctx.stroke();
        }
        for (const side of [-1, 1]) {
            const binY = HW * side;
            slab(
                lift([P(-0.3, binY - 0.04 * side), P(0.0, binY - 0.04 * side), P(0.0, binY), P(-0.3, binY)], hullTop),
                3 * sc,
                "#5a6340",
                "#3a4228",
            );
            ctx.fillStyle = "#777";
            const latch = lift([P(-0.15, binY - 0.01 * side)], hullTop - 1 * sc)[0];
            ctx.fillRect(latch[0] - 1, latch[1], 2, 1.5);
        }
        ctx.strokeStyle = "rgba(70,80,50,0.4)";
        ctx.lineWidth = 2 * sc;
        for (let i = 0; i < 3; i++) {
            const nx = HR + 0.08 + i * 0.06;
            const n1 = lift([P(nx, -HW * 0.8)], hullTop - 1 * sc)[0];
            const n2 = lift([P(nx + 0.04, HW * 0.3)], hullTop)[0];
            const n3 = lift([P(nx - 0.02, HW * 0.7)], hullTop - 1 * sc)[0];
            ctx.beginPath();
            ctx.moveTo(n1[0], n1[1]);
            ctx.quadraticCurveTo(n2[0], n2[1], n3[0], n3[1]);
            ctx.stroke();
        }

        const barrLen = BX1 - BX0;
        for (let i = 0; i < 6; i++) {
            const t0 = i / 6,
                t1 = (i + 1) / 6;
            const x0 = BX0 + barrLen * t0,
                x1 = BX0 + barrLen * t1;
            const elev0 = barrBase - BARR_ELEV * t0,
                elev1 = barrBase - BARR_ELEV * t1;
            const seg = [
                [PT(x0, -BHW)[0], PT(x0, -BHW)[1] + elev0],
                [PT(x1, -BHW)[0], PT(x1, -BHW)[1] + elev1],
                [PT(x1, BHW)[0], PT(x1, BHW)[1] + elev1],
                [PT(x0, BHW)[0], PT(x0, BHW)[1] + elev0],
            ];
            slab(seg, BARR_H, i % 2 === 0 ? "#5a5a5a" : "#606060", "#333");
        }
        const mx = BX1,
            mElev = barrBase - BARR_ELEV;
        slab(
            [
                [PT(mx - 0.04, -BHW - 0.025)[0], PT(mx - 0.04, -BHW - 0.025)[1] + mElev],
                [PT(mx + 0.02, -BHW - 0.025)[0], PT(mx + 0.02, -BHW - 0.025)[1] + mElev],
                [PT(mx + 0.02, BHW + 0.025)[0], PT(mx + 0.02, BHW + 0.025)[1] + mElev],
                [PT(mx - 0.04, BHW + 0.025)[0], PT(mx - 0.04, BHW + 0.025)[1] + mElev],
            ],
            BARR_H,
            "#707070",
            "#404040",
        );
        const fmX = BX0 + barrLen * 0.35,
            fmElev = barrBase - BARR_ELEV * 0.35;
        slab(
            [
                [PT(fmX - 0.025, -BHW - 0.015)[0], PT(fmX - 0.025, -BHW - 0.015)[1] + fmElev],
                [PT(fmX + 0.025, -BHW - 0.015)[0], PT(fmX + 0.025, -BHW - 0.015)[1] + fmElev],
                [PT(fmX + 0.025, BHW + 0.015)[0], PT(fmX + 0.025, BHW + 0.015)[1] + fmElev],
                [PT(fmX - 0.025, BHW + 0.015)[0], PT(fmX - 0.025, BHW + 0.015)[1] + fmElev],
            ],
            BARR_H + 1 * sc,
            "#686868",
            "#3a3a3a",
        );

        const tPts = lift(
            [
                PT(TURR_CX - TRX, -TRY),
                PT(TURR_CX + TRX - 0.04, -TRY),
                PT(TURR_CX + TRX, -TRY + 0.04),
                PT(TURR_CX + TRX, TRY - 0.04),
                PT(TURR_CX + TRX - 0.04, TRY),
                PT(TURR_CX - TRX, TRY),
            ],
            turrTop,
        );
        slab(tPts, TURR_H, mix(teamRGB, olive, 0.3), hullDark);
        outline(tPts, hullDark, 0.7);
        for (const side of [-1, 1]) {
            const pY = TRY * side;
            fill(
                lift(
                    [
                        PT(TURR_CX - TRX + 0.04, pY - 0.03 * side),
                        PT(TURR_CX + TRX - 0.06, pY - 0.03 * side),
                        PT(TURR_CX + TRX - 0.06, pY),
                        PT(TURR_CX - TRX + 0.04, pY),
                    ],
                    turrTop,
                ),
                hullDark,
            );
        }
        slab(
            lift(
                [
                    PT(TURR_CX - TRX - 0.08, -TRY + 0.02),
                    PT(TURR_CX - TRX, -TRY + 0.02),
                    PT(TURR_CX - TRX, TRY - 0.02),
                    PT(TURR_CX - TRX - 0.08, TRY - 0.02),
                ],
                turrTop,
            ),
            TURR_H - 1 * sc,
            "#5a6340",
            hullDark,
        );
        const cupR = 0.055,
            cupCX = TURR_CX - 0.06,
            cupCY = -TRY * 0.35;
        const cupPts = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            cupPts.push(lift([PT(cupCX + Math.cos(a) * cupR, cupCY + Math.sin(a) * cupR)], turrTop - 3 * sc)[0]);
        }
        slab(cupPts, 3 * sc, hullAccent, hullDark);
        fill(
            lift(
                [
                    PT(cupCX + cupR * 0.6, cupCY - 0.015),
                    PT(cupCX + cupR * 0.6 + 0.025, cupCY - 0.015),
                    PT(cupCX + cupR * 0.6 + 0.025, cupCY + 0.015),
                    PT(cupCX + cupR * 0.6, cupCY + 0.015),
                ],
                turrTop - 4 * sc,
            ),
            "#224",
        );
        ctx.strokeStyle = "#1a1a22";
        ctx.lineWidth = 2 * sc;
        const vs1 = lift([PT(TURR_CX + TRX - 0.02, -TRY * 0.35)], turrTop)[0];
        const vs2 = lift([PT(TURR_CX + TRX - 0.02, TRY * 0.35)], turrTop)[0];
        ctx.beginPath();
        ctx.moveTo(vs1[0], vs1[1]);
        ctx.lineTo(vs2[0], vs2[1]);
        ctx.stroke();
        const antBase = lift([PT(TURR_CX - TRX + 0.03, -TRY + 0.03)], turrTop)[0];
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(antBase[0], antBase[1]);
        ctx.lineTo(antBase[0] + 1, antBase[1] - 14 * sc);
        ctx.stroke();
        ctx.fillStyle = "#888";
        ctx.beginPath();
        ctx.arc(antBase[0] + 1, antBase[1] - 14 * sc, 1, 0, Math.PI * 2);
        ctx.fill();
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
