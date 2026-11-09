/**
 * Test options for a launch.  Steam can't easily pass arguments to a non-Steam
 * shortcut, so they can also come from a file that affects exactly one launch.
 */

import fs from "node:fs";

/** The file is deleted before use, so a crash can't make the options stick. */
function consumeOneShotArgs(file) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
        fs.unlinkSync(file);
    } catch {
        return [];
    }
    return text.split(/\s+/).filter(Boolean);
}

function optionValue(args, name) {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

/**
 * @param {string[]} argv  command-line arguments
 * @param {string} oneShotFile  path of the one-launch arguments file
 * @returns {{diagnose: boolean, demo: string|null, quitAtSeconds: number|null, shotSeconds: number[]}}
 */
export function readLaunchOptions(argv, oneShotFile) {
    const args = [...argv, ...consumeOneShotArgs(oneShotFile)];
    const quitAt = optionValue(args, "quit-at");
    const shots = optionValue(args, "shots") ?? "";
    return {
        diagnose: args.includes("--diagnose"),
        demo: optionValue(args, "demo"),
        quitAtSeconds: quitAt === null ? null : Number(quitAt),
        shotSeconds: shots.split(",").filter(Boolean).map(Number),
    };
}
