# Agent rules

## Working style

- Keep things simple; apply YAGNI. Prefer inferred types and avoid `any`.
- Propose bold ideas when they meaningfully improve the work.
- Questions ask for answers, not file changes. Answer first, offer the change, and ask before editing.

## UI

- Use only **Lucide icons**, except for the app logo.
- Use only **three font sizes**, with **14px as the minimum**.
- Keep header buttons (Close, Edit, Share) unified; Close is a plain **X** with Edit beside it.
- No handles on modals. Show a scroll indicator only when content overflows.
- Scrolling must follow the user's movement smoothly, without jumps or teleporting.
- Clicking a place opens readable details first; editing requires an explicit Edit action.

## Testing

- Write focused tests for meaningful behavior. No smoke tests, and no regression tests for intentionally deleted features.
- Do not use computer use or a browser for testing unless explicitly asked.
