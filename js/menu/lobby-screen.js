/**
 * Lobby screen: the console-style match setup (join, teams, options,
 * start) and its rendering.
 */

import { ACTIONS, GAME_TYPE_ORDER, GAME_TYPES, MAP_SIZES, MAX_PLAYERS, PLAYER_COLORS } from "../config.js";
import { roundedRect } from "../render/canvas-utils.js";
import { cursorBar, drawGrid } from "./background.js";
import { anyPressed, joinCandidates } from "./input.js";

export const lobbyScreen = {
    update(menu, input, audio) {
        // ── Joins (any unjoined device pressing confirm) ──
        for (const device of joinCandidates(input, menu.lobby)) {
            if (menu.lobby.players.length < MAX_PLAYERS) {
                menu.lobby.join(device);
                if (audio) {
                    audio.init();
                    audio.play("confirm");
                }
            }
        }

        const host = menu.lobby.host;

        // ── Non-host players: switch team / leave ──
        for (const p of menu.lobby.players) {
            if (p === host) continue;
            if (
                p.device.wasPressed(ACTIONS.cycleTeam) ||
                p.device.wasPressed(ACTIONS.left) ||
                p.device.wasPressed(ACTIONS.right)
            ) {
                menu.lobby.cycleTeam(p);
                if (audio) {
                    audio.init();
                    audio.play("select");
                }
            }
            if (p.device.wasPressed(ACTIONS.back)) menu.lobby.leave(p);
        }

        // ── Host: settings cursor, team, start, leave ──
        if (host) {
            const d = host.device;
            if (d.wasPressed(ACTIONS.cycleTeam)) menu.lobby.cycleTeam(host);

            const rows = menu.lobby.rows();
            if (d.wasPressed(ACTIONS.up)) {
                menu.lobby.cursor = (menu.lobby.cursor - 1 + rows.length) % rows.length;
                if (audio) {
                    audio.init();
                    audio.play("select");
                }
            }
            if (d.wasPressed(ACTIONS.down)) {
                menu.lobby.cursor = (menu.lobby.cursor + 1) % rows.length;
                if (audio) {
                    audio.init();
                    audio.play("select");
                }
            }
            if (d.wasPressed(ACTIONS.left) || d.wasPressed(ACTIONS.right)) {
                menu.lobby.changeRow(rows[menu.lobby.cursor], d.wasPressed(ACTIONS.right));
                if (audio) {
                    audio.init();
                    audio.play("select");
                }
            }
            if (d.wasPressed(ACTIONS.confirm)) menu.startMatch();
            if (d.wasPressed(ACTIONS.back)) {
                menu.lobby.leave(host);
                if (menu.lobby.players.length === 0) menu.show("main");
            }
        } else if (anyPressed(input, ACTIONS.back)) {
            menu.show("main");
        }
    },

    render(menu, ctx, canvas) {
        const W = canvas.width,
            H = canvas.height;
        const cx = W / 2;
        const t = menu._time;
        const lobby = menu.lobby;
        const rows = lobby.rows();

        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
        drawGrid(ctx, W, H, t);
        ctx.textAlign = "center";

        // ── Header ──
        ctx.font = 'bold 30px "Courier New", monospace';
        ctx.fillStyle = "#777";
        ctx.fillText("MATCH  SETUP", cx, 44);
        ctx.font = '13px "Courier New", monospace';
        ctx.fillStyle = "#555";
        ctx.fillText(GAME_TYPES[lobby.gameType].desc, cx, 66);

        // Detection diagnostic: if this shows 1 while two pads are plugged
        // in, the OS/launcher (e.g. Steam Input) is merging them.
        ctx.textAlign = "right";
        ctx.fillStyle = menu.gamepadCount >= menu.lobby.players.length ? "#4a4" : "#a54";
        ctx.fillText(`${menu.gamepadCount} CONTROLLER${menu.gamepadCount === 1 ? "" : "S"}`, W - 24, 30);
        ctx.textAlign = "center";

        // Game type toggle (cursor row 0)
        const gtY = 92;
        if (lobby.cursor === 0) cursorBar(ctx, cx - 200, gtY - 20, 400, 32, t);
        ctx.font = 'bold 22px "Courier New", monospace';
        for (const [i, type] of GAME_TYPE_ORDER.entries()) {
            const x = cx + (i === 0 ? -90 : 90);
            ctx.fillStyle = lobby.gameType === type ? "#fff" : "#555";
            ctx.fillText(GAME_TYPES[type].label, x, gtY + 3);
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
            const p = lobby.players[i];
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
            if (i === lobby.cursor) cursorBar(ctx, cx - 220, y - 8, 440, 30, t);

            let label;
            let value = "";
            if (row.type === "gameType") {
                label = "GAME TYPE";
                value = GAME_TYPES[lobby.gameType].label;
            } else if (row.type === "start") {
                label = "";
                value = "START";
            } else {
                label = "MAP SIZE";
                value = MAP_SIZES[lobby.mapSizeIndex].label;
            }

            ctx.textAlign = "left";
            ctx.font = 'bold 15px "Courier New", monospace';
            ctx.fillStyle = i === lobby.cursor ? "#ccc" : "#666";
            ctx.fillText(label, cx - 200, y + 12);
            ctx.textAlign = "right";
            ctx.font = 'bold 15px "Courier New", monospace';
            ctx.fillStyle = i === lobby.cursor ? "#fff" : "#999";
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
    },
};
