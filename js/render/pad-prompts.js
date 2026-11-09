/**
 * Controller prompts drawn as pictures.  Printed letters differ between pads
 * (A is the bottom button on one and the right button on another), so a
 * prompt shows the button's position instead.
 */

const FACE_POSITIONS = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const LIT_COLOR = "#ffd23f";
const UNLIT_COLOR = "rgba(255,255,255,0.25)";
const PART_GAP = 8;

/** A prompt part: the face button at `position`, one of FACE_POSITIONS. */
export function faceButton(position) {
    return { faceButton: position };
}

/** Four dots in a diamond, with the one to press lit. */
export function drawFaceButtons(ctx, cx, cy, size, litPosition) {
    const spread = size * 0.32;
    for (const [position, [dx, dy]] of Object.entries(FACE_POSITIONS)) {
        const lit = position === litPosition;
        ctx.fillStyle = lit ? LIT_COLOR : UNLIT_COLOR;
        ctx.beginPath();
        ctx.arc(cx + dx * spread, cy + dy * spread, size * (lit ? 0.2 : 0.14), 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * One centred line mixing text and face-button pictures, in the current font
 * and fill.  `parts` holds strings and `faceButton()` parts.
 */
export function drawPrompt(ctx, cx, y, parts, buttonSize = 18) {
    const textColor = ctx.fillStyle;
    const widths = parts.map((part) => (typeof part === "string" ? ctx.measureText(part).width : buttonSize));
    const total = widths.reduce((sum, width) => sum + width, 0) + PART_GAP * (parts.length - 1);
    const align = ctx.textAlign;
    ctx.textAlign = "left";
    let x = cx - total / 2;
    parts.forEach((part, i) => {
        if (typeof part === "string") {
            ctx.fillStyle = textColor;
            ctx.fillText(part, x, y);
        } else {
            drawFaceButtons(ctx, x + buttonSize / 2, y - buttonSize * 0.35, buttonSize, part.faceButton);
        }
        x += widths[i] + PART_GAP;
    });
    ctx.fillStyle = textColor;
    ctx.textAlign = align;
}
