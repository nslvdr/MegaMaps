// Device preferences the first paint needs, so they're read synchronously.
// The first choice is the default.
const choices = {
  language: ["fr", "en"],
  "label-size": ["standard", "large"],
  /** How each Saved list is ordered. */
  "place-order": ["newest", "oldest", "name", "type", "seen"],
  "route-order": ["newest", "oldest", "name"],
  /** Compass mode turns the map for changes of at least this many degrees… */
  "compass-step": ["2", "5", "10"],
  /** …once they've held this many seconds. */
  "compass-delay": ["1", "0.5", "2", "5"],
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
