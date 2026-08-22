/**
 * Per-viewport HUD overlays.
 *
 * `drawScoreHUD` is for score-race modes (Skirmish): a faction score pill
 * plus the win target.  `drawBattleHUD` is for base modes (Battle): HQ
 * health bars, the focus tank's type/charge state, the allied bot roster,
 * and both call the minimap.
 */

import { CONFIG, VEHICLES } from "../config.js";
import { distance } from "../utils.js";
import { roundedRect } from "./canvas-utils.js";
import { drawMinimap } from "./minimap.js";

/**
 * Score-based HUD for non-base modes.
 * Shows both teams' scores, controls hint, minimap.
 */
export function drawScoreHUD(ctx, game, _humanIndex, vx, vy, vw, vh, focusTank) {
    ctx.save();
    ctx.textAlign = "center";
    const cx = vx + vw / 2;

    // Background pill
    const factions = game.factions;
    const pillW = Math.min(vw - 24, 70 + factions.length * 95);
    const pillH = 36;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundedRect(ctx, cx - pillW / 2, vy + 10, pillW, pillH, 8);
    ctx.fill();

    // Faction scores (one chip per faction, coloured by team/player)
    ctx.font = 'bold 18px "Courier New", monospace';
    const innerW = pillW - 24;
    for (let i = 0; i < factions.length; i++) {
        const f = factions[i];
        const score = game.scores.get(f.id) ?? 0;
        const label = game.factionLabel(f.id);
        const x = cx + (i - (factions.length - 1) / 2) * (innerW / Math.max(1, factions.length - 1));
        ctx.fillStyle = f.color;
        ctx.fillText(`${label} ${score}`, x, vy + 35);
    }

    // Win target
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = "#666";
    ctx.fillText(`first to ${CONFIG.WIN_SCORE}`, cx, vy + 50);

    // Respawn message
    if (!focusTank.alive) {
        ctx.font = 'bold 18px "Courier New", monospace';
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText("RESPAWNING...", cx, vy + vh / 2);
    }

    // Minimap
    drawMinimap(ctx, game, focusTank.team, vx, vy, vw, vh);

    ctx.restore();
}

/**
 * Battle HUD for base modes.
 * Shows HQ HP, vehicle type, charge/reload indicators, bot roster, minimap.
 */
export function drawBattleHUD(ctx, game, _humanIndex, vx, vy, vw, vh, focusTank) {
    const cw = vw,
        ch = vh;
    ctx.save();
    ctx.textAlign = "center";
    const cx = vx + cw / 2;

    // HQ HP for both teams
    const barW = 150,
        barH = 14,
        gap = 20;
    for (let i = 0; i < game.bases.length; i++) {
        const base = game.bases[i];
        const hq = base.hq;
        const x = i === 0 ? cx - barW - gap : cx + gap;
        const y = vy + 14;
        const frac = hq?.alive ? hq.hp / hq.maxHp : 0;
        const label = base.team === 1 ? "RED HQ" : "BLUE HQ";

        // Background
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x - 2, y - 2, barW + 4, barH + 18);

        // Label
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.fillStyle = base.color;
        ctx.textAlign = i === 0 ? "right" : "left";
        ctx.fillText(label, i === 0 ? x + barW : x, y + 10);

        // Bar
        const barY = y + 14;
        ctx.fillStyle = "#222";
        ctx.fillRect(x, barY, barW, barH);
        ctx.fillStyle = frac > 0.5 ? base.color : frac > 0.25 ? "#da4" : "#d44";
        ctx.fillRect(x, barY, barW * frac, barH);
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, barY, barW, barH);

        // HP text
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.ceil(hq?.hp ?? 0)}/${hq?.maxHp ?? 0}`, x + barW / 2, barY + 11);
    }

    // "VS" divider
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.fillStyle = "#555";
    ctx.textAlign = "center";
    ctx.fillText("VS", cx, vy + 36);

    // Vehicle type indicator
    if (focusTank.alive) {
        const vStats = VEHICLES[focusTank.vehicleType];
        const vType = `${vStats?.hudGlyph ?? "\u25C6"} ${focusTank.vehicleType.toUpperCase()}`;
        ctx.font = 'bold 13px "Courier New", monospace';
        ctx.fillStyle = focusTank.color;
        ctx.textAlign = "center";
        ctx.fillText(vType, cx, vy + ch - 20);

        // Infantry squad: member count + dig-in status
        if (focusTank.membersAlive > 0) {
            const n = focusTank.membersAlive;
            const state = focusTank.squad?.digIn?.state ?? "roaming";
            const label =
                state === "dugIn"
                    ? `DUG IN \u2022 ${n}/5`
                    : state === "diggingIn"
                      ? `DIGGING IN\u2026 \u2022 ${n}/5`
                      : `${n}/5 \u2022 FIRE to dig in`;
            ctx.font = 'bold 10px "Courier New", monospace';
            ctx.fillStyle = state === "dugIn" ? "#ffcc44" : state === "diggingIn" ? "#ffaa22" : "#999";
            ctx.textAlign = "center";
            ctx.fillText(label, cx, vy + ch - 34);
        }

        // Explosive vehicle: proximity damage indicator (drone's blast).
        const blastRadius = vStats?.blastRadius;
        if (blastRadius) {
            let bestDmg = 0;
            for (const t of game.allTanks) {
                if (!t.alive || t.team === focusTank.team) continue;
                const d = distance(focusTank.x, focusTank.y, t.x, t.y);
                const dmg = Math.max(0, 1 - d / blastRadius);
                if (dmg > bestDmg) bestDmg = dmg;
            }
            for (const s of game.baseStructures) {
                if (!s.alive || s.team === focusTank.team) continue;
                const d = distance(focusTank.x, focusTank.y, s.x, s.y);
                const edgeDist = Math.max(0, d - s.size);
                const dmg = Math.max(0, 1 - edgeDist / blastRadius);
                if (dmg > bestDmg) bestDmg = dmg;
            }

            if (bestDmg > 0) {
                const pct = Math.round(bestDmg * 100);
                const barW = 80,
                    barH = 8;
                const barX = cx - barW / 2,
                    barY = vy + ch - 38;
                ctx.fillStyle = "rgba(0,0,0,0.5)";
                ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
                const col = bestDmg > 0.7 ? "#ff4444" : bestDmg > 0.4 ? "#ffaa22" : "#888";
                ctx.fillStyle = col;
                ctx.fillRect(barX, barY, barW * bestDmg, barH);
                ctx.font = 'bold 9px "Courier New", monospace';
                ctx.fillStyle = "#fff";
                ctx.fillText(`DMG ${pct}%`, cx, barY + 7);
            } else {
                ctx.font = '10px "Courier New", monospace';
                ctx.fillStyle = "#666";
                ctx.fillText("FIRE to detonate", cx, vy + ch - 34);
            }
        }
    }

    // Chargeable-vehicle HUD: charge bar / reload / hold-to-charge hint.
    if (focusTank.chargeable) {
        if (focusTank.isCharging) {
            const vStats = VEHICLES[focusTank.vehicleType];
            const range = Math.min(vStats.minRange + focusTank.chargeTime * vStats.chargeRate, vStats.maxRange);
            const frac = (range - vStats.minRange) / (vStats.maxRange - vStats.minRange);
            const barW = 100,
                barH = 8;
            const barX = cx - barW / 2,
                barY = vy + ch - 40;
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
            const col = frac > 0.9 ? "#ff4444" : frac > 0.5 ? "#ffaa22" : "#ff8800";
            ctx.fillStyle = col;
            ctx.fillRect(barX, barY, barW * frac, barH);
            ctx.font = 'bold 9px "Courier New", monospace';
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.fillText(`RNG ${range.toFixed(0)}`, cx, barY + 7);
        } else if (focusTank.fireCooldown > 0) {
            ctx.font = '10px "Courier New", monospace';
            ctx.fillStyle = "#666";
            ctx.textAlign = "center";
            ctx.fillText(`RELOAD ${focusTank.fireCooldown.toFixed(1)}s`, cx, vy + ch - 34);
        } else {
            ctx.font = '10px "Courier New", monospace';
            ctx.fillStyle = "#888";
            ctx.textAlign = "center";
            ctx.fillText("HOLD FIRE to charge range", cx, vy + ch - 34);
        }
    }

    // Allied bot role roster (bottom-left)
    const roleNames = { cavalry: "CAV", sniper: "SNP", defender: "DEF", scout: "SCT" };
    const roleColors = { cavalry: "#e55", sniper: "#5ae", defender: "#5c5", scout: "#da5" };
    const allyBots = (game.bots ?? []).filter((b) => b.tank.team === focusTank.team);
    ctx.textAlign = "left";
    ctx.font = 'bold 10px "Courier New", monospace';
    const rx = vx + 12,
        ry = vy + ch - 14 - allyBots.length * 13;
    for (let i = 0; i < allyBots.length; i++) {
        const b = allyBots[i];
        const role = b.role || "???";
        const name = roleNames[role] || "???";
        const alive = b.tank.alive;
        ctx.fillStyle = alive ? roleColors[role] || "#aaa" : "#555";
        ctx.fillText(`\u2022 ${name}`, rx, ry + i * 13);
        if (!alive) {
            ctx.fillStyle = "#777";
            ctx.fillText(" \u2620", rx + 30, ry + i * 13);
        }
    }

    // Respawn message
    if (!focusTank.alive) {
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText("RESPAWNING...", cx, vy + ch / 2);
    }

    // Minimap
    drawMinimap(ctx, game, focusTank.team, vx, vy, vw, vh);

    ctx.restore();
}
