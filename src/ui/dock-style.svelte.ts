import { preference } from "../preferences";

/** The map menu's look, kept live so a choice in Settings shows on a map that is already open. */
export const dockStyle = $state({ value: preference("dock-style") });
