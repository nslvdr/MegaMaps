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
} as const;

export type Preferences = { -readonly [K in keyof typeof choices]: (typeof choices)[K][number] };

function stored(key: keyof Preferences) {
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

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  localStorage.setItem(`megamaps:${key}`, value);
}
