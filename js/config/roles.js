/**
 * Player-facing AI role presentation, keyed by the role name.
 *
 * The HUD (three-letter glyph + roster colour) and the minimap (single
 * letter over the marker) both read this table instead of keeping their own
 * drift-prone copies.  A new role is one entry here (plus its
 * `ROLE_STRATEGIES` strategy and `roleWeights` entries).
 */
export const ROLE_PRESENTATION = Object.freeze({
    cavalry: { glyph: "CAV", letter: "C", color: "#e55" },
    sniper: { glyph: "SNP", letter: "S", color: "#5ae" },
    defender: { glyph: "DEF", letter: "D", color: "#5c5" },
    scout: { glyph: "SCT", letter: "F", color: "#da5" },
});
