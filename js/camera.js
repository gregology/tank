/**
 * A simple camera that smoothly follows a target screen-space position.
 */
export class Camera {
    constructor() {
        this.x = 0;           // screen-space X the camera is centered on
        this.y = 0;           // screen-space Y
        this.smoothing = 5;   // higher = snappier follow
    }

    /** Instantly jump to a position. */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /** Smoothly move toward `(tx, ty)` each frame. */
    follow(tx, ty, dt) {
        const t = Math.min(1, this.smoothing * dt);
        this.x += (tx - this.x) * t;
        this.y += (ty - this.y) * t;
    }
}
