/**
 * Isometric pixel-art renderer.
 *
 * Draws one or two viewports depending on game mode.
 * Split-screen modes show two side-by-side viewports.  Rendering is depth-sorted so elevated terrain
 * correctly occludes entities behind it.
 */

import { CONFIG, TILES as T, VEHICLES, BASE_STRUCTURES } from "./config.js";
import { clamp, distance, worldToScreen } from "./utils.js";

const TW = CONFIG.TILE_WIDTH;
const TH = CONFIG.TILE_HEIGHT;

/* ── Colour palette ───────────────────────────────────────── */

const PALETTE = {
    deepWater: { r: 22, g: 50, b: 82 },
    shallowWater: { r: 38, g: 82, b: 128 },
    sand: { r: 210, g: 185, b: 150 },
    grass: { r: 72, g: 124, b: 60 },
    darkGrass: { r: 55, g: 100, b: 42 },
    dirt: { r: 155, g: 130, b: 95 },
    paved: { r: 140, g: 138, b: 130 },
    hillTop: { r: 140, g: 115, b: 80 },
    hillLeft: { r: 105, g: 82, b: 55 },
    hillRight: { r: 125, g: 100, b: 68 },
    rockTop: { r: 130, g: 130, b: 130 },
    rockLeft: { r: 90, g: 90, b: 90 },
    rockRight: { r: 110, g: 110, b: 110 },
    // Buildings — each has wall, roof, and trim colours
    bldgSmall: { wall: { r: 180, g: 165, b: 140 }, roof: { r: 160, g: 75, b: 55 }, trim: { r: 120, g: 110, b: 95 } },
    bldgMedium: { wall: { r: 195, g: 185, b: 170 }, roof: { r: 80, g: 110, b: 150 }, trim: { r: 140, g: 130, b: 115 } },
    bldgLarge: { wall: { r: 170, g: 165, b: 160 }, roof: { r: 55, g: 65, b: 80 }, trim: { r: 110, g: 105, b: 100 } },
};

function rgb(r, g, b) {
    return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/* ================================================================== */

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.resize();
        window.addEventListener("resize", () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.vpW = Math.floor(this.canvas.width / 2);
        this.vpH = this.canvas.height;
    }

    /* ── public entry point ───────────────────────────────── */

    render(game) {
        const ctx = this.ctx;
        const cw = this.canvas.width,
            ch = this.canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        if (game.splitScreen) {
            // ── Split screen ──
            const h0 = game.humanTanks[0],
                h1 = game.humanTanks[1];
            const c0 = game.cameras[0],
                c1 = game.cameras[1];
            this._renderViewport(ctx, game, h0, c0, 0, 0, this.vpW, this.vpH);
            this._renderViewport(ctx, game, h1, c1, this.vpW, 0, this.vpW, this.vpH);
            ctx.save();
            ctx.strokeStyle = "#556";
            ctx.lineWidth = 3;
            ctx.shadowColor = "#000";
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(this.vpW, 0);
            ctx.lineTo(this.vpW, ch);
            ctx.stroke();
            ctx.restore();
            if (game.modeDef.bases) {
                this._drawBattleHUD(ctx, game, 0, 0, 0, this.vpW, this.vpH, h0);
                this._drawBattleHUD(ctx, game, 1, this.vpW, 0, this.vpW, this.vpH, h1);
            } else {
                this._drawScoreHUD(ctx, game, 0, 0, 0, this.vpW, this.vpH, h0);
                this._drawScoreHUD(ctx, game, 1, this.vpW, 0, this.vpW, this.vpH, h1);
            }
        } else {
            // ── Full screen ──
            const h0 = game.humanTanks[0],
                c0 = game.cameras[0];
            this._renderViewport(ctx, game, h0, c0, 0, 0, cw, ch);
            if (game.modeDef.bases) this._drawBattleHUD(ctx, game, 0, 0, 0, cw, ch, h0);
            else this._drawScoreHUD(ctx, game, 0, 0, 0, cw, ch, h0);
        }

        if (game.gameOver) this._drawGameOver(ctx, game);
    }

    /* ── viewport rendering ───────────────────────────────── */

    _renderViewport(ctx, game, _tank, camera, vx, vy, vw, vh) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx, vy, vw, vh);
        ctx.clip();

        // Fill background (deep water colour so edges look natural)
        ctx.fillStyle = rgb(PALETTE.deepWater.r - 6, PALETTE.deepWater.g - 6, PALETTE.deepWater.b - 6);
        ctx.fillRect(vx, vy, vw, vh);

        // Camera transform: centre of viewport tracks camera position
        const ox = vx + vw / 2 - camera.x;
        const oy = vy + vh / 2 - camera.y;
        ctx.translate(ox, oy);

        // Determine visible area in screen-space
        const visLeft = camera.x - vw / 2 - TW * 2;
        const visRight = camera.x + vw / 2 + TW * 2;
        const visTop = camera.y - vh / 2 - TH * 4;
        const visBottom = camera.y + vh / 2 + TH * 4;

        // ── PASS 1: flat ground tiles ──
        // Flat tiles (water, sand, grass) can never occlude entities,
        // so we draw them all first.  Adjacent flat diamonds share
        // exact edges, so iteration order doesn't matter.
        const map = game.map;

        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const tile = map.getTile(gx, gy);
                if (map.tileHeight(tile) > 0) continue; // elevated → pass 2

                const scr = worldToScreen(gx, gy);
                if (scr.x < visLeft || scr.x > visRight || scr.y < visTop || scr.y > visBottom) continue;

                this._drawTile(ctx, { gx, gy, tile, sx: scr.x, sy: scr.y }, game.gameTime, map);
            }
        }

        // ── PASS 2: elevated tiles + entities, depth-sorted ──
        // Only hills/rocks can visually occlude entities, so they
        // share depth buckets with tanks, bullets, and particles.
        const maxSum = map.width + map.height;
        const buckets = new Array(maxSum + 2);
        for (let i = 0; i < buckets.length; i++) buckets[i] = null;

        const addToBucket = (depth, item) => {
            const d = clamp(Math.floor(depth), 0, maxSum);
            if (!buckets[d]) buckets[d] = [];
            buckets[d].push(item);
        };

        // Elevated tiles – use depth gx+gy+1 (tile centre) so
        // their side faces correctly occlude entities behind them.
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const tile = map.getTile(gx, gy);
                if (map.tileHeight(tile) === 0) continue; // already drawn

                const scr = worldToScreen(gx, gy);
                if (scr.x < visLeft || scr.x > visRight || scr.y < visTop || scr.y > visBottom) continue;

                addToBucket(gx + gy + 1, {
                    kind: 0,
                    gx,
                    gy,
                    tile,
                    sx: scr.x,
                    sy: scr.y,
                });
            }
        }

        // Entities (tanks, bullets, particles)
        const addEntity = (kind, entity, wx, wy, depthBonus = 0) => {
            const scr = worldToScreen(wx, wy);
            if (scr.x < visLeft - 40 || scr.x > visRight + 40 || scr.y < visTop - 40 || scr.y > visBottom + 40) return;
            addToBucket(wx + wy + depthBonus, { kind, entity, sx: scr.x, sy: scr.y });
        };

        for (const t of game.allTanks) {
            if (t.alive || t.respawnTimer > 0) {
                // Drones fly above buildings — render them later (higher depth)
                const depthBonus = t.vehicleType === "drone" ? 2 : 0;
                addEntity(1, t, t.x, t.y, depthBonus);
            }
        }
        for (const s of game.baseStructures) {
            if (s.alive) addEntity(4, s, s.x, s.y);
        }
        for (const b of game.bullets) {
            if (b.alive) addEntity(2, b, b.x, b.y);
        }
        for (const p of game.particles.particles) {
            addEntity(3, p, p.x, p.y);
        }

        // Render back-to-front (save/restore prevents canvas state leaks
        // between entity draws — a stale globalAlpha could hide everything)
        for (let d = 0; d < buckets.length; d++) {
            const bucket = buckets[d];
            if (!bucket) continue;
            for (const item of bucket) {
                ctx.save();
                switch (item.kind) {
                    case 0:
                        this._drawTile(ctx, item, game.gameTime, map);
                        break;
                    case 1:
                        this._drawVehicle(ctx, item.entity, item.sx, item.sy);
                        break;
                    case 2:
                        this._drawBullet(ctx, item.entity, item.sx, item.sy, game.gameTime);
                        break;
                    case 3:
                        this._drawParticle(ctx, item.entity, item.sx, item.sy);
                        break;
                    case 4:
                        this._drawBaseStructure(ctx, item.entity, item.sx, item.sy, game.gameTime);
                        break;
                }
                ctx.restore();
            }
        }

        // ── SPG targeting indicator (drawn in camera space) ──
        if (_tank.alive && _tank.vehicleType === "spg" && _tank.isCharging) {
            const vStats = VEHICLES.spg;
            const range = Math.min(vStats.minRange + _tank.chargeTime * vStats.chargeRate, vStats.maxRange);
            const tAngle = _tank.turretWorld;
            const targetWX = _tank.x + Math.cos(tAngle) * range;
            const targetWY = _tank.y + Math.sin(tAngle) * range;
            const tScr = worldToScreen(targetWX, targetWY);
            this._drawTargetIndicator(ctx, tScr.x, tScr.y, range, vStats.maxRange, game.gameTime);
        }

        ctx.restore();
    }

    /* ── tile drawing ─────────────────────────────────────── */

    _drawTile(ctx, { gx, gy, tile, sx, sy }, time, map) {
        // Colour variation per tile based on position
        const v = ((gx * 7 + gy * 13) % 5) - 2; // −2 … +2

        switch (tile) {
            case T.DEEP_WATER:
            case T.SHALLOW_WATER: {
                const base = tile === T.DEEP_WATER ? PALETTE.deepWater : PALETTE.shallowWater;
                const wave = Math.sin(time * 1.8 + gx * 1.3 + gy * 0.9) * 0.5 + 0.5;
                const r = base.r + v * 2 + wave * 12;
                const g = base.g + v * 2 + wave * 16;
                const b = base.b + v * 2 + wave * 22;
                this._diamond(ctx, sx, sy, rgb(r, g, b));
                // subtle wave highlight
                if (wave > 0.7) {
                    ctx.globalAlpha = (wave - 0.7) * 1.5;
                    this._diamond(ctx, sx, sy, "rgba(180,210,240,0.15)");
                    ctx.globalAlpha = 1;
                }
                break;
            }

            case T.SAND: {
                const c = PALETTE.sand;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
                break;
            }

            case T.DIRT: {
                const c = PALETTE.dirt;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
                break;
            }

            case T.PAVED: {
                const c = PALETTE.paved;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 2, c.g + v * 2, c.b + v * 2));
                break;
            }

            case T.GRASS: {
                const c = PALETTE.grass;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 4, c.g + v * 4, c.b + v * 3));
                break;
            }

            case T.DARK_GRASS: {
                const c = PALETTE.darkGrass;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
                break;
            }

            case T.HILL: {
                const frac = map.getDamageFraction(gx, gy);
                const h = Math.round(map.tileHeight(T.HILL) * frac);
                this._elevatedTile(ctx, sx, sy, h, PALETTE.hillTop, PALETTE.hillLeft, PALETTE.hillRight, v);
                if (frac < 1) this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
                break;
            }

            case T.ROCK: {
                const frac = map.getDamageFraction(gx, gy);
                const h = Math.round(map.tileHeight(T.ROCK) * frac);
                this._elevatedTile(ctx, sx, sy, h, PALETTE.rockTop, PALETTE.rockLeft, PALETTE.rockRight, v);
                if (frac < 1) this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
                break;
            }

            case T.BLDG_SMALL:
            case T.BLDG_MEDIUM:
            case T.BLDG_LARGE: {
                const frac = map.getDamageFraction(gx, gy);
                this._drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time);
                break;
            }
        }
    }

    /** Draw a flat isometric diamond (top face of a ground-level tile). */
    _diamond(ctx, sx, sy, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.lineTo(sx, sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();
    }

    /** Draw an elevated tile (top face + two visible side faces). */
    _elevatedTile(ctx, sx, sy, h, topC, leftC, rightC, v) {
        // Left (SW) side
        ctx.fillStyle = rgb(leftC.r + v * 2, leftC.g + v * 2, leftC.b + v * 2);
        ctx.beginPath();
        ctx.moveTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx, sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // Right (SE) side
        ctx.fillStyle = rgb(rightC.r + v * 2, rightC.g + v * 2, rightC.b + v * 2);
        ctx.beginPath();
        ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx, sy + TH);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // Top face
        ctx.fillStyle = rgb(topC.r + v * 3, topC.g + v * 3, topC.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx, sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Overlay cracks and darkening on a damaged elevated tile.
     * `frac` = 1 (undamaged) → 0 (about to break).
     */
    _drawDamageOverlay(ctx, sx, sy, h, frac, time) {
        const dmg = 1 - frac; // 0 = no damage, 1 = nearly dead

        // Darken the top face proportionally to damage
        ctx.globalAlpha = dmg * 0.45;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.moveTo(sx, sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;

        // Crack lines – more cracks at higher damage
        const crackCount = Math.ceil(dmg * 5);
        ctx.strokeStyle = `rgba(0,0,0,${0.3 + dmg * 0.4})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Seed cracks deterministically from tile position
        const seedX = sx * 7 + sy * 13;
        for (let i = 0; i < crackCount; i++) {
            // Pseudo-random offsets within the top diamond
            const a = Math.sin(seedX + i * 37.7) * 0.35;
            const b = Math.cos(seedX + i * 53.3) * 0.35;
            const cx1 = sx + a * TW * 0.4;
            const cy1 = sy - h + TH / 2 + b * TH * 0.4;
            const a2 = Math.sin(seedX + i * 71.1) * 0.35;
            const b2 = Math.cos(seedX + i * 91.9) * 0.35;
            const cx2 = sx + a2 * TW * 0.4;
            const cy2 = sy - h + TH / 2 + b2 * TH * 0.4;
            ctx.moveTo(cx1, cy1);
            ctx.lineTo(cx2, cy2);
        }
        ctx.stroke();

        // Flash white briefly when at critical damage
        if (frac <= 0.34 && Math.sin(time * 10) > 0.5) {
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = "#ff4400";
            ctx.beginPath();
            ctx.moveTo(sx, sy - h);
            ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
            ctx.lineTo(sx, sy + TH - h);
            ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    /* ── building drawing ─────────────────────────────────── */

    /**
     * Draw an isometric building with walls, roof, and details.
     * Height shrinks with damage just like terrain.
     */
    _drawBuilding(ctx, sx, sy, tile, frac, gx, gy, time) {
        const pal =
            tile === T.BLDG_SMALL ? PALETTE.bldgSmall : tile === T.BLDG_MEDIUM ? PALETTE.bldgMedium : PALETTE.bldgLarge;

        const fullH = tile === T.BLDG_SMALL ? 14 : tile === T.BLDG_MEDIUM ? 22 : 32;
        const h = Math.max(2, Math.round(fullH * frac));
        const v = ((gx * 7 + gy * 13) % 3) - 1;

        const w = pal.wall,
            rf = pal.roof,
            tr = pal.trim;

        // ── Left (SW) wall ──
        ctx.fillStyle = rgb(tr.r + v * 3, tr.g + v * 3, tr.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx, sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // ── Right (SE) wall ──
        ctx.fillStyle = rgb(w.r + v * 3, w.g + v * 3, w.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx, sy + TH);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // ── Roof (top face) ──
        ctx.fillStyle = rgb(rf.r + v * 4, rf.g + v * 4, rf.b + v * 4);
        ctx.beginPath();
        ctx.moveTo(sx, sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx, sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();

        // ── Roof ridge line (gives depth) ──
        ctx.strokeStyle = rgb(rf.r - 20, rf.g - 20, rf.b - 20);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - TW * 0.2, sy + TH / 2 - h);
        ctx.lineTo(sx + TW * 0.2, sy + TH / 2 - h);
        ctx.stroke();

        // ── Window on right wall (if tall enough) ──
        if (h >= 14) {
            const winW = TW * 0.12,
                winH = h * 0.25;
            const winX = sx + TW * 0.15;
            const winY = sy + TH * 0.25 - h * 0.2;
            ctx.fillStyle = "#3a4a5a";
            ctx.fillRect(winX, winY, winW, winH);
            // Window frame
            ctx.strokeStyle = rgb(tr.r, tr.g, tr.b);
            ctx.lineWidth = 0.5;
            ctx.strokeRect(winX, winY, winW, winH);
        }

        // ── Second window (medium + large) ──
        if (h >= 20) {
            const winW = TW * 0.1,
                winH = h * 0.2;
            const winX = sx + TW * 0.02;
            const winY = sy + TH * 0.4 - h * 0.15;
            ctx.fillStyle = "#3a4a5a";
            ctx.fillRect(winX, winY, winW, winH);
            ctx.strokeStyle = rgb(tr.r, tr.g, tr.b);
            ctx.lineWidth = 0.5;
            ctx.strokeRect(winX, winY, winW, winH);
        }

        // ── Door on left wall ──
        if (h >= 10) {
            const doorW = TW * 0.08,
                doorH = Math.min(h * 0.45, 10);
            const doorX = sx - TW * 0.22;
            const doorY = sy + TH / 2 - doorH;
            ctx.fillStyle = "#5a3a22";
            ctx.fillRect(doorX, doorY, doorW, doorH);
        }

        // ── Chimney (large buildings only) ──
        if (tile === T.BLDG_LARGE && frac > 0.5) {
            const chX = sx + TW * 0.12;
            const chY = sy - h - 6;
            ctx.fillStyle = rgb(tr.r - 10, tr.g - 10, tr.b - 10);
            ctx.fillRect(chX, chY, 4, 8);
            // Chimney top
            ctx.fillStyle = rgb(tr.r + 5, tr.g + 5, tr.b + 5);
            ctx.fillRect(chX - 1, chY, 6, 2);
        }

        // ── Damage overlay ──
        if (frac < 1) {
            this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
        }
    }

    /* ── vehicle drawing (dispatch) ───────────────────────── */

    _drawVehicle(ctx, tank, sx, sy) {
        if (tank.vehicleType === "drone") {
            this._drawDrone(ctx, tank, sx, sy);
        } else if (tank.vehicleType === "ifv") {
            this._drawIFV(ctx, tank, sx, sy);
        } else if (tank.vehicleType === "spg") {
            this._drawSPG(ctx, tank, sx, sy);
        } else {
            this._drawTank(ctx, tank, sx, sy);
        }
    }

    /* ── tank drawing ─────────────────────────────────────── */

    /**
     * Draw a fully-rotated isometric tank with visible 3-D depth.
     *
     * Every shape is defined in **local space** (+x = forward, +y = right)
     * then rotated by the tank's angle and projected through the
     * isometric transform.  Vertical height is faked by drawing each
     * layer at a screen-Y offset so the tank looks stacked:
     *
     *   ground → tracks → hull → turret → barrel
     *
     * Each layer has a dark "side wall" drawn below its top face.
     *
     * The hull and tracks use the tank's hull angle, while the turret
     * and barrel use the world-space turretWorld (hull angle + turret offset).
     */
    _drawTank(ctx, tank, sx, sy) {
        if (!tank.alive) return;
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const ca = Math.cos(tank.angle),
            sa = Math.sin(tank.angle);
        const tWorld = tank.turretWorld;
        const ta = Math.cos(tWorld),
            tb = Math.sin(tWorld);
        const HTW = TW / 2,
            HTH = TH / 2;

        // Project local point → screen using hull angle.  lx = forward, ly = right.
        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };

        // Project local point → screen using turret angle.
        const PT = (lx, ly) => {
            const wx = lx * ta - ly * tb;
            const wy = lx * tb + ly * ta;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };

        // Fill polygon helper
        const fill = (pts, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };

        // Stroke polygon outline
        const outline = (pts, color, width) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };

        // Shift every point down by d pixels
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);

        // Draw a 3-D extruded slab: side wall of height h, then top face.
        // `wallColor` is for the visible side wall, `topColor` for the top.
        const slab = (topPts, h, topColor, wallColor) => {
            const bot = drop(topPts, h);
            // Draw side wall: connect each top edge to its corresponding
            // bottom edge, but only the segments whose normals face "down"
            // on screen (i.e. the viewer-facing sides).
            // Simplified: draw bottom then top is sufficient for convex shapes.
            fill(bot, wallColor);
            fill(topPts, topColor);
        };

        /* ── local-space dimensions (world units) ─────────
         *  Scaled up ~60 % from the previous version so the
         *  tank is clearly visible and has room for detail.  */
        const THL = 0.38; // track half-length
        const TYO = 0.3; // track outer Y
        const TYI = 0.21; // track inner Y
        const HR = -0.28; // hull rear X
        const HF = 0.24; // hull front X
        const HT = 0.34; // hull pointed tip X
        const HW = 0.2; // hull half-width Y
        const TR = 0.13; // turret radius
        const BHW = 0.03; // barrel half-width
        const BX0 = 0.1; // barrel start X
        let BX1 = 0.52; // barrel end X
        const TRACK_H = 4; // track extrusion height (px)
        const HULL_H = 7; // hull extrusion height (px)
        const TURR_H = 5; // turret extrusion height (px)
        const BARR_H = 3; // barrel extrusion height (px)

        if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.1;

        // ── Vertical offsets (cumulative, lower = further down screen) ──
        // We draw from ground up.  Each layer's "top" is shifted up by
        // the sum of all layers below it.
        const trackTop = -TRACK_H; // tracks sit on ground
        const hullTop = -(TRACK_H + HULL_H); // hull sits on tracks
        const turrTop = -(TRACK_H + HULL_H + TURR_H); // turret on hull
        const barrTop = -(TRACK_H + HULL_H + BARR_H); // barrel on hull

        // Apply a vertical offset to projected points
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

        /* ── 1. Shadow ──────────────────────────────────── */
        fill(
            drop(
                [
                    P(-THL - 0.04, -TYO - 0.02),
                    P(THL + 0.04, -TYO - 0.02),
                    P(THL + 0.04, TYO + 0.02),
                    P(-THL - 0.04, TYO + 0.02),
                ],
                6,
            ),
            "rgba(0,0,0,0.18)",
        );

        /* ── 2. Tracks (hull angle) ─────────────────────── */
        // Left track: red-brown if disabled, normal dark grey otherwise
        const lTrackColor = tank.leftTrackDisabled ? "#5a2a1a" : "#2a2a2a";
        const lTrackWall = tank.leftTrackDisabled ? "#3a1a0a" : "#111";
        const lTrackTop = lift([P(-THL, -TYO), P(THL, -TYO), P(THL, -TYI), P(-THL, -TYI)], trackTop);
        slab(lTrackTop, TRACK_H, lTrackColor, lTrackWall);

        // Right track
        const rTrackColor = tank.rightTrackDisabled ? "#5a2a1a" : "#2a2a2a";
        const rTrackWall = tank.rightTrackDisabled ? "#3a1a0a" : "#111";
        const rTrackTop = lift([P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)], trackTop);
        slab(rTrackTop, TRACK_H, rTrackColor, rTrackWall);

        // Tread marks (on the track top faces, scrolling)
        // Skip tread marks on disabled tracks (visually broken)
        const TREAD_N = 8;
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < TREAD_N; i++) {
            const t = (i / TREAD_N + tank.treadPhase) % 1;
            const lx = -THL + t * THL * 2;
            if (!tank.leftTrackDisabled) {
                const a1 = lift([P(lx, -TYO)], trackTop)[0];
                const a2 = lift([P(lx, -TYI)], trackTop)[0];
                ctx.moveTo(a1[0], a1[1]);
                ctx.lineTo(a2[0], a2[1]);
            }
            if (!tank.rightTrackDisabled) {
                const b1 = lift([P(lx, TYI)], trackTop)[0];
                const b2 = lift([P(lx, TYO)], trackTop)[0];
                ctx.moveTo(b1[0], b1[1]);
                ctx.lineTo(b2[0], b2[1]);
            }
        }
        ctx.stroke();

        // Damage cracks on disabled tracks
        if (tank.leftTrackDisabled) {
            ctx.strokeStyle = "#2a0a00";
            ctx.lineWidth = 1;
            const c1 = lift([P(-THL * 0.3, -(TYO + TYI) / 2)], trackTop)[0];
            const c2 = lift([P(THL * 0.3, -(TYO * 0.7 + TYI * 0.3))], trackTop)[0];
            ctx.beginPath();
            ctx.moveTo(c1[0], c1[1]);
            ctx.lineTo(c2[0], c2[1]);
            ctx.stroke();
        }
        if (tank.rightTrackDisabled) {
            ctx.strokeStyle = "#2a0a00";
            ctx.lineWidth = 1;
            const c1 = lift([P(-THL * 0.2, (TYO + TYI) / 2)], trackTop)[0];
            const c2 = lift([P(THL * 0.2, TYO * 0.7 + TYI * 0.3)], trackTop)[0];
            ctx.beginPath();
            ctx.moveTo(c1[0], c1[1]);
            ctx.lineTo(c2[0], c2[1]);
            ctx.stroke();
        }

        // Track wheel detail (small circles inside tracks)
        ctx.fillStyle = "#1a1a1a";
        for (let i = 0; i < 3; i++) {
            const lx = -THL * 0.6 + i * THL * 0.6;
            if (!tank.leftTrackDisabled) {
                const cL = lift([P(lx, -(TYO + TYI) / 2)], trackTop)[0];
                ctx.beginPath();
                ctx.arc(cL[0], cL[1], 2, 0, Math.PI * 2);
                ctx.fill();
            }
            if (!tank.rightTrackDisabled) {
                const cR = lift([P(lx, (TYO + TYI) / 2)], trackTop)[0];
                ctx.beginPath();
                ctx.arc(cR[0], cR[1], 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        /* ── 3. Hull (hull angle) ───────────────────────── */
        // Darken hull colour when damaged
        const hullColor = tank.damaged ? tank.darkColor : tank.color;
        const hullDark = tank.damaged ? "#1a1a1a" : tank.darkColor;
        const hullPts = lift([P(HR, -HW), P(HF, -HW), P(HT, 0), P(HF, HW), P(HR, HW)], hullTop);
        slab(hullPts, HULL_H, hullColor, hullDark);
        outline(hullPts, hullDark, 0.5);

        // Rear panel (darker accent)
        const rearW = HW - 0.03;
        fill(lift([P(HR, -rearW), P(HR + 0.05, -rearW), P(HR + 0.05, rearW), P(HR, rearW)], hullTop), hullDark);

        // Hull centre ridge
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 1;
        const rg1 = lift([P(HR + 0.08, 0)], hullTop)[0];
        const rg2 = lift([P(HF - 0.04, 0)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(rg1[0], rg1[1]);
        ctx.lineTo(rg2[0], rg2[1]);
        ctx.stroke();

        // Side panel lines (give hull more shape)
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 0.5;
        const sp1a = lift([P(HR + 0.04, -HW)], hullTop)[0];
        const sp1b = lift([P(HR + 0.04, HW)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(sp1a[0], sp1a[1]);
        ctx.lineTo(sp1b[0], sp1b[1]);
        ctx.stroke();

        /* ── 4. Barrel (turret angle) ───────────────────── */
        const barrColor = tank.turretDisabled ? "#444" : "#666";
        const barrDark = tank.turretDisabled ? "#222" : "#333";
        const barrPts = lift([PT(BX0, -BHW), PT(BX1, -BHW), PT(BX1, BHW), PT(BX0, BHW)], barrTop);
        slab(barrPts, BARR_H, barrColor, barrDark);

        // Muzzle brake (wider tip)
        const MZ = 0.04;
        const muzzle = lift(
            [
                PT(BX1 - MZ, -BHW - 0.015),
                PT(BX1 + 0.01, -BHW - 0.015),
                PT(BX1 + 0.01, BHW + 0.015),
                PT(BX1 - MZ, BHW + 0.015),
            ],
            barrTop,
        );
        slab(muzzle, BARR_H, tank.turretDisabled ? "#555" : "#777", tank.turretDisabled ? "#333" : "#444");

        /* ── 5. Turret (turret angle) ───────────────────── */
        const turretColor = tank.turretDisabled ? "#555" : tank.color;
        const turretDark = tank.turretDisabled ? "#333" : tank.darkColor;
        const tPts = [],
            tHatch = [];
        const N = 10;
        for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2;
            tPts.push(lift([PT(Math.cos(a) * TR, Math.sin(a) * TR)], turrTop)[0]);
            tHatch.push(lift([PT(Math.cos(a) * TR * 0.35, Math.sin(a) * TR * 0.35)], turrTop)[0]);
        }
        slab(tPts, TURR_H, turretColor, turretDark);
        outline(tPts, turretDark, 0.5);

        // Commander hatch
        fill(tHatch, turretDark);

        // Hatch cross-hair (or X for disabled turret)
        if (tank.turretDisabled) {
            // Red X indicating locked turret
            ctx.strokeStyle = "#cc2222";
            ctx.lineWidth = 1.5;
            const x1 = lift([PT(-TR * 0.25, -TR * 0.25)], turrTop)[0];
            const x2 = lift([PT(TR * 0.25, TR * 0.25)], turrTop)[0];
            const x3 = lift([PT(-TR * 0.25, TR * 0.25)], turrTop)[0];
            const x4 = lift([PT(TR * 0.25, -TR * 0.25)], turrTop)[0];
            ctx.beginPath();
            ctx.moveTo(x1[0], x1[1]);
            ctx.lineTo(x2[0], x2[1]);
            ctx.moveTo(x3[0], x3[1]);
            ctx.lineTo(x4[0], x4[1]);
            ctx.stroke();
        } else {
            ctx.strokeStyle = tank.color;
            ctx.lineWidth = 0.5;
            const _hc = lift([PT(0, 0)], turrTop)[0];
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
    }

    /* ── IFV drawing ──────────────────────────────────── */

    /**
     * Draw a wheeled IFV (IFV).  Visually very different from tank:
     *   - Wide, flat-bodied APC shape (vs narrow pointed tank)
     *   - 4 large visible wheels per side (vs continuous tracks)
     *   - Olive/khaki hull tint overlaid on team colour
     *   - Small boxy fixed turret (vs circular rotating turret)
     *   - White chevron marking on hull top
     */
    _drawIFV(ctx, tank, sx, sy) {
        if (!tank.alive) return;
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const ca = Math.cos(tank.angle),
            sa = Math.sin(tank.angle);
        const HTW = TW / 2,
            HTH = TH / 2;

        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const fill = (pts, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const outline = (pts, color, width) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);
        const slab = (topPts, h, topColor, wallColor) => {
            fill(drop(topPts, h), wallColor);
            fill(topPts, topColor);
        };

        /* ── IFV is WIDER and FLATTER than a tank ───── */
        const SHL = 0.36; // hull half-length
        const SHW = 0.26; // hull half-width (MUCH wider than tank's 0.20)
        const SWO = 0.3; // wheel outer Y (beyond hull)
        const BHW = 0.02; // barrel half-width (thin autocannon)
        const BX0 = 0.05; // barrel start X
        let BX1 = 0.48; // barrel end X
        const MHW = 0.07; // turret mount half-width
        const MHL = 0.1; // turret mount half-length

        const WHEEL_H = 4;
        const HULL_H = 4; // flat (vs tank 7)
        const MOUNT_H = 3;
        const BARR_H = 2;

        if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.06;

        const wheelTop = -WHEEL_H;
        const hullTop = -(WHEEL_H + HULL_H);
        const mountTop = -(WHEEL_H + HULL_H + MOUNT_H);
        const barrTop = -(WHEEL_H + HULL_H + BARR_H);

        // Olive-tinted hull: mix team colour with khaki
        const hullColor = tank.color;
        const hullDark = tank.darkColor;

        /* ── 1. Shadow ──────────────────────────────────── */
        fill(
            drop(
                [
                    P(-SHL - 0.04, -SWO - 0.03),
                    P(SHL + 0.04, -SWO - 0.03),
                    P(SHL + 0.04, SWO + 0.03),
                    P(-SHL - 0.04, SWO + 0.03),
                ],
                5,
            ),
            "rgba(0,0,0,0.2)",
        );

        /* ── 2. Wheels — 4 per side, large and visible ──── */
        const wheelXs = [-0.24, -0.08, 0.08, 0.24];
        const wheelR = 4.5; // much larger than before (was 3.2)
        for (const wx of wheelXs) {
            for (const side of [-1, 1]) {
                const wc = lift([P(wx, SWO * side)], wheelTop)[0];
                // Tyre (dark)
                ctx.fillStyle = "#1a1a1a";
                ctx.beginPath();
                ctx.arc(wc[0], wc[1], wheelR, 0, Math.PI * 2);
                ctx.fill();
                // Rim (lighter)
                ctx.fillStyle = "#555";
                ctx.beginPath();
                ctx.arc(wc[0], wc[1], wheelR * 0.5, 0, Math.PI * 2);
                ctx.fill();
                // Spinning hub cross
                const spA = tank.treadPhase * Math.PI * 2;
                ctx.strokeStyle = "#777";
                ctx.lineWidth = 1;
                ctx.beginPath();
                const dx1 = Math.cos(spA) * wheelR * 0.35;
                const dy1 = Math.sin(spA) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx1, wc[1] - dy1 * 0.5);
                ctx.lineTo(wc[0] + dx1, wc[1] + dy1 * 0.5);
                const dx2 = Math.cos(spA + Math.PI / 2) * wheelR * 0.35;
                const dy2 = Math.sin(spA + Math.PI / 2) * wheelR * 0.35;
                ctx.moveTo(wc[0] - dx2, wc[1] - dy2 * 0.5);
                ctx.lineTo(wc[0] + dx2, wc[1] + dy2 * 0.5);
                ctx.stroke();
            }
        }

        /* ── 3. Hull — wide flat box (NOT pointed like tank) ── */
        // Flat front instead of tank's pointed nose
        const hullPts = lift(
            [
                P(-SHL, -SHW),
                P(SHL, -SHW), // flat front edge (key visual difference)
                P(SHL, SHW),
                P(-SHL, SHW),
            ],
            hullTop,
        );
        slab(hullPts, HULL_H, hullColor, hullDark);
        outline(hullPts, hullDark, 0.7);

        // Rear panel
        fill(
            lift(
                [P(-SHL, -SHW + 0.03), P(-SHL + 0.04, -SHW + 0.03), P(-SHL + 0.04, SHW - 0.03), P(-SHL, SHW - 0.03)],
                hullTop,
            ),
            hullDark,
        );

        // ── White chevron on hull top (iconic IFV marking) ──
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        const chev1 = lift([P(0.12, -SHW * 0.6)], hullTop)[0];
        const chev2 = lift([P(0.22, 0)], hullTop)[0];
        const chev3 = lift([P(0.12, SHW * 0.6)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(chev1[0], chev1[1]);
        ctx.lineTo(chev2[0], chev2[1]);
        ctx.lineTo(chev3[0], chev3[1]);
        ctx.stroke();

        // ── Side armour panels (thick white stripe) ──
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 2.5;
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

        // Hull cross-bar detail
        ctx.strokeStyle = hullDark;
        ctx.lineWidth = 0.6;
        const cb1 = lift([P(-0.1, -SHW)], hullTop)[0];
        const cb2 = lift([P(-0.1, SHW)], hullTop)[0];
        ctx.beginPath();
        ctx.moveTo(cb1[0], cb1[1]);
        ctx.lineTo(cb2[0], cb2[1]);
        ctx.stroke();

        /* ── 4. Barrel (thin autocannon, hull angle) ────── */
        const barrPts = lift([P(BX0, -BHW), P(BX1, -BHW), P(BX1, BHW), P(BX0, BHW)], barrTop);
        slab(barrPts, BARR_H, "#777", "#444");

        // Muzzle brake
        const muzzle = lift(
            [
                P(BX1 - 0.02, -BHW - 0.008),
                P(BX1 + 0.005, -BHW - 0.008),
                P(BX1 + 0.005, BHW + 0.008),
                P(BX1 - 0.02, BHW + 0.008),
            ],
            barrTop,
        );
        slab(muzzle, BARR_H, "#888", "#555");

        /* ── 5. Gun mount — small angular box (NOT circular) ── */
        const mountPts = lift([P(-MHL, -MHW), P(MHL, -MHW), P(MHL, MHW), P(-MHL, MHW)], mountTop);
        slab(mountPts, MOUNT_H, hullColor, hullDark);
        outline(mountPts, hullDark, 0.5);

        // Vision slit on front of mount
        ctx.fillStyle = "#222";
        const vs1 = lift([P(MHL - 0.01, -MHW * 0.5)], mountTop)[0];
        const vs2 = lift([P(MHL - 0.01, MHW * 0.5)], mountTop)[0];
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(vs1[0], vs1[1]);
        ctx.lineTo(vs2[0], vs2[1]);
        ctx.stroke();
    }

    /* ── SPG drawing ──────────────────────────────────────── */

    /**
     * Draw a Self-Propelled Gun (artillery).
     *
     * Visually similar to a tank but:
     *   - Longer, boxier hull
     *   - Rectangular turret (not circular)
     *   - Very long, thick barrel
     *   - Darker, heavier appearance
     */
    /**
     * Draw a Self-Propelled Gun (artillery).
     *
     * Visually very different from a tank:
     *   - Much longer chassis with rear-mounted turret
     *   - Massive boxy turret (tallest vehicle in the game)
     *   - Very long barrel with visible upward elevation
     *   - Rear hydraulic spade/stabiliser
     *   - Stowage bins and camo netting on hull
     *   - Olive-tinted hull colour mixed with team colour
     */
    _drawSPG(ctx, tank, sx, sy) {
        if (!tank.alive) return;
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const ca = Math.cos(tank.angle),
            sa = Math.sin(tank.angle);
        const tWorld = tank.turretWorld;
        const ta = Math.cos(tWorld),
            tb = Math.sin(tWorld);
        const HTW = TW / 2,
            HTH = TH / 2;

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
        const fill = (pts, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const outline = (pts, color, width) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        };
        const drop = (pts, d) => pts.map(([x, y]) => [x, y + d]);
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);
        const slab = (topPts, h, topColor, wallColor) => {
            fill(drop(topPts, h), wallColor);
            fill(topPts, topColor);
        };

        // Olive drab tint: mix team colour with military green
        // Parse the team hex colour and blend toward olive
        const parseHex = (hex) => [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ];
        const teamRGB = parseHex(tank.color);
        const teamDarkRGB = parseHex(tank.darkColor);
        const olive = [85, 95, 55];
        const oliveDark = [50, 58, 32];
        const mix = (a, b, t) =>
            `rgb(${(a[0] * (1 - t) + b[0] * t) | 0},${(a[1] * (1 - t) + b[1] * t) | 0},${(a[2] * (1 - t) + b[2] * t) | 0})`;
        const hullColor = mix(teamRGB, olive, 0.45);
        const hullDark = mix(teamDarkRGB, oliveDark, 0.45);
        const hullAccent = mix(teamRGB, olive, 0.6);

        /* ── SPG dimensions — MUCH longer chassis, rear turret ── */
        const THL = 0.5; // track half-length (much longer than tank 0.38)
        const TYO = 0.32; // track outer Y (wider)
        const TYI = 0.22; // track inner Y
        const HR = -0.46; // hull rear X (extends far back)
        const HF = 0.36; // hull front X
        const HW = 0.24; // hull half-width (wider)

        // Turret is rear-mounted: centred at -0.08 (behind hull centre)
        const TURR_CX = -0.08;
        const TRX = 0.22; // turret half-length X (big)
        const TRY = 0.18; // turret half-width Y (big)

        // Barrel — very long, with upward elevation (screen-Y offset)
        const BHW = 0.04; // barrel half-width (thick)
        const BX0 = TURR_CX + TRX - 0.02; // starts at turret front
        let BX1 = 0.72; // barrel end X (very long)
        const BARR_ELEV = 6; // pixels the barrel tip is raised above base

        const TRACK_H = 5; // taller tracks (heavier feel)
        const HULL_H = 6;
        const TURR_H = 9; // very tall turret (tallest vehicle)
        const BARR_H = 3;

        if (tank.recoilTimer > 0) BX1 -= (tank.recoilTimer / 0.1) * 0.14;

        const trackTop = -TRACK_H;
        const hullTop = -(TRACK_H + HULL_H);
        const turrTop = -(TRACK_H + HULL_H + TURR_H);
        const barrBase = -(TRACK_H + HULL_H + BARR_H + 2); // barrel sits high

        /* ── 1. Shadow (longer) ── */
        fill(
            drop(
                [
                    P(-THL - 0.06, -TYO - 0.03),
                    P(THL + 0.06, -TYO - 0.03),
                    P(THL + 0.06, TYO + 0.03),
                    P(-THL - 0.06, TYO + 0.03),
                ],
                7,
            ),
            "rgba(0,0,0,0.2)",
        );

        /* ── 2. Tracks (wider, heavier) ── */
        const lTrack = lift([P(-THL, -TYO), P(THL, -TYO), P(THL, -TYI), P(-THL, -TYI)], trackTop);
        slab(lTrack, TRACK_H, "#282828", "#0e0e0e");
        const rTrack = lift([P(-THL, TYI), P(THL, TYI), P(THL, TYO), P(-THL, TYO)], trackTop);
        slab(rTrack, TRACK_H, "#282828", "#0e0e0e");

        // Tread marks (more treads = heavier vehicle)
        const TREAD_N = 14;
        ctx.strokeStyle = "#3e3e3e";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < TREAD_N; i++) {
            const t = (i / TREAD_N + tank.treadPhase) % 1;
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

        // Track wheels (5 road wheels — heavier)
        ctx.fillStyle = "#181818";
        for (let i = 0; i < 5; i++) {
            const lx = -THL * 0.8 + i * THL * 0.4;
            for (const side of [-1, 1]) {
                const cy = side > 0 ? (TYO + TYI) / 2 : -(TYO + TYI) / 2;
                const c = lift([P(lx, cy)], trackTop)[0];
                ctx.beginPath();
                ctx.arc(c[0], c[1], 2.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        /* ── 3. Hull — long flat bed with sloped front ── */
        // Sloped glacis plate at front (angled, not flat like IFV)
        const hullPts = lift(
            [
                P(HR, -HW), // rear left
                P(HF - 0.08, -HW), // front left
                P(HF, -HW + 0.06), // glacis left
                P(HF, HW - 0.06), // glacis right
                P(HF - 0.08, HW), // front right
                P(HR, HW), // rear right
            ],
            hullTop,
        );
        slab(hullPts, HULL_H, hullColor, hullDark);
        outline(hullPts, hullDark, 0.6);

        // ── Rear spade / stabiliser (distinctive SPG feature) ──
        // Two angled arms extending down and back from the rear hull
        const spadeW = 0.06;
        const spadeL = 0.14;
        for (const side of [-1, 1]) {
            const sy2 = HW * 0.5 * side;
            const spadePts = lift(
                [
                    P(HR, sy2 - spadeW),
                    P(HR - spadeL, sy2 - spadeW * 1.5),
                    P(HR - spadeL, sy2 + spadeW * 1.5),
                    P(HR, sy2 + spadeW),
                ],
                hullTop,
            );
            slab(spadePts, HULL_H + 3, "#4a4a4a", "#2a2a2a");
            // Spade blade (flat plate at end)
            const bladePts = lift(
                [
                    P(HR - spadeL, sy2 - spadeW * 2),
                    P(HR - spadeL - 0.03, sy2 - spadeW * 2),
                    P(HR - spadeL - 0.03, sy2 + spadeW * 2),
                    P(HR - spadeL, sy2 + spadeW * 2),
                ],
                hullTop + 2,
            );
            fill(bladePts, "#3a3a3a");
        }

        // ── Hull rear panel ──
        fill(
            lift([P(HR, -HW + 0.03), P(HR + 0.04, -HW + 0.03), P(HR + 0.04, HW - 0.03), P(HR, HW - 0.03)], hullTop),
            hullDark,
        );

        // ── Engine deck at front (ahead of turret, lower profile) ──
        const deckPts = lift(
            [
                P(TURR_CX + TRX + 0.04, -HW + 0.03),
                P(HF - 0.1, -HW + 0.03),
                P(HF - 0.1, HW - 0.03),
                P(TURR_CX + TRX + 0.04, HW - 0.03),
            ],
            hullTop,
        );
        slab(deckPts, 2, hullAccent, hullDark);

        // Engine grille lines on deck
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

        // ── Stowage bins on hull sides (olive boxes) ──
        for (const side of [-1, 1]) {
            const binY = HW * side;
            const bin = lift(
                [P(-0.3, binY - 0.04 * side), P(0.0, binY - 0.04 * side), P(0.0, binY), P(-0.3, binY)],
                hullTop,
            );
            slab(bin, 3, "#5a6340", "#3a4228");
            // Bin latch
            ctx.fillStyle = "#777";
            const latch = lift([P(-0.15, binY - 0.01 * side)], hullTop - 1)[0];
            ctx.fillRect(latch[0] - 1, latch[1], 2, 1.5);
        }

        // ── Camo netting draped over rear hull ──
        ctx.strokeStyle = "rgba(70,80,50,0.4)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const nx = HR + 0.08 + i * 0.06;
            const n1 = lift([P(nx, -HW * 0.8)], hullTop - 1)[0];
            const n2 = lift([P(nx + 0.04, HW * 0.3)], hullTop)[0];
            const n3 = lift([P(nx - 0.02, HW * 0.7)], hullTop - 1)[0];
            ctx.beginPath();
            ctx.moveTo(n1[0], n1[1]);
            ctx.quadraticCurveTo(n2[0], n2[1], n3[0], n3[1]);
            ctx.stroke();
        }

        /* ── 4. Barrel — very long, with upward elevation ── */
        // The barrel is drawn with the tip raised higher on screen to
        // simulate the howitzer's upward angle.  We interpolate the
        // vertical offset along the barrel length.
        const barrLen = BX1 - BX0;
        const barrSegs = 6; // draw as segmented trapezoid for elevation
        for (let i = 0; i < barrSegs; i++) {
            const t0 = i / barrSegs;
            const t1 = (i + 1) / barrSegs;
            const x0 = BX0 + barrLen * t0;
            const x1 = BX0 + barrLen * t1;
            const elev0 = barrBase - BARR_ELEV * t0;
            const elev1 = barrBase - BARR_ELEV * t1;
            const seg = [
                [PT(x0, -BHW)[0], PT(x0, -BHW)[1] + elev0],
                [PT(x1, -BHW)[0], PT(x1, -BHW)[1] + elev1],
                [PT(x1, BHW)[0], PT(x1, BHW)[1] + elev1],
                [PT(x0, BHW)[0], PT(x0, BHW)[1] + elev0],
            ];
            const shade = i % 2 === 0 ? "#5a5a5a" : "#606060";
            slab(seg, BARR_H, shade, "#333");
        }

        // Muzzle brake (wide, distinctive)
        const mx = BX1;
        const mElev = barrBase - BARR_ELEV;
        const muzzle = [
            [PT(mx - 0.04, -BHW - 0.025)[0], PT(mx - 0.04, -BHW - 0.025)[1] + mElev],
            [PT(mx + 0.02, -BHW - 0.025)[0], PT(mx + 0.02, -BHW - 0.025)[1] + mElev],
            [PT(mx + 0.02, BHW + 0.025)[0], PT(mx + 0.02, BHW + 0.025)[1] + mElev],
            [PT(mx - 0.04, BHW + 0.025)[0], PT(mx - 0.04, BHW + 0.025)[1] + mElev],
        ];
        slab(muzzle, BARR_H, "#707070", "#404040");

        // Fume extractor (bulge mid-barrel)
        const fmX = BX0 + barrLen * 0.35;
        const fmElev = barrBase - BARR_ELEV * 0.35;
        const fume = [
            [PT(fmX - 0.025, -BHW - 0.015)[0], PT(fmX - 0.025, -BHW - 0.015)[1] + fmElev],
            [PT(fmX + 0.025, -BHW - 0.015)[0], PT(fmX + 0.025, -BHW - 0.015)[1] + fmElev],
            [PT(fmX + 0.025, BHW + 0.015)[0], PT(fmX + 0.025, BHW + 0.015)[1] + fmElev],
            [PT(fmX - 0.025, BHW + 0.015)[0], PT(fmX - 0.025, BHW + 0.015)[1] + fmElev],
        ];
        slab(fume, BARR_H + 1, "#686868", "#3a3a3a");

        /* ── 5. Turret — massive rear-mounted box (tallest vehicle) ── */
        const tPts = lift(
            [
                PT(TURR_CX - TRX, -TRY),
                PT(TURR_CX + TRX - 0.04, -TRY), // slight bevel
                PT(TURR_CX + TRX, -TRY + 0.04),
                PT(TURR_CX + TRX, TRY - 0.04),
                PT(TURR_CX + TRX - 0.04, TRY),
                PT(TURR_CX - TRX, TRY),
            ],
            turrTop,
        );
        slab(tPts, TURR_H, mix(teamRGB, olive, 0.3), hullDark);
        outline(tPts, hullDark, 0.7);

        // Turret side armour plates (raised panels)
        for (const side of [-1, 1]) {
            const pY = TRY * side;
            const panel = lift(
                [
                    PT(TURR_CX - TRX + 0.04, pY - 0.03 * side),
                    PT(TURR_CX + TRX - 0.06, pY - 0.03 * side),
                    PT(TURR_CX + TRX - 0.06, pY),
                    PT(TURR_CX - TRX + 0.04, pY),
                ],
                turrTop,
            );
            fill(panel, hullDark);
        }

        // Turret bustle (overhang at rear for ammo storage)
        const bustle = lift(
            [
                PT(TURR_CX - TRX - 0.08, -TRY + 0.02),
                PT(TURR_CX - TRX, -TRY + 0.02),
                PT(TURR_CX - TRX, TRY - 0.02),
                PT(TURR_CX - TRX - 0.08, TRY - 0.02),
            ],
            turrTop,
        );
        slab(bustle, TURR_H - 1, "#5a6340", hullDark);

        // Commander's cupola (raised circle on turret roof)
        const cupN = 8,
            cupR = 0.055;
        const cupCX = TURR_CX - 0.06,
            cupCY = -TRY * 0.35;
        const cupPts = [];
        for (let i = 0; i < cupN; i++) {
            const a = (i / cupN) * Math.PI * 2;
            cupPts.push(lift([PT(cupCX + Math.cos(a) * cupR, cupCY + Math.sin(a) * cupR)], turrTop - 3)[0]);
        }
        slab(cupPts, 3, hullAccent, hullDark);

        // Periscopes (small rectangles on cupola)
        const periPts = lift(
            [
                PT(cupCX + cupR * 0.6, cupCY - 0.015),
                PT(cupCX + cupR * 0.6 + 0.025, cupCY - 0.015),
                PT(cupCX + cupR * 0.6 + 0.025, cupCY + 0.015),
                PT(cupCX + cupR * 0.6, cupCY + 0.015),
            ],
            turrTop - 4,
        );
        fill(periPts, "#224");

        // Turret front vision slit
        const vs1 = lift([PT(TURR_CX + TRX - 0.02, -TRY * 0.35)], turrTop)[0];
        const vs2 = lift([PT(TURR_CX + TRX - 0.02, TRY * 0.35)], turrTop)[0];
        ctx.strokeStyle = "#1a1a22";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(vs1[0], vs1[1]);
        ctx.lineTo(vs2[0], vs2[1]);
        ctx.stroke();

        // ── Antenna on turret rear ──
        const antBase = lift([PT(TURR_CX - TRX + 0.03, -TRY + 0.03)], turrTop)[0];
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(antBase[0], antBase[1]);
        ctx.lineTo(antBase[0] + 1, antBase[1] - 14);
        ctx.stroke();
        // Antenna tip
        ctx.fillStyle = "#888";
        ctx.beginPath();
        ctx.arc(antBase[0] + 1, antBase[1] - 14, 1, 0, Math.PI * 2);
        ctx.fill();

        /* ── 6. Charge indicator (ring above turret while charging) ── */
        if (tank.isCharging) {
            const vStats = VEHICLES.spg;
            const maxCharge = (vStats.maxRange - vStats.minRange) / vStats.chargeRate;
            const frac = Math.min(1, tank.chargeTime / maxCharge);
            const center = lift([PT(TURR_CX, 0)], turrTop - 8)[0];
            const ringR = 5 + frac * 7;
            ctx.strokeStyle = frac > 0.9 ? "rgba(255,50,0,0.85)" : "rgba(255,180,0,0.65)";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(center[0], center[1], ringR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            ctx.stroke();
            // Tick mark at full charge
            if (frac > 0.95) {
                ctx.fillStyle = "rgba(255,50,0,0.9)";
                ctx.beginPath();
                ctx.arc(center[0], center[1] - ringR, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    /* ── drone drawing ────────────────────────────────────── */

    /**
     * Draw an FPV kamikaze quadcopter drone from isometric perspective.
     *
     * Drones hover above the ground, so the entire sprite is drawn
     * with a vertical offset.  A shadow ellipse sits at ground level.
     *
     * Visual elements:
     *   - Shadow on ground
     *   - 4 arms extending diagonally from centre
     *   - 4 spinning rotor discs at arm tips
     *   - Small team-coloured central body
     *   - White LED indicator on the front
     */
    _drawDrone(ctx, tank, sx, sy) {
        if (!tank.alive) return;
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const ca = Math.cos(tank.angle),
            sa = Math.sin(tank.angle);
        const HTW = TW / 2,
            HTH = TH / 2;

        // Project local point → screen using hull angle
        const P = (lx, ly) => {
            const wx = lx * ca - ly * sa;
            const wy = lx * sa + ly * ca;
            return [sx + (wx - wy) * HTW, sy + (wx + wy) * HTH];
        };
        const fill = (pts, color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
        };
        const lift = (pts, dy) => pts.map(([x, y]) => [x, y + dy]);

        // Hover height (bobbing)
        const hoverH = 20 + Math.sin(performance.now() / 300) * 2;

        // ── 1. Shadow on ground ──
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath();
        ctx.ellipse(sx, sy + TH / 4, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // ── 2. Arms ──
        const armLen = 0.2;
        const arms = [
            { lx: armLen, ly: armLen },
            { lx: armLen, ly: -armLen },
            { lx: -armLen, ly: armLen },
            { lx: -armLen, ly: -armLen },
        ];

        const centre = lift([P(0, 0)], -hoverH)[0];

        ctx.strokeStyle = "#333";
        ctx.lineWidth = 2;
        for (const arm of arms) {
            const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];
            ctx.beginPath();
            ctx.moveTo(centre[0], centre[1]);
            ctx.lineTo(tip[0], tip[1]);
            ctx.stroke();
        }

        // ── 3. Rotor discs (fast-spinning blur) ──
        const rotorPhase = performance.now() / 40;
        for (let ai = 0; ai < arms.length; ai++) {
            const arm = arms[ai];
            const tip = lift([P(arm.lx, arm.ly)], -hoverH)[0];

            // Motion-blur disc
            ctx.fillStyle = "rgba(180,180,180,0.2)";
            ctx.beginPath();
            ctx.arc(tip[0], tip[1], 6, 0, Math.PI * 2);
            ctx.fill();

            // Blade lines (2 per rotor, rotating)
            const bladeAngle = rotorPhase + ai * 0.7;
            ctx.strokeStyle = "rgba(80,80,80,0.5)";
            ctx.lineWidth = 1.5;
            const r = 5;
            ctx.beginPath();
            for (let b = 0; b < 2; b++) {
                const a = bladeAngle + (b * Math.PI) / 2;
                const dx = Math.cos(a) * r;
                const dy = Math.sin(a) * r * 0.5; // isometric squish
                ctx.moveTo(tip[0] - dx, tip[1] - dy);
                ctx.lineTo(tip[0] + dx, tip[1] + dy);
            }
            ctx.stroke();
        }

        // ── 4. Central body ──
        const bw = 0.09,
            bh = 0.06;
        const body = lift([P(-bw, -bh), P(bw, -bh), P(bw, bh), P(-bw, bh)], -hoverH);
        fill(body, tank.color);
        ctx.strokeStyle = tank.darkColor;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(body[0][0], body[0][1]);
        for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
        ctx.closePath();
        ctx.stroke();

        // Dark underside indicator (payload)
        const payload = lift([P(-0.04, -0.03), P(0.04, -0.03), P(0.04, 0.03), P(-0.04, 0.03)], -hoverH + 2);
        fill(payload, tank.darkColor);

        // ── 5. Front LED (white dot, blinks) ──
        const ledOn = Math.sin(performance.now() / 200) > 0;
        if (ledOn) {
            const nose = lift([P(bw + 0.03, 0)], -hoverH)[0];
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(nose[0], nose[1], 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── base structure drawing ────────────────────────────── */

    /** Dispatch to the appropriate draw method for a base structure. */
    _drawBaseStructure(ctx, entity, sx, sy, time) {
        switch (entity.entityType) {
            case "baseWall":
                this._drawBaseWall(ctx, entity, sx, sy, time);
                break;
            case "baseTower":
                this._drawWatchTower(ctx, entity, sx, sy, time);
                break;
            case "baseHQ":
                this._drawBaseHQ(ctx, entity, sx, sy, time);
                break;
        }
    }

    /**
     * Draw a 1×1 fortification wall block.  Team-coloured, shrinks with damage.
     */
    _drawBaseWall(ctx, wall, sx, sy, time) {
        const frac = wall.damageFraction;
        const cfg = BASE_STRUCTURES.baseWall;
        const fullH = cfg.visHeight;
        const h = Math.max(2, Math.round(fullH * frac));

        const S = 0.45;
        const bw = S * TW;
        const bd = S * TH;

        const dmg = 1 - frac;
        const darken = (hex, amt) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const f = 1 - amt * 0.5;
            return rgb(r * f, g * f, b * f);
        };

        // Mix team colour with concrete grey
        const mix = (hex, grey, t) => {
            const r1 = parseInt(hex.slice(1, 3), 16), g1 = parseInt(hex.slice(3, 5), 16), b1 = parseInt(hex.slice(5, 7), 16);
            return rgb(r1 * (1 - t) + grey * t, g1 * (1 - t) + grey * t, b1 * (1 - t) + grey * t);
        };

        const topCol = darken(mix(wall.color, 160, 0.5), dmg);
        const leftCol = darken(mix(wall.darkColor, 100, 0.5), dmg);
        const rightCol = darken(mix(wall.darkColor, 120, 0.5), dmg * 0.7);

        // Left (SW) wall
        ctx.fillStyle = leftCol;
        ctx.beginPath();
        ctx.moveTo(sx - bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx, sy + bd);
        ctx.lineTo(sx - bw, sy);
        ctx.closePath();
        ctx.fill();

        // Right (SE) wall
        ctx.fillStyle = rightCol;
        ctx.beginPath();
        ctx.moveTo(sx + bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx, sy + bd);
        ctx.lineTo(sx + bw, sy);
        ctx.closePath();
        ctx.fill();

        // Top face
        ctx.fillStyle = topCol;
        ctx.beginPath();
        ctx.moveTo(sx, sy - bd - h);
        ctx.lineTo(sx + bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx - bw, sy - h);
        ctx.closePath();
        ctx.fill();

        // Horizontal mortar line on top
        if (h >= 5) {
            ctx.strokeStyle = leftCol;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(sx - bw * 0.6, sy - h + 1);
            ctx.lineTo(sx + bw * 0.6, sy - h + 1);
            ctx.stroke();
        }

        if (frac < 1) this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
    }

    /**
     * Draw a 1×1 watch tower — twice wall height, with a gun barrel.
     */
    _drawWatchTower(ctx, tower, sx, sy, time) {
        const frac = tower.damageFraction;
        const cfg = BASE_STRUCTURES.baseTower;
        const fullH = cfg.visHeight;
        const h = Math.max(3, Math.round(fullH * frac));

        const S = 0.45;
        const bw = S * TW;
        const bd = S * TH;

        const dmg = 1 - frac;
        const darken = (hex, amt) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const f = 1 - amt * 0.5;
            return rgb(r * f, g * f, b * f);
        };

        const topCol = darken(tower.color, dmg);
        const leftCol = darken(tower.darkColor, dmg);
        const rightCol = darken(tower.darkColor, dmg * 0.7);

        // Left (SW) wall
        ctx.fillStyle = leftCol;
        ctx.beginPath();
        ctx.moveTo(sx - bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx, sy + bd);
        ctx.lineTo(sx - bw, sy);
        ctx.closePath();
        ctx.fill();

        // Right (SE) wall
        ctx.fillStyle = rightCol;
        ctx.beginPath();
        ctx.moveTo(sx + bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx, sy + bd);
        ctx.lineTo(sx + bw, sy);
        ctx.closePath();
        ctx.fill();

        // Top face (platform)
        ctx.fillStyle = topCol;
        ctx.beginPath();
        ctx.moveTo(sx, sy - bd - h);
        ctx.lineTo(sx + bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx - bw, sy - h);
        ctx.closePath();
        ctx.fill();

        // Platform edge (darker line)
        ctx.strokeStyle = leftCol;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - bd - h);
        ctx.lineTo(sx + bw, sy - h);
        ctx.lineTo(sx, sy + bd - h);
        ctx.lineTo(sx - bw, sy - h);
        ctx.closePath();
        ctx.stroke();

        // Crenellations at top
        if (frac > 0.3) {
            const mH = 4;
            const mw = bw * 0.25;
            ctx.fillStyle = leftCol;
            const merlons = [
                [sx, sy - bd - h - mH],
                [sx + bw * 0.7, sy - h - mH + 2],
                [sx - bw * 0.7, sy - h - mH + 2],
            ];
            for (const [mx, my] of merlons) {
                ctx.fillRect(mx - mw / 2, my, mw, mH);
            }
        }

        // Gun barrel (rotates toward target)
        if (frac > 0.2) {
            const gunLen = 10;
            const gunY = sy - h - 2;
            const angle = tower.turretAngle;
            // Project barrel tip through isometric transform
            const dx = Math.cos(angle) * gunLen;
            const dy = Math.sin(angle) * gunLen * 0.5; // iso squish
            ctx.strokeStyle = "#555";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(sx, gunY);
            ctx.lineTo(sx + dx, gunY + dy);
            ctx.stroke();
            // Muzzle
            ctx.fillStyle = "#666";
            ctx.beginPath();
            ctx.arc(sx + dx, gunY + dy, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // HP bar
        const barW = 30, barH = 4;
        const barX = sx - barW / 2, barY = sy - h - 14;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
        ctx.fillStyle = frac > 0.5 ? "#4a4" : frac > 0.25 ? "#da4" : "#d44";
        ctx.fillRect(barX, barY, barW * frac, barH);

        if (frac < 1) this._drawDamageOverlay(ctx, sx, sy, h, frac, time);
    }

    /**
     * Draw a 1×2 HQ army tent.  Peaked roof, team-coloured canvas.
     */
    /**
     * Draw a 1x2 HQ building as a simple cuboid spanning 2 tiles.
     * Same isometric block approach as walls but using the exact
     * 2-tile diamond footprint.  Team-coloured, shrinks with damage.
     */
    _drawBaseHQ(ctx, hq, sx, sy, time) {
        const frac = hq.damageFraction;
        const fullH = BASE_STRUCTURES.baseHQ.visHeight;
        const h = Math.max(3, Math.round(fullH * frac));

        const dmg = 1 - frac;
        const darken = (hex, amt) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const f = 1 - amt * 0.5;
            return rgb(r * f, g * f, b * f);
        };

        // Exact 2-tile isometric diamond vertices relative to entity centre
        const isHoriz = hq.tilePositions[1].gx !== hq.tilePositions[0].gx;
        const hw = TW / 4, hh = (3 * TH) / 4;
        const lw = (3 * TW) / 4, lh = TH / 4;
        let N, E, S, W;
        if (isHoriz) {
            N = { x: sx - hw, y: sy - hh };
            E = { x: sx + lw, y: sy + lh };
            S = { x: sx + hw, y: sy + hh };
            W = { x: sx - lw, y: sy - lh };
        } else {
            N = { x: sx + hw, y: sy - hh };
            E = { x: sx + lw, y: sy - lh };
            S = { x: sx - hw, y: sy + hh };
            W = { x: sx - lw, y: sy + lh };
        }

        const topCol   = darken(hq.color, dmg);
        const leftCol  = darken(hq.darkColor, dmg);
        const rightCol = darken(hq.darkColor, dmg * 0.7);

        // -- Back walls (fill behind the visible faces) --

        // NE back wall (N->E)
        ctx.fillStyle = rightCol;
        ctx.beginPath();
        ctx.moveTo(N.x, N.y - h);
        ctx.lineTo(E.x, E.y - h);
        ctx.lineTo(E.x, E.y);
        ctx.lineTo(N.x, N.y);
        ctx.closePath();
        ctx.fill();

        // NW back wall (W->N)
        ctx.fillStyle = leftCol;
        ctx.beginPath();
        ctx.moveTo(W.x, W.y - h);
        ctx.lineTo(N.x, N.y - h);
        ctx.lineTo(N.x, N.y);
        ctx.lineTo(W.x, W.y);
        ctx.closePath();
        ctx.fill();

        // -- Front walls --

        // Left (SW) wall: W->S
        ctx.fillStyle = leftCol;
        ctx.beginPath();
        ctx.moveTo(W.x, W.y - h);
        ctx.lineTo(S.x, S.y - h);
        ctx.lineTo(S.x, S.y);
        ctx.lineTo(W.x, W.y);
        ctx.closePath();
        ctx.fill();

        // Right (SE) wall: S->E
        ctx.fillStyle = rightCol;
        ctx.beginPath();
        ctx.moveTo(S.x, S.y - h);
        ctx.lineTo(E.x, E.y - h);
        ctx.lineTo(E.x, E.y);
        ctx.lineTo(S.x, S.y);
        ctx.closePath();
        ctx.fill();

        // -- Top face --
        ctx.fillStyle = topCol;
        ctx.beginPath();
        ctx.moveTo(N.x, N.y - h);
        ctx.lineTo(E.x, E.y - h);
        ctx.lineTo(S.x, S.y - h);
        ctx.lineTo(W.x, W.y - h);
        ctx.closePath();
        ctx.fill();

        // -- Edge outlines --
        ctx.strokeStyle = leftCol;
        ctx.lineWidth = 0.7;
        // Bottom visible edges
        ctx.beginPath();
        ctx.moveTo(W.x, W.y);
        ctx.lineTo(S.x, S.y);
        ctx.lineTo(E.x, E.y);
        ctx.stroke();
        // Top face outline
        ctx.beginPath();
        ctx.moveTo(N.x, N.y - h);
        ctx.lineTo(E.x, E.y - h);
        ctx.lineTo(S.x, S.y - h);
        ctx.lineTo(W.x, W.y - h);
        ctx.closePath();
        ctx.stroke();
        // Vertical corner edges
        ctx.beginPath();
        ctx.moveTo(W.x, W.y); ctx.lineTo(W.x, W.y - h);
        ctx.moveTo(S.x, S.y); ctx.lineTo(S.x, S.y - h);
        ctx.moveTo(E.x, E.y); ctx.lineTo(E.x, E.y - h);
        ctx.stroke();

        // -- HP bar --
        const topY = Math.min(N.y, W.y) - h;
        const barW = 44, barH = 5;
        const barX = sx - barW / 2, barY = topY - 12;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
        ctx.fillStyle = frac > 0.5 ? "#4a4" : frac > 0.25 ? "#da4" : "#d44";
        ctx.fillRect(barX, barY, barW * frac, barH);
        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.ceil(hq.hp)}/${hq.maxHp}`, sx, barY + barH + 9);

        // -- Damage overlay --
        if (frac < 1) {
            this._drawDamageOverlay(ctx, sx, sy + hh, h, frac, time);
        }
    }

        /* ── bullet drawing ───────────────────────────────────── */

    _drawBullet(ctx, bullet, sx, sy, time) {
        if (bullet.arcing) {
            this._drawArcingBullet(ctx, bullet, sx, sy, time);
            return;
        }

        const pulse = Math.sin(time * 30) * 0.3 + 0.7;
        const isIFV = bullet.damage < 1.0;

        if (isIFV) {
            // ── IFV tracer: small bright green dot with trail ──
            const r = 1.8;

            // Trail (3 fading dots behind)
            const trailDx = -Math.cos(bullet.angle) * 3;
            const trailDy = -Math.sin(bullet.angle) * 1.5; // iso squish
            for (let i = 1; i <= 3; i++) {
                ctx.globalAlpha = 0.3 - i * 0.08;
                ctx.fillStyle = "#88ff44";
                ctx.beginPath();
                ctx.arc(sx + trailDx * i, sy + trailDy * i, r * 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Green glow
            ctx.fillStyle = `rgba(100,255,60,${0.3 * pulse})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Core — bright green
            ctx.fillStyle = `rgb(${(140 + pulse * 40) | 0},255,${(80 + pulse * 40) | 0})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();

            // White hot centre
            ctx.fillStyle = "#eeffcc";
            ctx.beginPath();
            ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // ── Tank shell: larger orange/yellow ──
            const r = CONFIG.BULLET_RADIUS;

            // Glow
            ctx.fillStyle = `rgba(255,200,0,${0.25 * pulse})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Core
            ctx.fillStyle = `rgb(255,${(200 + pulse * 55) | 0},${(50 + pulse * 80) | 0})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();

            // Bright centre
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── arcing bullet drawing ─────────────────────────────── */

    _drawArcingBullet(ctx, bullet, sx, sy, time) {
        const progress = bullet.arcProgress;
        const arcH = VEHICLES.spg.arcHeight * Math.sin(progress * Math.PI);

        // Shadow on ground (grows as shell is higher)
        const shadowAlpha = 0.1 + 0.1 * Math.sin(progress * Math.PI);
        ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 4 + arcH * 0.1, 2 + arcH * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();

        // Shell at height offset
        const shellY = sy - arcH;
        const r = 3.5;
        const pulse = Math.sin(time * 20) * 0.3 + 0.7;

        // Orange glow trail
        ctx.fillStyle = `rgba(255,120,0,${0.25 * pulse})`;
        ctx.beginPath();
        ctx.arc(sx, shellY, r * 3, 0, Math.PI * 2);
        ctx.fill();

        // Shell body (hot orange-red)
        ctx.fillStyle = `rgb(255,${(100 + pulse * 40) | 0},${(20 + pulse * 30) | 0})`;
        ctx.beginPath();
        ctx.arc(sx, shellY, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright hot centre
        ctx.fillStyle = "#ffee88";
        ctx.beginPath();
        ctx.arc(sx, shellY, r * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // Trail sparks (behind the shell)
        const trailAngle = bullet.angle;
        ctx.fillStyle = "rgba(255,180,50,0.3)";
        for (let i = 1; i <= 3; i++) {
            const tx = sx - Math.cos(trailAngle) * i * 3 * (1 - progress * 0.5);
            const ty = shellY + Math.sin(trailAngle) * i * 1.5;
            ctx.beginPath();
            ctx.arc(tx, ty, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ── particle drawing ─────────────────────────────────── */

    _drawParticle(ctx, p, sx, sy) {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        const half = p.size / 2;
        ctx.fillRect(sx - half, sy - half, p.size, p.size);
        ctx.globalAlpha = 1;
    }

    /* ── HUD (per-viewport overlay) ───────────────────────── */

    /**
     * Score-based HUD for non-base modes.
     * Shows both teams' scores, controls hint, minimap.
     */
    _drawScoreHUD(ctx, game, _humanIndex, vx, vy, vw, vh, focusTank) {
        ctx.save();
        ctx.textAlign = "center";
        const cx = vx + vw / 2;

        // Background pill
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        const pillW = 200,
            pillH = 36;
        this._roundedRect(ctx, cx - pillW / 2, vy + 10, pillW, pillH, 8);
        ctx.fill();

        // Both teams' scores
        const s1 = game.teamScores[1],
            s2 = game.teamScores[2];
        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillStyle = "#cc3333";
        ctx.fillText(`RED ${s1}`, cx - 50, vy + 35);
        ctx.fillStyle = "#555";
        ctx.fillText("—", cx, vy + 35);
        ctx.fillStyle = "#3366dd";
        ctx.fillText(`${s2} BLU`, cx + 50, vy + 35);

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
        this._drawMinimap(ctx, game, focusTank.team, vx, vy, vw, vh);

        ctx.restore();
    }

    /* ── minimap ──────────────────────────────────────────── */

    _drawMinimap(ctx, game, playerNum, vx, vy, vw, vh) {
        const map = game.map;
        const px = Math.max(1, Math.min(2, Math.floor(140 / Math.max(map.width, map.height)))); // scale to fit
        const mmW = map.width * px;
        const mmH = map.height * px;
        const pad = 10;
        const mmX = vx + vw - mmW - pad;
        const mmY = vy + vh - mmH - pad;

        // Background
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

        // Tiles (simple top-down coloured squares)
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const t = map.getTile(gx, gy);
                let c;
                switch (t) {
                    case T.DEEP_WATER:
                        c = "#1a3252";
                        break;
                    case T.SHALLOW_WATER:
                        c = "#265a80";
                        break;
                    case T.SAND:
                        c = "#c8b490";
                        break;
                    case T.DIRT:
                        c = "#9b8260";
                        break;
                    case T.PAVED:
                        c = "#8c8a82";
                        break;
                    case T.GRASS:
                        c = "#487c3c";
                        break;
                    case T.DARK_GRASS:
                        c = "#3a6c2a";
                        break;
                    case T.HILL:
                        c = "#8c7350";
                        break;
                    case T.ROCK:
                        c = "#808080";
                        break;
                    case T.BLDG_SMALL:
                        c = "#b4a08c";
                        break;
                    case T.BLDG_MEDIUM:
                        c = "#a0a0b0";
                        break;
                    case T.BLDG_LARGE:
                        c = "#707080";
                        break;
                    default:
                        c = "#000";
                }
                ctx.fillStyle = c;
                ctx.fillRect(mmX + gx * px, mmY + gy * px, px, px);
            }
        }

        // Tank dots (IFVs slightly smaller) + role letters in team mode
        const roleLetters = { cavalry: "C", sniper: "S", defender: "D", scout: "F" };
        for (const t of game.allTanks) {
            if (!t.alive) continue;
            ctx.fillStyle = t.team === 1 ? "#ff4444" : "#4488ff";
            const dx = mmX + t.x * px;
            const dy = mmY + t.y * px;
            if (t.vehicleType === "drone") {
                // Cross shape for drones
                ctx.fillRect(dx - 0.5, dy - 2, 1.5, 4.5);
                ctx.fillRect(dx - 2, dy - 0.5, 4.5, 1.5);
            } else if (t.vehicleType === "ifv") {
                // Diamond shape for IFVs
                ctx.beginPath();
                ctx.moveTo(dx, dy - 1.5);
                ctx.lineTo(dx + 1.5, dy);
                ctx.lineTo(dx, dy + 1.5);
                ctx.lineTo(dx - 1.5, dy);
                ctx.closePath();
                ctx.fill();
            } else if (t.vehicleType === "spg") {
                // Triangle for SPG
                ctx.beginPath();
                ctx.moveTo(dx, dy - 2);
                ctx.lineTo(dx + 2, dy + 1.5);
                ctx.lineTo(dx - 2, dy + 1.5);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.fillRect(dx - 1, dy - 1, 3, 3);
            }
            // Show role letter for allied bots in team mode
            if (game._bots) {
                const bot = game._bots.find((b) => b.tank === t);
                if (bot?.ai.role) {
                    const letter = roleLetters[bot.ai.role] || "?";
                    ctx.font = "bold 7px monospace";
                    ctx.fillStyle = "#fff";
                    ctx.textAlign = "center";
                    ctx.fillText(letter, dx, dy - 3);
                }
            }
        }

        // Base compound markers
        for (const base of game.bases) {
            // Draw compound outline
            const bOx = mmX + base.origin.x * px;
            const bOy = mmY + base.origin.y * px;
            ctx.strokeStyle = base.team === 1 ? "rgba(255,100,100,0.5)" : "rgba(100,140,255,0.5)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(bOx, bOy, 10 * px, 10 * px);

            // HQ marker
            if (base.hq?.alive) {
                ctx.fillStyle = base.team === 1 ? "#ff6666" : "#6688ff";
                const hx = mmX + base.hq.x * px;
                const hy = mmY + base.hq.y * px;
                ctx.fillRect(hx - 2, hy - 2, 5, 5);
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 0.5;
                ctx.strokeRect(hx - 2, hy - 2, 5, 5);
            }
        }

        // Border highlight for this player
        const borderTank = game.allTanks.find((t) => t.team === playerNum) ?? game.allTanks[0];
        ctx.strokeStyle = borderTank ? borderTank.color : "#888";
        ctx.lineWidth = 1;
        ctx.strokeRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
    }

    /* ── team HUD ─────────────────────────────────────────── */

    /**
     * Battle HUD for base modes.
     * Shows tower HP, vehicle type, charge/reload indicators, bot roster, minimap.
     */
    _drawBattleHUD(ctx, game, _humanIndex, vx, vy, vw, vh, focusTank) {
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
            const vType =
                focusTank.vehicleType === "drone"
                    ? "\u2716 DRONE"
                    : focusTank.vehicleType === "ifv"
                      ? "\u25C7 IFV"
                      : "\u25C6 TANK";
            ctx.font = 'bold 13px "Courier New", monospace';
            ctx.fillStyle = focusTank.color;
            ctx.textAlign = "center";
            ctx.fillText(vType, cx, vy + ch - 20);

            // Drone proximity damage indicator
            if (focusTank.vehicleType === "drone") {
                const blastR = VEHICLES.drone.blastRadius;
                let bestDmg = 0;
                for (const t of game.allTanks) {
                    if (!t.alive || t.team === focusTank.team) continue;
                    const d = distance(focusTank.x, focusTank.y, t.x, t.y);
                    const dmg = Math.max(0, 1 - d / blastR);
                    if (dmg > bestDmg) bestDmg = dmg;
                }
                for (const s of game.baseStructures) {
                    if (!s.alive || s.team === focusTank.team) continue;
                    const d = distance(focusTank.x, focusTank.y, s.x, s.y);
                    const edgeDist = Math.max(0, d - s.size);
                    const dmg = Math.max(0, 1 - edgeDist / blastR);
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

        // SPG charge bar
        if (focusTank.vehicleType === "spg") {
            if (focusTank.isCharging) {
                const vStats = VEHICLES.spg;
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
        if (game._bots) {
            const roleNames = { cavalry: "CAV", sniper: "SNP", defender: "DEF", scout: "SCT" };
            const roleColors = { cavalry: "#e55", sniper: "#5ae", defender: "#5c5", scout: "#da5" };
            const allyBots = game._bots.filter((b) => b.tank.team === focusTank.team);
            ctx.textAlign = "left";
            ctx.font = 'bold 10px "Courier New", monospace';
            const rx = vx + 12,
                ry = vy + ch - 14 - allyBots.length * 13;
            for (let i = 0; i < allyBots.length; i++) {
                const b = allyBots[i];
                const role = b.ai.role || "???";
                const name = roleNames[role] || "???";
                const alive = b.tank.alive;
                ctx.fillStyle = alive ? roleColors[role] || "#aaa" : "#555";
                ctx.fillText(`\u2022 ${name}`, rx, ry + i * 13);
                if (!alive) {
                    ctx.fillStyle = "#777";
                    ctx.fillText(" \u2620", rx + 30, ry + i * 13);
                }
            }
        }

        // Respawn message
        if (!focusTank.alive) {
            ctx.font = 'bold 20px "Courier New", monospace';
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillText("RESPAWNING...", cx, vy + ch / 2);
        }

        // Minimap
        this._drawMinimap(ctx, game, focusTank.team, vx, vy, vw, vh);

        ctx.restore();
    }

    /* ── game over overlay ────────────────────────────────── */

    _drawGameOver(ctx, game) {
        const cw = this.canvas.width,
            ch = this.canvas.height;

        // Dim
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.textAlign = "center";

        // Winner label
        const label = game.winnerLabel;
        const winColor = game.winner === 1 ? "#cc3333" : "#3366dd";

        ctx.font = 'bold 48px "Courier New", monospace';
        ctx.fillStyle = winColor;
        ctx.fillText(`${label} WINS!`, cw / 2, ch / 2 - 30);

        // Prompts
        ctx.font = '20px "Courier New", monospace';
        ctx.fillStyle = "#aaa";
        ctx.fillText("Space / Enter   Rematch", cw / 2, ch / 2 + 20);
        ctx.fillStyle = "#666";
        ctx.fillText("R   Menu", cw / 2, ch / 2 + 50);

        ctx.restore();
    }

    /* ── SPG targeting indicator ────────────────────────── */

    _drawTargetIndicator(ctx, sx, sy, currentRange, maxRange, time) {
        const pulse = Math.sin(time * 8) * 0.3 + 0.7;
        const frac = currentRange / maxRange;
        const hot = frac > 0.9;

        // Outer isometric diamond
        const r = 14;
        ctx.strokeStyle = hot ? `rgba(255,50,0,${0.7 * pulse})` : `rgba(255,160,0,${0.5 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - r / 2);
        ctx.lineTo(sx + r, sy);
        ctx.lineTo(sx, sy + r / 2);
        ctx.lineTo(sx - r, sy);
        ctx.closePath();
        ctx.stroke();

        // Inner diamond (pulsing)
        const r2 = 7;
        ctx.strokeStyle = hot ? `rgba(255,80,0,${0.5 * pulse})` : `rgba(255,200,50,${0.35 * pulse})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - r2 / 2);
        ctx.lineTo(sx + r2, sy);
        ctx.lineTo(sx, sy + r2 / 2);
        ctx.lineTo(sx - r2, sy);
        ctx.closePath();
        ctx.stroke();

        // Centre dot
        ctx.fillStyle = hot ? `rgba(255,60,0,${0.9 * pulse})` : `rgba(255,180,0,${0.7 * pulse})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Crosshair lines
        ctx.strokeStyle = `rgba(255,180,50,${0.3 * pulse})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx - r - 4, sy);
        ctx.lineTo(sx - r + 2, sy);
        ctx.moveTo(sx + r - 2, sy);
        ctx.lineTo(sx + r + 4, sy);
        ctx.moveTo(sx, sy - r / 2 - 3);
        ctx.lineTo(sx, sy - r / 2 + 1);
        ctx.moveTo(sx, sy + r / 2 - 1);
        ctx.lineTo(sx, sy + r / 2 + 3);
        ctx.stroke();
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
