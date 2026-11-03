// Device preferences the first paint needs, so they're read synchronously.
// The first choice is the default.
const choices = {
  language: ["fr", "en"],
  "label-size": ["standard", "large"],
  /** Saved names show once the screen spans at most this many metres. */
  "label-distance": ["200", "100", "500", "1000", "always"],
  /** How each Saved list is ordered. */
  "place-order": ["newest", "oldest", "name", "type", "seen"],
  "route-order": ["newest", "oldest", "name"],
  /** When Compass mode turns the map: by itself, or on a double tap. */
  "compass-follow": ["auto", "tap"],
  /** How soon Auto follows a new heading, slower to faster. */
  "compass-speed": ["mid", "high", "live"],
  /** Pace for travel times, in km/h. */
  "walking-speed": ["4", "2", "3", "5"],
  /** Whether a found update installs by itself or waits for the user to agree. */
  "update-install": ["auto", "ask"],
  /** The hidden map overlay: tile borders and live stats. */
  debug: ["off", "on"],
  /** Whether this device was welcomed on its first launch. */
  tour: ["new", "seen"],
  /** Whether removing the example map was offered, once there was a map of one's own. */
  "example-offer": ["new", "seen"],
} as const;

export type Preferences = { -readonly [K in keyof typeof choices]: (typeof choices)[K][number] };

/** Choices storage refused to keep, such as when it is full: they last until the app closes. */
const unsaved = new Map<string, string>();

function stored(key: keyof Preferences) {
  const kept = unsaved.get(key);
  if (kept !== undefined) return kept;
  try {
    return localStorage.getItem(`megamaps:${key}`);
  } catch {
    // Workers have no storage: they're named after the page's language.
    return key === "language" ? (globalThis as { name?: string }).name ?? null : null;
  }
}

export function preference<K extends keyof Preferences>(key: K): Preferences[K] {
  const value = stored(key);
  const allowed: readonly string[] = choices[key];
  return (value !== null && allowed.includes(value) ? value : allowed[0]) as Preferences[K];
}

/** Reset the app: every setting back to its default, so the welcome and the example map come back as on a new install. */
export function resetPreferences() {
  unsaved.clear();
  for (const key of Object.keys(choices)) {
    try {
      localStorage.removeItem(`megamaps:${key}`);
    } catch {}
  }
}

/** A choice storage refuses still applies until the app closes, rather than failing what made it. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  try {
    localStorage.setItem(`megamaps:${key}`, value);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, value);
  }
}
