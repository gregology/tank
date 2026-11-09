/**
 * Which kernel nodes stand for a controller, and what layout each one has.
 *
 * Under Steam a controller can appear twice.  Steam Controllers have only a
 * virtual pad.  Other controllers have their own node and a virtual twin, and
 * the twin swaps the bottom and right buttons, so the own node is the true one.
 * All measured on the Steam Machine: Servers/SteamMachine/AGENTS.md §6.
 */

const STEAM_VENDOR = "28de";
const STEAM_CONTROLLER_SLOT_TYPE = "steam";
const VIRTUAL_PAD_NAME = /X-Box 360 pad (\d+)$/;

/** Controllers whose layout is known to differ from the twin-stick default. */
const PROFILE_OF_DEVICE = new Map([["057e:2009", "paddles"]]);
const DEFAULT_PROFILE = "twinStick";

/**
 * Parse the file `$SteamVirtualGamepadInfo` names.
 * @returns {Map<string, {type: string, handle: string}>} slot number → slot
 */
export function parseSteamSlots(text) {
    const slots = new Map();
    let slot = null;
    for (const line of text.split("\n")) {
        const header = /^\[slot (\d+)\]/.exec(line);
        if (header) {
            slot = { type: "", handle: "" };
            slots.set(header[1], slot);
        }
        const field = /^(type|handle)=(.*)$/.exec(line);
        if (field && slot) slot[field[1]] = field[2];
    }
    return slots;
}

/**
 * @param {{node: string, name: string, deviceId: string, uniq: string}} device
 *        `deviceId` is "vendor:product" in lowercase hex
 * @param {Map<string, {type: string, handle: string}>} steamSlots
 * @returns {{identity: string, controlProfile: string}|null} null for a node
 *        that doesn't stand for a controller.  `identity` survives the
 *        controller turning off and on, even if its node number changes.
 */
export function identifyController({ node, name, deviceId, uniq }, steamSlots) {
    if (!deviceId.startsWith(`${STEAM_VENDOR}:`)) {
        return {
            identity: `own:${uniq || node}`,
            controlProfile: PROFILE_OF_DEVICE.get(deviceId) ?? DEFAULT_PROFILE,
        };
    }
    const slotNumber = VIRTUAL_PAD_NAME.exec(name)?.[1];
    const slot = steamSlots.get(slotNumber);
    if (slot?.type !== STEAM_CONTROLLER_SLOT_TYPE) return null;
    return { identity: `steam:${slot.handle || slotNumber}`, controlProfile: DEFAULT_PROFILE };
}
