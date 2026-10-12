# MegaMaps agent instructions

These instructions apply throughout this repository. Follow the user's latest explicit instructions when changing an established choice.

## Working style

- Keep things simple. Apply YAGNI unless the user asks for more.
- Look for ways to reduce complexity, especially in complex systems.
- Use type safety where it helps; prefer inferred types when practical. Avoid `any`.
- Propose bold ideas when they could meaningfully improve the work.
- Inspect existing shared components and styles before introducing another implementation of the same UI.
- Preserve MegaMaps' map-first black and neon design and offline/local-first behavior.

## Safety and changes

- Be careful with destructive actions that the user has not explicitly requested.
- A question is a request for an answer, not a request to modify files. For questions such as "how hard would it be," "what are your thoughts," "why does," "should we," "is it possible," or "can X do Y," answer without editing files.
- For a question whose answer is obvious and whose change would be trivial, answer first and offer to make the change. Ask before modifying files.
- Preserve unrelated work already in the checkout.

## UI consistency

### Icons

- Use **Lucide icons exclusively throughout the app**, including navigation, actions, place kinds, map pins, route endpoint symbols, callouts, and search indicators. The **app logo is the only icon exception**.
- Import named icons from the installed `lucide` package and centralize reusable icons in `src/ui/icons.ts`. Bundle them locally so they work offline; do not fetch icons from a CDN.
- Do not introduce hand-drawn icon paths, emoji icons, Unicode icon substitutes, CSS-drawn icons, or custom combinations of library glyphs.
- Share the same place-kind symbols across map pins, the picker, Saved lists, place details, sharing, and search callouts. Use `placeSymbols`, `markerCalloutIcon()`, and `placeIcon()` rather than copying artwork into consumers.
- Icon restrictions concern symbolic artwork. Map route geometry, selection outlines, borders, colored badge backgrounds, and other layout decoration remain ordinary rendering/CSS.
- Current navigation choices: **Saved = Bookmark**, **Add = CirclePlus**. Add switches to Lucide **X** while it closes choices or cancels an active tool.
- Use Lucide **X** for Close and **Pencil** for Edit. Draw button backgrounds and outlines in CSS; do not use an icon with an enclosing circle as the Close glyph.

### Typography

- Use exactly **three text sizes: 14px, 16px, and 24px**.
- Use `--font-size-small`, `--font-size-body`, and `--font-size-heading` from `src/style.css`; do not add another size for a particular screen or component.
- **14px is the minimum**, including helper text, metadata, labels, badges, and map callouts. Do not shrink text to make a layout fit.
- Keep equivalent roles consistent across the library, viewer, dialogs, sheets, and menus.

### Spacing, rounding, and surfaces

- Reuse the shared `--space-*`, `--control-padding`, `--row-padding`, `--surface-padding`, and `--radius-*` tokens in `src/style.css`.
- The spacing scale is **2, 4, 8, 12, 16, 20, 24, and 32px**. Prefer these values for padding, gaps, and margins instead of new one-off values.
- Shared padding: controls **12px vertically / 16px horizontally**; rows **8px / 12px**; primary surfaces **20px on every side**, with additional bottom padding only when the device safe area requires it. Compact icon buttons use the dedicated sizing below.
- Keep modal padding visually balanced. Do not add extra top padding or stack heading margins/padding above the shared inset. Align header icons and controls consistently with the title.
- Shared corner radii are **12px, 18px, and 28px**, plus the existing pill and circular tokens. Reuse the appropriate token for equivalent inputs, cards, controls, and surfaces.
- Use shared surface width, alignment, edge-margin, and safe-area tokens for primary dialogs, panels, search, and navigation. Keep contextual action menus compact while sharing the same spacing and rounding conventions.
- Apply shared style changes to all equivalent elements, including less frequently opened import, sharing, rename, confirmation, and update dialogs.

### Buttons and modal headers

- Unify Close, Edit, and other header action buttons through shared styles. Reuse `dialogHeader()` in `src/ui/dialog.ts` for standard dialog headers.
- Use the navbar Add button as the reference for centered icons, padding, outlines, colors, and interaction feedback.
- Keep icons large and buttons compact. Current header controls are **36px visibly**, with **2px padding** and an approximately **32px icon**; their click/touch area remains at least **44px**. Navbar icon buttons are **44px**, with **8px padding** and **28px icons**.
- Keep neighboring click areas distinct. Icon-only controls need meaningful accessible labels and keyboard focus indication.
- In place details, put **Edit immediately beside Close** in the header.

### Scrolling and opening behavior

- Do not add drag handles to any modal or sheet.
- When content overflows, allow native scrolling and show a slim scroll indicator/scrollbar. Short content should not show an unnecessary scroll indicator.
- Opening UI must not automatically select text or focus an actionable control. Use `showDialog()` for dialogs, retaining explicit keyboard navigation, validation focus, and focus restoration on dismissal.
- Preserve access to content on small screens without clipping text or hiding options.

## Place details

- Clicking a saved place on the map or in Saved opens an **informative, readable details pane first**. Editing requires the explicit Edit action.
- Keep the reading view useful for long notes and future images. Do not implement image features until requested.
- The details pane initially occupies about half the screen. Center the selected place in the remaining map area above it, accounting for the pane's actual size.
- For long notes, **expand the pane as the user scrolls**, in proportion to their scroll distance, toward the available maximum height. Once expansion reaches its limit, continue scrolling through the notes. Reverse the expansion naturally when scrolling back.
- Use smooth, continuous native scrolling. Do not snap between heights, teleport content, or repeatedly restart camera animations during scrolling.
- Keep the place centered in the remaining map area as the pane grows, without resetting the user's zoom unnecessarily.
- Saving or cancelling edits to an existing place returns to its readable details view.

## Map brightness

- Present the presets **100%, 85%, 75%, 65%, and 55%**, in that order. The default is **85%**.
- Include descriptive helper text: "Dim the map so routes and places stand out."
- Fit all five options in one line whenever the available width permits; preserve the 14px minimum and accessible controls on narrow screens.
- Use `BRIGHTNESS_LEVELS` and `brightnessPercent()` in `src/viewer/navigation.ts` for values and IDs. Round percentage conversions before constructing IDs, labels, or selectors; never interpolate raw floating-point percentages such as `55.00000000000001` into selectors.

## Imports

- Keep the native file selector accessible from the explicit Import action, including when the app is opened in the T3 Code browser. Trigger file selection from the user's interaction.
- Do not treat missing dependencies in a fresh worktree as application failures. Install dependencies before diagnosing errors such as `vite: command not found`.

## Testing and comments

- Add or run tests when the user asks for testing or implementation verification. Use focused tests that validate meaningful behavior.
- Avoid endless smoke tests and regression tests for intentionally deleted features.
- **Do not use computer use or a browser for testing unless explicitly asked.**
- Compilation or automated tests do not establish visual acceptance or prove that a native file picker works on a physical device; report what was actually checked.
- Use concise comments to clarify functionality and how functions/classes are used. Do not comment every line.
- Keep comments synchronized with the code when making changes.
