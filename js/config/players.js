/**
 * Players & colours.
 */

/** Maximum number of simultaneous local human players. */
export const MAX_PLAYERS = 4;

/**
 * Player colours in join order (P1 = index 0, P2 = index 1, …).
 *
 * A colour is a *team* colour, not a fixed identity: in Skirmish each
 * player defaults to their own colour and may join another player's
 * team by adopting its colour; in Battle teams are fixed RED (0) /
 * BLUE (1).  A player's `P1`…`P4` label is fixed by join order and is
 * used only for HUD identity.
 */
export const PLAYER_COLORS = [
    { color: "#cc3333", darkColor: "#882222", label: "RED" },
    { color: "#3366dd", darkColor: "#223399", label: "BLUE" },
    { color: "#3bb54a", darkColor: "#2a8035", label: "GREEN" },
    { color: "#e8a020", darkColor: "#a5711a", label: "AMBER" },
];
