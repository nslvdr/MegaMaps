# Agent rules

## Working style

- Keep things simple, apply YAGNI, and reduce complexity.
- Use type safety where useful; prefer inferred types. Avoid `any`.
- Propose bold ideas when they meaningfully improve the work.
- Be careful with destructive actions the user has not requested.
- Questions ask for answers, not file changes. Answer first, offer the change, and ask before editing.
- Keep comments concise, useful, and synchronized with the code; do not comment every line.

## UI consistency

- Use only **Lucide icons**, except for the app logo.
- Use **Share2** for sharing.
- Use only **three font sizes**, with **14px as the minimum**.
- Unify padding, margins, and corner rounding across modals and elements. Modal top padding must match the other sides.
- Unify Close, Edit, and Share buttons. Header buttons must match the title's height, with sufficient padding and consistently sized icons.
- Close uses a plain **X**; draw its outline in CSS. Place **Edit beside Close**.
- No handles on modals. Show a scroll indicator only when content overflows.
- Scrolling must follow the user's movement smoothly, without jumps or teleporting.

## Place details

- Clicking a place opens readable information first; editing requires an explicit Edit action.
- Keep details easy to access and suitable for long notes and future images.
- Start the pane at about half the screen and center the place in the remaining map area above it.
- For long notes, expand the pane progressively as the user scrolls, then scroll through the content.

## Map brightness

- Options: **100%, 85%, 75%, 65%, 55%**.
- Include a description and fit all options on one line when possible.

## Testing

- Write focused tests for meaningful behavior. Avoid endless smoke tests and regression tests for intentionally deleted features.
- Do not use computer use or a browser for testing unless explicitly asked.
