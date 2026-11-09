/**
 * Steam library artwork, staged with the game's own tiles, sprites and particles
 * so it can never drift from how the vehicles really look.  `?image=<name>` picks
 * one image.  Each image is its own composition, placed by fractions of the image.
 *
 * Scenes render small and scale up with hard pixels because the sprites are drawn
 * for about one pixel per screen pixel; scaled smoothly they turn to soft vector
 * shapes and lose the pixel-art look of the game.
 */

import { TILES as T } from "../js/config.js";
import { TileGrid } from "../js/map/grid.js";
import { ParticleSystem } from "../js/particles.js";
import { TH, TW } from "../js/render/projection.js";
import { drawTile } from "../js/render/tiles.js";
import { collectDepthItems, drawDepthBuckets } from "../js/render/viewport.js";
import { drawVehicle } from "../js/render/vehicles.js";
import { Tank } from "../js/tank.js";
import { worldToScreen } from "../js/utils.js";
import { ARTWORK_SIZES } from "./artwork-images.js";

const RED = { number: 1, color: "#cc3333", dark: "#882222" };
const BLUE = { number: 2, color: "#3366dd", dark: "#223399" };

/** World angles that read as these directions on screen. */
const FACING = {
    right: -Math.PI / 4,
    left: (3 * Math.PI) / 4,
    upRight: -Math.PI / 2,
    upLeft: Math.PI,
    downRight: 0,
    downLeft: Math.PI / 2,
};

const WORLD_SIZE = 128;
const WORLD_CENTRE = WORLD_SIZE / 2;
/** A moment of water and rotor animation. */
const GAME_TIME = 3.1;

/** Every image redraws from the same seed, so re-rendering changes nothing. */
function seedRandom(seed) {
    let state = seed;
    Math.random = () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function random(low, high) {
    return low + Math.random() * (high - low);
}

/** One image's mapping between fractions of the image, world space and scene pixels. */
function makeFrame(W, H, { pixel, zoom }) {
    const scale = pixel * zoom;
    const camera = worldToScreen(WORLD_CENTRE, WORLD_CENTRE);
    return {
        W,
        H,
        pixel,
        zoom,
        camera,
        viewWidth: W / scale,
        viewHeight: H / scale,
        world([fx, fy]) {
            const sx = camera.x + ((fx - 0.5) * W) / scale;
            const sy = camera.y + ((fy - 0.5) * H) / scale;
            const across = sx / (TW / 2);
            const down = sy / (TH / 2);
            return { x: (down + across) / 2, y: (down - across) / 2 };
        },
        fraction(x, y) {
            const s = worldToScreen(x, y);
            return [0.5 + ((s.x - camera.x) * scale) / W, 0.5 + ((s.y - camera.y) * scale) / H];
        },
    };
}

/* ── Terrain ──────────────────────────────────────────────── */

function meadowTile(gx, gy) {
    const patch = Math.sin(gx * 0.61 + gy * 0.23) + Math.cos(gy * 0.83 - gx * 0.31);
    return patch > 0.55 ? T.DARK_GRASS : T.GRASS;
}

/** `shore` is positive on land, and its size gives the width of the water's edge. */
function groundTile(gx, gy, fx, fy, shore) {
    const land = shore ? shore(fx, fy) : 1;
    if (land < -0.07) return T.DEEP_WATER;
    if (land < 0) return T.SHALLOW_WATER;
    if (land < 0.05) return T.SAND;
    return meadowTile(gx, gy);
}

function paintTerrain(map, frame, scene) {
    for (let gy = 0; gy < WORLD_SIZE; gy++) {
        for (let gx = 0; gx < WORLD_SIZE; gx++) {
            const [fx, fy] = frame.fraction(gx + 0.5, gy + 0.5);
            map.setTile(gx, gy, groundTile(gx, gy, fx, fy, scene.shore));
        }
    }
    for (const road of scene.roads ?? []) paintRoad(map, frame, road);
    for (const [tile, ...spot] of scene.tiles ?? []) {
        const { x, y } = frame.world(spot);
        map.setTile(Math.floor(x), Math.floor(y), tile);
    }
}

/** Roads run along a world axis, which reads as a diagonal on screen. */
function paintRoad(map, frame, { through, axis, width = 2 }) {
    const centre = frame.world(through);
    const fixed = Math.floor(axis === "x" ? centre.y : centre.x);
    for (let along = 0; along < WORLD_SIZE; along++) {
        for (let across = 0; across < width; across++) {
            const [gx, gy] = axis === "x" ? [along, fixed + across] : [fixed + across, along];
            if (map.tileHeight(map.getTile(gx, gy)) === 0 && map.getTile(gx, gy) > T.SAND) map.setTile(gx, gy, T.DIRT);
        }
    }
}

/** Flat tiles are one colour each, too plain at this size: give the ground some grain. */
function drawGroundGrain(ctx, spots) {
    for (const { sx, sy } of spots) {
        for (let i = 0; i < 16; i++) {
            const across = random(-0.46, 0.46);
            const down = random(-0.46, 0.46);
            const px = sx + (across + down) * (TW / 2) * 0.98;
            const py = sy + TH / 2 + (down - across) * (TH / 2) * 0.98;
            ctx.fillStyle = Math.random() < 0.55 ? "rgba(0,0,0,0.13)" : "rgba(255,255,210,0.09)";
            ctx.fillRect(Math.round(px), Math.round(py), 1, random(1, 3) | 0);
        }
    }
}

function drawGround(ctx, world, view) {
    const { map } = world;
    const spots = [];
    for (let gy = 0; gy < map.height; gy++) {
        for (let gx = 0; gx < map.width; gx++) {
            const tile = map.getTile(gx, gy);
            if (map.tileHeight(tile) > 0) continue;
            const { x: sx, y: sy } = worldToScreen(gx, gy);
            if (sx < view.left || sx > view.right || sy < view.top || sy > view.bottom) continue;
            drawTile(ctx, { gx, gy, tile, sx, sy }, GAME_TIME, map);
            if (tile > T.SHALLOW_WATER) spots.push({ sx, sy });
        }
    }
    drawGroundGrain(ctx, spots);
}

/* ── Cast ─────────────────────────────────────────────────── */

function placeSquad(vehicle) {
    const spread = [
        [0, 0],
        [0.42, -0.3],
        [-0.34, 0.3],
        [0.5, 0.42],
        [-0.46, -0.28],
    ];
    vehicle.squad.members.forEach((member, i) => {
        const [dx, dy] = spread[i % spread.length];
        member.x = vehicle.x + dx;
        member.y = vehicle.y + dy;
    });
}

function makeVehicle(frame, { type, team, at, facing, aim }) {
    const vehicle = new Tank(team.number, team.color, team.dark);
    const position = frame.world(at);
    vehicle.team = team.number;
    vehicle.x = position.x;
    vehicle.y = position.y;
    vehicle.angle = FACING[facing];
    vehicle.vehicleType = type;
    if (vehicle.squad) placeSquad(vehicle);
    if (aim) {
        const target = frame.world(aim);
        vehicle.turretAngle = Math.atan2(target.y - position.y, target.x - position.x) - vehicle.angle;
        vehicle.recoilTimer = 0.06;
    }
    return vehicle;
}

function shellAlong(vehicle, target, progress) {
    return {
        x: vehicle.x + (target.x - vehicle.x) * progress,
        y: vehicle.y + (target.y - vehicle.y) * progress,
    };
}

const BARREL_LENGTH = 0.52;
const BARREL_LIFT = 14;

function muzzleOf(vehicle) {
    const x = vehicle.x + Math.cos(vehicle.turretWorld) * BARREL_LENGTH;
    const y = vehicle.y + Math.sin(vehicle.turretWorld) * BARREL_LENGTH;
    return { x, y, screen: worldToScreen(x, y) };
}

/* ── Fire, smoke and shells ───────────────────────────────── */

/** The game's explosions are flat bursts on the ground; a fireball gives the art height. */
function drawFireball(ctx, x, y, radius) {
    const shells = [
        ["#6e1a08", 1, 70],
        ["#c9360c", 0.84, 70],
        ["#ff7a14", 0.64, 60],
        ["#ffc23a", 0.42, 44],
        ["#fff3c4", 0.2, 22],
    ];
    for (const [color, reach, count] of shells) {
        ctx.fillStyle = color;
        for (let i = 0; i < count; i++) {
            const angle = random(0, Math.PI * 2);
            const dist = Math.sqrt(Math.random()) * radius * reach;
            const size = random(radius * 0.14, radius * 0.3);
            ctx.fillRect(
                x + Math.cos(angle) * dist - size / 2,
                y + Math.sin(angle) * dist * 0.85 - size / 2,
                size,
                size,
            );
        }
    }
}

function drawPlume(ctx, x, y, height, drift) {
    const puffs = Math.round(height * 1.4);
    for (let i = 0; i < puffs; i++) {
        const rise = i / puffs;
        const size = 3 + rise * height * 0.26;
        const px = x + rise * rise * drift + random(-1, 1) * (2 + rise * height * 0.14);
        const py = y - rise * height + random(-2, 2);
        const shade = Math.round(26 + rise * 42 + random(-6, 6));
        ctx.fillStyle = `rgba(${shade},${shade},${shade + 3},${0.82 * (1 - rise * 0.8)})`;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
}

function drawScorch(ctx, x, y, radius) {
    ctx.fillStyle = "rgba(14,10,6,0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < radius * 5; i++) {
        const angle = random(0, Math.PI * 2);
        const dist = radius * random(0.7, 1.35);
        ctx.fillRect(x + Math.cos(angle) * dist, y + (Math.sin(angle) * dist) / 2, random(1, 3), 1);
    }
}

function drawTreadMarks(ctx, vehicle, length) {
    const backX = -Math.cos(vehicle.angle);
    const backY = -Math.sin(vehicle.angle);
    const sideX = -backY * 0.26;
    const sideY = backX * 0.26;
    ctx.strokeStyle = "rgba(16,18,10,0.2)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([1.5, 1.5]);
    for (const side of [-1, 1]) {
        const start = worldToScreen(vehicle.x + sideX * side, vehicle.y + sideY * side);
        const end = worldToScreen(vehicle.x + sideX * side + backX * length, vehicle.y + sideY * side + backY * length);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

/** Tank shells burn yellow-white and IFV rounds green, as they do in the game. */
const TRACER_COLORS = { tank: "255,235,170", ifv: "150,255,90" };

function drawTracer(ctx, from, to, rgb) {
    const trail = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    trail.addColorStop(0, `rgba(${rgb},0)`);
    trail.addColorStop(1, `rgba(${rgb},0.95)`);
    ctx.strokeStyle = trail;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.fillRect(to.x - 2, to.y - 2, 4, 4);
}

/* ── A staged battle ──────────────────────────────────────── */

function stage(frame, scene) {
    const map = new TileGrid(WORLD_SIZE, WORLD_SIZE);
    paintTerrain(map, frame, scene);

    const allTanks = [];
    const shots = [];
    for (const spec of scene.cast) {
        const vehicle = makeVehicle(frame, spec);
        allTanks.push(vehicle);
        if (spec.aim) shots.push({ vehicle, target: frame.world(spec.aim), progress: spec.shell ?? 0.55 });
    }

    const particles = new ParticleSystem();
    for (const blast of scene.blasts ?? []) {
        const { x, y } = frame.world(blast.at);
        for (let i = 0; i < 3; i++) particles.emit("explosion", x, y);
    }
    particles.update(0.14);
    for (const { vehicle } of shots) {
        const muzzle = muzzleOf(vehicle);
        particles.emit("muzzleFlash", muzzle.x, muzzle.y, vehicle.turretWorld);
    }
    particles.update(0.03);

    return { map, gameTime: GAME_TIME, allTanks, baseStructures: [], bullets: [], particles, shots };
}

function drawStage(ctx, frame, scene, world) {
    const { camera, viewWidth, viewHeight } = frame;
    const view = {
        left: camera.x - viewWidth / 2 - TW * 2,
        right: camera.x + viewWidth / 2 + TW * 2,
        top: camera.y - viewHeight / 2 - TH * 4,
        bottom: camera.y + viewHeight / 2 + TH * 4,
    };
    ctx.save();
    ctx.scale(frame.zoom, frame.zoom);
    ctx.translate(viewWidth / 2 - camera.x, viewHeight / 2 - camera.y);

    // Anti-aliased diamond edges let whatever is underneath show through as a grid.
    ctx.fillStyle = "#1a2c1a";
    ctx.fillRect(camera.x - viewWidth, camera.y - viewHeight, viewWidth * 2, viewHeight * 2);
    drawGround(ctx, world, view);
    for (const blast of scene.blasts ?? []) {
        const { x, y } = frame.world(blast.at);
        const s = worldToScreen(x, y);
        drawScorch(ctx, s.x, s.y, blast.size * 0.9);
    }
    scene.cast.forEach((spec, i) => {
        if (spec.trail) drawTreadMarks(ctx, world.allTanks[i], spec.trail);
    });

    // Darkening only the ground keeps the vehicles the brightest things in the picture.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#7f88a8";
    ctx.fillRect(camera.x - viewWidth, camera.y - viewHeight, viewWidth * 2, viewHeight * 2);
    ctx.globalCompositeOperation = "source-over";

    drawDepthBuckets(ctx, collectDepthItems(world, view.left, view.right, view.top, view.bottom), world);

    for (const blast of scene.blasts ?? []) {
        const { x, y } = frame.world(blast.at);
        const s = worldToScreen(x, y);
        const lift = blast.size * 0.55;
        if (blast.plume) drawPlume(ctx, s.x, s.y - lift, blast.plume, blast.drift ?? 18);
        drawFireball(ctx, s.x, s.y - lift, blast.size);
    }
    for (const { vehicle, target, progress } of world.shots) {
        const muzzle = muzzleOf(vehicle);
        const shell = shellAlong(muzzle, target, progress);
        const head = worldToScreen(shell.x, shell.y);
        drawTracer(
            ctx,
            { x: muzzle.screen.x, y: muzzle.screen.y - BARREL_LIFT },
            { x: head.x, y: head.y - BARREL_LIFT },
            TRACER_COLORS[vehicle.vehicleType],
        );
        drawFireball(ctx, muzzle.screen.x, muzzle.screen.y - BARREL_LIFT, 5);
    }
    ctx.restore();
}

/* ── Colour grade ─────────────────────────────────────────── */

function gradeScene(ctx, frame, scene) {
    const { W, H, pixel, zoom } = frame;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const blast of scene.blasts ?? []) {
        const x = blast.at[0] * W;
        const y = blast.at[1] * H;
        const radius = blast.size * pixel * zoom * 3.4;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, "rgba(255,150,60,0.42)");
        glow.addColorStop(0.4, "rgba(255,90,30,0.16)");
        glow.addColorStop(1, "rgba(255,60,10,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    const inner = Math.min(W, H) * 0.42;
    const vignette = ctx.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    vignette.addColorStop(0, "rgba(6,6,14,0)");
    vignette.addColorStop(1, "rgba(6,6,14,0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

function fadeFromTop(ctx, W, depth, opacity) {
    const band = ctx.createLinearGradient(0, 0, 0, depth);
    band.addColorStop(0, `rgba(6,6,14,${opacity})`);
    band.addColorStop(1, "rgba(6,6,14,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, W, depth);
}

function drawBattle(ctx, W, H, scene) {
    seedRandom(scene.seed);
    const frame = makeFrame(W, H, scene);
    const small = document.createElement("canvas");
    small.width = Math.ceil(W / scene.pixel);
    small.height = Math.ceil(H / scene.pixel);
    const smallCtx = small.getContext("2d");
    drawStage(smallCtx, frame, scene, stage(frame, scene));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width * scene.pixel, small.height * scene.pixel);
    gradeScene(ctx, frame, scene);
}

/* ── Wordmark ─────────────────────────────────────────────── */

const GLYPHS = {
    T: ["#######", "#######", "..###..", "..###..", "..###..", "..###..", "..###.."],
    A: [".#####.", "#######", "##...##", "#######", "#######", "##...##", "##...##"],
    N: ["##...##", "###..##", "####.##", "##.####", "##..###", "##...##", "##...##"],
    K: ["##...##", "##..##.", "##.##..", "####...", "##.##..", "##..##.", "##...##"],
    E: ["#######", "#######", "##.....", "#####..", "##.....", "#######", "#######"],
    D: ["######.", "#######", "##...##", "##...##", "##...##", "#######", "######."],
};
const WORD = "TANKED";
const GLYPH_CELLS = 7;

/** Which logical pixels of the word are solid, for a given cell size. */
function wordmarkMask(cell) {
    const width = (WORD.length * (GLYPH_CELLS + 1) - 1) * cell;
    const height = GLYPH_CELLS * cell;
    const solid = new Set();
    [...WORD].forEach((letter, i) => {
        const left = i * (GLYPH_CELLS + 1) * cell;
        GLYPHS[letter].forEach((row, r) => {
            [...row].forEach((mark, c) => {
                if (mark !== "#") return;
                for (let y = 0; y < cell; y++) {
                    for (let x = 0; x < cell; x++) solid.add(`${left + c * cell + x},${r * cell + y}`);
                }
            });
        });
    });
    return { solid, width, height };
}

/**
 * Armour-plate block letters, in the same neutral as the game's title.  Returns a
 * small canvas to scale up with hard pixels, so it matches the scenes' pixel size.
 */
function renderWordmark(cell) {
    const { solid, width, height } = wordmarkMask(cell);
    const depth = Math.round(cell * 0.75);
    const outline = Math.max(2, Math.round(cell * 0.34));
    const canvas = document.createElement("canvas");
    canvas.width = width + depth + outline * 2;
    canvas.height = height + depth + outline * 2;
    const ctx = canvas.getContext("2d");
    const has = (x, y) => solid.has(`${x},${y}`);

    const pixels = [...solid].map((key) => key.split(",").map(Number));
    ctx.fillStyle = "#08090b";
    for (const [x, y] of pixels) {
        ctx.fillRect(x, y, depth + outline * 2 + 1, depth + outline * 2 + 1);
    }
    for (let step = depth; step > 0; step--) {
        ctx.fillStyle = step > depth / 2 ? "#3b3e42" : "#585c61";
        for (const [x, y] of pixels) ctx.fillRect(x + outline + step, y + outline + step, 1, 1);
    }
    for (const [x, y] of pixels) {
        const row = y / height;
        let shade = row < 0.5 ? 226 : 196;
        if (!has(x, y - 1) || !has(x - 1, y)) shade = 250;
        else if (!has(x, y + 1) || !has(x + 1, y)) shade = 150;
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x + outline, y + outline, 1, 1);
    }
    return canvas;
}

function drawWordmark(ctx, centreX, top, cell, pixel) {
    const mark = renderWordmark(cell);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mark, centreX - (mark.width * pixel) / 2, top, mark.width * pixel, mark.height * pixel);
}

/* ── The images ───────────────────────────────────────────── */

const HERO = {
    seed: 20261106,
    pixel: 2,
    zoom: 2,
    shore: (fx, fy) => fx * 1.2 + (1 - fy) * 0.75 - 0.2,
    roads: [{ through: [0.36, 0.7], axis: "y" }],
    tiles: [
        [T.BLDG_LARGE, 0.1, 0.13],
        [T.BLDG_MEDIUM, 0.18, 0.2],
        [T.BLDG_SMALL, 0.25, 0.09],
        [T.BLDG_MEDIUM, 0.31, 0.18],
        [T.BLDG_SMALL, 0.42, 0.06],
        [T.BLDG_MEDIUM, 0.93, 0.13],
        [T.BLDG_MEDIUM, 0.8, 0.95],
        [T.BLDG_SMALL, 0.867, 0.85],
        [T.BLDG_LARGE, 0.94, 0.75],
    ],
    cast: [
        { type: "tank", team: RED, at: [0.34, 0.7], facing: "upRight", aim: [0.625, 0.44], shell: 0.55, trail: 1.4 },
        { type: "ifv", team: RED, at: [0.17, 0.45], facing: "right", trail: 1.6 },
        { type: "drone", team: RED, at: [0.5, 0.41], facing: "right" },
        { type: "squad", team: RED, at: [0.47, 0.84], facing: "upRight" },
        { type: "tank", team: BLUE, at: [0.72, 0.34], facing: "left" },
        { type: "ifv", team: BLUE, at: [0.86, 0.46], facing: "left", aim: [0.585, 0.72], shell: 0.42, trail: 1.2 },
    ],
    blasts: [
        { at: [0.625, 0.45], size: 20, plume: 78, drift: -30 },
        { at: [0.585, 0.73], size: 9 },
    ],
};

const COVER = {
    seed: 7,
    pixel: 2,
    zoom: 2.5,
    roads: [{ through: [0.31, 0.77], axis: "y" }],
    tiles: [
        [T.BLDG_MEDIUM, 0.1, 0.27],
        [T.BLDG_SMALL, 0.97, 0.26],
        [T.BLDG_SMALL, 0.96, 0.74],
    ],
    cast: [
        { type: "tank", team: RED, at: [0.3, 0.76], facing: "upRight", aim: [0.57, 0.53], shell: 0.62, trail: 1.6 },
        { type: "drone", team: RED, at: [0.2, 0.47], facing: "upRight" },
        { type: "squad", team: RED, at: [0.7, 0.88], facing: "upRight" },
        { type: "tank", team: BLUE, at: [0.76, 0.37], facing: "downLeft" },
    ],
    blasts: [{ at: [0.57, 0.55], size: 19, plume: 58, drift: -24 }],
};

const WIDE = {
    seed: 11,
    pixel: 2,
    zoom: 1.5,
    roads: [{ through: [0.27, 0.84], axis: "y" }],
    tiles: [
        [T.BLDG_MEDIUM, 0.06, 0.5],
        [T.BLDG_SMALL, 0.14, 0.42],
        [T.BLDG_SMALL, 0.95, 0.5],
    ],
    cast: [
        { type: "tank", team: RED, at: [0.27, 0.8], facing: "right", aim: [0.63, 0.66], shell: 0.56, trail: 1.6 },
        { type: "drone", team: RED, at: [0.45, 0.56], facing: "right" },
        { type: "tank", team: BLUE, at: [0.76, 0.6], facing: "left" },
        { type: "ifv", team: BLUE, at: [0.88, 0.82], facing: "left" },
    ],
    blasts: [{ at: [0.63, 0.68], size: 17, plume: 34, drift: -12 }],
};

function drawIcon(ctx, W, H) {
    const pixel = 2;
    const zoom = 2.25;
    const small = document.createElement("canvas");
    small.width = W / pixel;
    small.height = H / pixel;
    const smallCtx = small.getContext("2d");
    const tank = new Tank(RED.number, RED.color, RED.dark);
    tank.angle = FACING.upRight;
    smallCtx.scale(zoom, zoom);
    drawVehicle(smallCtx, tank, small.width / zoom / 2 - 3, small.height / zoom / 2 + 8);

    ctx.fillStyle = "#1a2c1a";
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, W * 0.14);
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, W, H);
}

const IMAGES = {
    hero(ctx, W, H) {
        drawBattle(ctx, W, H, HERO);
    },
    wide(ctx, W, H) {
        drawBattle(ctx, W, H, WIDE);
        fadeFromTop(ctx, W, H * 0.46, 0.92);
        drawWordmark(ctx, W / 2, 22, 6, 2);
    },
    cover(ctx, W, H) {
        drawBattle(ctx, W, H, COVER);
        fadeFromTop(ctx, W, H * 0.36, 0.95);
        drawWordmark(ctx, W / 2, 46, 5, 2);
    },
    logo(ctx, W, H) {
        const pixel = 4;
        const cell = 6;
        drawWordmark(ctx, W / 2, (H - renderWordmark(cell).height * pixel) / 2, cell, pixel);
    },
    icon: drawIcon,
};

// The drone animates off the wall clock; this moment has its light on.
performance.now = () => 600;

const name = new URLSearchParams(location.search).get("image");
const { width, height } = ARTWORK_SIZES[name];
const canvas = document.getElementById("art");
canvas.width = width;
canvas.height = height;
IMAGES[name](canvas.getContext("2d"), width, height);
