/**
 * Isometric pixel-art renderer.
 *
 * Draws two side-by-side viewports (split-screen), each following one
 * player's tank.  Rendering is depth-sorted so elevated terrain
 * correctly occludes entities behind it.
 */

import { CONFIG, TILES as T } from './config.js';
import { worldToScreen, worldDirToScreen, clamp, lerp } from './utils.js';

const TW = CONFIG.TILE_WIDTH;
const TH = CONFIG.TILE_HEIGHT;

/* ── Colour palette ───────────────────────────────────────── */

const PALETTE = {
    deepWater:    { r: 22,  g: 50,  b: 82  },
    shallowWater: { r: 38,  g: 82,  b: 128 },
    sand:         { r: 210, g: 185, b: 150 },
    grass:        { r: 72,  g: 124, b: 60  },
    darkGrass:    { r: 55,  g: 100, b: 42  },
    hillTop:      { r: 140, g: 115, b: 80  },
    hillLeft:     { r: 105, g: 82,  b: 55  },
    hillRight:    { r: 125, g: 100, b: 68  },
    rockTop:      { r: 130, g: 130, b: 130 },
    rockLeft:     { r: 90,  g: 90,  b: 90  },
    rockRight:    { r: 110, g: 110, b: 110 },
};

function rgb(r, g, b) { return `rgb(${r|0},${g|0},${b|0})`; }

/* ================================================================== */

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width  = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.vpW = Math.floor(this.canvas.width / 2);
        this.vpH = this.canvas.height;
    }

    /* ── public entry point ───────────────────────────────── */

    render(game) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Left viewport – player 1
        this._renderViewport(ctx, game, game.tank1, game.camera1,
                             0, 0, this.vpW, this.vpH);

        // Right viewport – player 2
        this._renderViewport(ctx, game, game.tank2, game.camera2,
                             this.vpW, 0, this.vpW, this.vpH);

        // Divider
        ctx.save();
        ctx.strokeStyle = '#556';
        ctx.lineWidth   = 3;
        ctx.shadowColor = '#000';
        ctx.shadowBlur  = 6;
        ctx.beginPath();
        ctx.moveTo(this.vpW, 0);
        ctx.lineTo(this.vpW, this.canvas.height);
        ctx.stroke();
        ctx.restore();

        // HUD overlays (drawn on top, not clipped)
        this._drawHUD(ctx, game, 1, 0,       0, this.vpW, this.vpH);
        this._drawHUD(ctx, game, 2, this.vpW, 0, this.vpW, this.vpH);

        if (game.gameOver) this._drawGameOver(ctx, game);
    }

    /* ── viewport rendering ───────────────────────────────── */

    _renderViewport(ctx, game, tank, camera, vx, vy, vw, vh) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx, vy, vw, vh);
        ctx.clip();

        // Fill background (deep water colour so edges look natural)
        ctx.fillStyle = rgb(PALETTE.deepWater.r - 6,
                            PALETTE.deepWater.g - 6,
                            PALETTE.deepWater.b - 6);
        ctx.fillRect(vx, vy, vw, vh);

        // Camera transform: centre of viewport tracks camera position
        const ox = vx + vw / 2 - camera.x;
        const oy = vy + vh / 2 - camera.y;
        ctx.translate(ox, oy);

        // Determine visible area in screen-space
        const visLeft   = camera.x - vw / 2 - TW * 2;
        const visRight  = camera.x + vw / 2 + TW * 2;
        const visTop    = camera.y - vh / 2 - TH * 4;
        const visBottom = camera.y + vh / 2 + TH * 4;

        // ── PASS 1: flat ground tiles ──
        // Flat tiles (water, sand, grass) can never occlude entities,
        // so we draw them all first.  Adjacent flat diamonds share
        // exact edges, so iteration order doesn't matter.
        const map = game.map;

        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const tile = map.getTile(gx, gy);
                if (map.tileHeight(tile) > 0) continue;   // elevated → pass 2

                const scr = worldToScreen(gx, gy);
                if (scr.x < visLeft || scr.x > visRight ||
                    scr.y < visTop  || scr.y > visBottom) continue;

                this._drawTile(ctx, { gx, gy, tile, sx: scr.x, sy: scr.y },
                               game.gameTime, map);
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
                if (map.tileHeight(tile) === 0) continue;  // already drawn

                const scr = worldToScreen(gx, gy);
                if (scr.x < visLeft || scr.x > visRight ||
                    scr.y < visTop  || scr.y > visBottom) continue;

                addToBucket(gx + gy + 1, {
                    kind: 0, gx, gy, tile,
                    sx: scr.x, sy: scr.y,
                });
            }
        }

        // Entities (tanks, bullets, particles)
        const addEntity = (kind, entity, wx, wy) => {
            const scr = worldToScreen(wx, wy);
            if (scr.x < visLeft - 40 || scr.x > visRight + 40 ||
                scr.y < visTop - 40  || scr.y > visBottom + 40) return;
            addToBucket(wx + wy, { kind, entity, sx: scr.x, sy: scr.y });
        };

        for (const t of [game.tank1, game.tank2]) {
            if (t.alive || t.respawnTimer > 0) addEntity(1, t, t.x, t.y);
        }
        for (const b of game.bullets) {
            if (b.alive) addEntity(2, b, b.x, b.y);
        }
        for (const p of game.particles.particles) {
            addEntity(3, p, p.x, p.y);
        }

        // Render back-to-front
        for (let d = 0; d < buckets.length; d++) {
            const bucket = buckets[d];
            if (!bucket) continue;
            for (const item of bucket) {
                switch (item.kind) {
                    case 0: this._drawTile(ctx, item, game.gameTime, map); break;
                    case 1: this._drawTank(ctx, item.entity, item.sx, item.sy); break;
                    case 2: this._drawBullet(ctx, item.entity, item.sx, item.sy, game.gameTime); break;
                    case 3: this._drawParticle(ctx, item.entity, item.sx, item.sy); break;
                }
            }
        }

        ctx.restore();
    }

    /* ── tile drawing ─────────────────────────────────────── */

    _drawTile(ctx, { gx, gy, tile, sx, sy }, time, map) {
        // Colour variation per tile based on position
        const v = ((gx * 7 + gy * 13) % 5) - 2;   // −2 … +2

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
                    this._diamond(ctx, sx, sy, 'rgba(180,210,240,0.15)');
                    ctx.globalAlpha = 1;
                }
                break;
            }

            case T.SAND: {
                const c = PALETTE.sand;
                this._diamond(ctx, sx, sy, rgb(c.r + v * 3, c.g + v * 3, c.b + v * 2));
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
                const h = map.tileHeight(T.HILL);
                this._elevatedTile(ctx, sx, sy, h,
                    PALETTE.hillTop, PALETTE.hillLeft, PALETTE.hillRight, v);
                break;
            }

            case T.ROCK: {
                const h = map.tileHeight(T.ROCK);
                this._elevatedTile(ctx, sx, sy, h,
                    PALETTE.rockTop, PALETTE.rockLeft, PALETTE.rockRight, v);
                break;
            }
        }
    }

    /** Draw a flat isometric diamond (top face of a ground-level tile). */
    _diamond(ctx, sx, sy, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sx,          sy);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.lineTo(sx,          sy + TH);
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
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx - TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // Right (SE) side
        ctx.fillStyle = rgb(rightC.r + v * 2, rightC.g + v * 2, rightC.b + v * 2);
        ctx.beginPath();
        ctx.moveTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx,          sy + TH);
        ctx.lineTo(sx + TW / 2, sy + TH / 2);
        ctx.closePath();
        ctx.fill();

        // Top face
        ctx.fillStyle = rgb(topC.r + v * 3, topC.g + v * 3, topC.b + v * 3);
        ctx.beginPath();
        ctx.moveTo(sx,          sy - h);
        ctx.lineTo(sx + TW / 2, sy + TH / 2 - h);
        ctx.lineTo(sx,          sy + TH - h);
        ctx.lineTo(sx - TW / 2, sy + TH / 2 - h);
        ctx.closePath();
        ctx.fill();
    }

    /* ── tank drawing ─────────────────────────────────────── */

    _drawTank(ctx, tank, sx, sy) {
        if (!tank.alive) return;

        // Flashing when recently respawned
        if (tank.flashTimer > 0 && Math.sin(tank.flashTimer * 20) > 0) return;

        const bh  = CONFIG.TANK_BODY_HEIGHT;
        const bs  = CONFIG.TANK_BODY_HALF;
        const bw  = bs * TW;   // half-width on screen
        const bd  = bs * TH;   // half-depth on screen

        // ── Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.ellipse(sx, sy + TH * 0.28, bw * 0.9, bd * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();

        // ── Body left side (SW)
        ctx.fillStyle = tank.darkColor;
        ctx.beginPath();
        ctx.moveTo(sx - bw, sy - bh);
        ctx.lineTo(sx,      sy + bd - bh);
        ctx.lineTo(sx,      sy + bd);
        ctx.lineTo(sx - bw, sy);
        ctx.closePath();
        ctx.fill();

        // ── Body right side (SE)
        ctx.beginPath();
        ctx.moveTo(sx + bw, sy - bh);
        ctx.lineTo(sx,      sy + bd - bh);
        ctx.lineTo(sx,      sy + bd);
        ctx.lineTo(sx + bw, sy);
        ctx.closePath();
        ctx.fill();

        // ── Body top face
        ctx.fillStyle = tank.color;
        ctx.beginPath();
        ctx.moveTo(sx,      sy - bd - bh);
        ctx.lineTo(sx + bw, sy - bh);
        ctx.lineTo(sx,      sy + bd - bh);
        ctx.lineTo(sx - bw, sy - bh);
        ctx.closePath();
        ctx.fill();

        // ── Turret dome (small darker diamond on top)
        const ts = bs * 0.45;
        const tw2 = ts * TW;
        const td2 = ts * TH;
        ctx.fillStyle = tank.darkColor;
        ctx.beginPath();
        ctx.moveTo(sx,       sy - td2 - bh - 1);
        ctx.lineTo(sx + tw2, sy - bh - 1);
        ctx.lineTo(sx,       sy + td2 - bh - 1);
        ctx.lineTo(sx - tw2, sy - bh - 1);
        ctx.closePath();
        ctx.fill();

        // ── Barrel
        const cos = Math.cos(tank.angle);
        const sin = Math.sin(tank.angle);
        const dir = worldDirToScreen(cos, sin);
        let barrelLen = CONFIG.TANK_BARREL_LENGTH;
        // recoil shrink
        if (tank.recoilTimer > 0) {
            barrelLen -= (tank.recoilTimer / 0.1) * 0.12;
        }

        const bx = sx + dir.x * barrelLen;
        const by = (sy - bh) + dir.y * barrelLen;

        ctx.strokeStyle = '#444';
        ctx.lineWidth   = CONFIG.TANK_BARREL_WIDTH + 1;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(sx, sy - bh);
        ctx.lineTo(bx, by);
        ctx.stroke();

        ctx.strokeStyle = '#666';
        ctx.lineWidth   = CONFIG.TANK_BARREL_WIDTH;
        ctx.beginPath();
        ctx.moveTo(sx, sy - bh);
        ctx.lineTo(bx, by);
        ctx.stroke();
    }

    /* ── bullet drawing ───────────────────────────────────── */

    _drawBullet(ctx, bullet, sx, sy, time) {
        const pulse = Math.sin(time * 30) * 0.3 + 0.7;
        const r = CONFIG.BULLET_RADIUS;

        // Glow
        ctx.fillStyle = `rgba(255,200,0,${0.25 * pulse})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `rgb(255,${200 + pulse * 55|0},${50 + pulse * 80|0})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // Bright centre
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }

    /* ── particle drawing ─────────────────────────────────── */

    _drawParticle(ctx, p, sx, sy) {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        const half = p.size / 2;
        ctx.fillRect(sx - half, sy - half, p.size, p.size);
        ctx.globalAlpha = 1;
    }

    /* ── HUD (per-viewport overlay) ───────────────────────── */

    _drawHUD(ctx, game, playerNum, vx, vy, vw, vh) {
        const tank  = playerNum === 1 ? game.tank1 : game.tank2;
        const label = `P${playerNum}`;
        const score = tank.score;

        ctx.save();

        // Player label + score
        ctx.font = 'bold 22px "Courier New", monospace';
        ctx.textAlign = 'center';
        const cx = vx + vw / 2;

        // Background pill
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const pillW = 140, pillH = 36;
        this._roundedRect(ctx, cx - pillW / 2, vy + 10, pillW, pillH, 8);
        ctx.fill();

        // Text
        ctx.fillStyle = tank.color;
        ctx.fillText(`${label}: ${score} / ${CONFIG.WIN_SCORE}`, cx, vy + 35);

        // Respawn message
        if (!tank.alive) {
            ctx.font = 'bold 18px "Courier New", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText('RESPAWNING...', cx, vy + vh / 2);
        }

        // Controls hint (first few seconds)
        if (game.gameTime < 6) {
            const alpha = game.gameTime < 4 ? 0.7 : 0.7 * (1 - (game.gameTime - 4) / 2);
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.font = '14px "Courier New", monospace';
            ctx.fillStyle = '#ccc';
            if (playerNum === 1) {
                ctx.fillText('WASD to move · SPACE to fire', cx, vy + vh - 30);
            } else {
                ctx.fillText('Arrows to move · ENTER to fire', cx, vy + vh - 30);
            }
            ctx.globalAlpha = 1;
        }

        // Minimap
        this._drawMinimap(ctx, game, playerNum, vx, vy, vw, vh);

        ctx.restore();
    }

    /* ── minimap ──────────────────────────────────────────── */

    _drawMinimap(ctx, game, playerNum, vx, vy, vw, vh) {
        const map  = game.map;
        const px   = 2;                        // pixels per tile
        const mmW  = map.width  * px;
        const mmH  = map.height * px;
        const pad  = 10;
        const mmX  = vx + vw - mmW - pad;
        const mmY  = vy + vh - mmH - pad;

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

        // Tiles (simple top-down coloured squares)
        for (let gy = 0; gy < map.height; gy++) {
            for (let gx = 0; gx < map.width; gx++) {
                const t = map.getTile(gx, gy);
                let c;
                switch (t) {
                    case T.DEEP_WATER:    c = '#1a3252'; break;
                    case T.SHALLOW_WATER: c = '#265a80'; break;
                    case T.SAND:          c = '#c8b490'; break;
                    case T.GRASS:         c = '#487c3c'; break;
                    case T.DARK_GRASS:    c = '#3a6c2a'; break;
                    case T.HILL:          c = '#8c7350'; break;
                    case T.ROCK:          c = '#808080'; break;
                    default:              c = '#000';
                }
                ctx.fillStyle = c;
                ctx.fillRect(mmX + gx * px, mmY + gy * px, px, px);
            }
        }

        // Player dots
        const drawDot = (tank, color) => {
            if (!tank.alive) return;
            ctx.fillStyle = color;
            const dx = mmX + tank.x * px;
            const dy = mmY + tank.y * px;
            ctx.fillRect(dx - 2, dy - 2, 5, 5);
        };

        drawDot(game.tank1, '#ff4444');
        drawDot(game.tank2, '#4488ff');

        // Border highlight for this player
        ctx.strokeStyle = playerNum === 1 ? game.tank1.color : game.tank2.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
    }

    /* ── game over overlay ────────────────────────────────── */

    _drawGameOver(ctx, game) {
        const cw = this.canvas.width, ch = this.canvas.height;

        // Dim
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.textAlign = 'center';

        // Winner text
        const winner = game.winner === 1 ? game.tank1 : game.tank2;
        ctx.font = 'bold 48px "Courier New", monospace';
        ctx.fillStyle = winner.color;
        ctx.fillText(`PLAYER ${game.winner} WINS!`, cw / 2, ch / 2 - 20);

        // Restart prompt
        ctx.font = '22px "Courier New", monospace';
        ctx.fillStyle = '#aaa';
        ctx.fillText('Press  R  to restart', cw / 2, ch / 2 + 30);

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
