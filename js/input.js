/**
 * Keyboard input manager.
 *
 * Tracks which keys are currently held and which were just pressed
 * this frame.  Call `update()` at the END of each frame to clear
 * the "just-pressed" set.
 */
export class InputManager {
    constructor() {
        /** @type {Record<string,boolean>} currently held */
        this.keys = {};
        /** @type {Record<string,boolean>} pressed this frame */
        this.justPressed = {};

        window.addEventListener("keydown", (e) => {
            if (!this.keys[e.code]) {
                this.justPressed[e.code] = true;
            }
            this.keys[e.code] = true;

            // Prevent browser scrolling for game keys
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter"].includes(e.code)) {
                e.preventDefault();
            }
        });

        window.addEventListener("keyup", (e) => {
            this.keys[e.code] = false;
        });

        // Clear state if the window loses focus
        window.addEventListener("blur", () => {
            this.keys = {};
            this.justPressed = {};
        });
    }

    isDown(code) {
        return !!this.keys[code];
    }
    wasPressed(code) {
        return !!this.justPressed[code];
    }

    /** Call once at the end of each frame. */
    endFrame() {
        this.justPressed = {};
    }
}
