# Agent rules

## Working style

- Keep things simple; apply YAGNI. Prefer inferred types and avoid `any`.
- Propose bold ideas when they meaningfully improve the work.
- Questions ask for answers, not file changes. Answer first, offer the change, and ask before editing.
- The app has two uses: viewing a map at home and exploring on site, with editing in both. Never trade reliability for performance: bugs can't be debugged underground.

## UI

- Mobile first, touch only: no keyboard controls, shortcuts or focus outlines.
- For visible design changes, show 3–4 options as HTML previews before implementing. Don't use artifacts.
- Mockups show an iPhone Pro Max screen: 440×956 CSS px at 1:1 zoom, with 62px top and 34px bottom safe areas, so controls and text appear at their real size.
- Use only **Lucide icons**, except for the app logo and the cave entrance place icon (a Lucide-style redraw).
- Use only **three font sizes**, with **14px as the minimum**.
- Modal header buttons (Close, Edit, Share) share one tinted, outlined circle holding a Lucide icon at one size: **X**, **Pencil**, **Share2**. Edit sits beside Close.
- No handles on modals. Show a scroll indicator only when content overflows.
- Scrolling must follow the user's movement smoothly, without jumps or teleporting.
- Clicking a place opens readable details first; editing requires an explicit Edit action.
- The UI is Svelte 5 components styled with Tailwind v4 utilities; theme tokens and custom utilities live in `src/app.css`. Build on the shared parts in `src/ui/kit/` (Button, DialogHeader, HeaderButton, Icon, Row…) instead of restyling the same thing twice. The map's state lives in `ViewerControls` (`src/ui/viewer-controls.svelte.ts`); its components only read it and call its methods.
- Font sizes are the `text-small`, `text-body` and `text-heading` utilities, and spacing utilities count in pixels (`p-12` is 12px).

## Motion

- Use the `--motion-*` tokens in `src/app.css` (mirrored in `src/ui/motion.ts`), never raw durations (`duration-press`, `duration-fast`, `duration-base`, `duration-slow` in classes): press 80ms, state changes 150ms, arriving 250ms, emphasis 400ms, one blink 1s.
- Things arrive with `--ease-out` from where they live (set `--enter-from`) and leave the way they came in 150ms with `--ease-in`. Something over the map that comes and goes takes the `motion` class, and `hidden` plays both; something removed from the page leaves with `leave()`.
- Nothing runs longer than 400ms except map glides and status loops. Everything honours reduced motion.

## Releases

The app shows `src/changelog.ts` once after an update: everything new since the device's last release, as new features, then changes, then bug fixes.

When the user asks for a new release:

1. Run `git fetch origin`. Users only have what `origin/main` holds. The newest release in `src/changelog.ts` whose `commit` is in `origin/main` (`git merge-base --is-ancestor <commit> origin/main`) is the last shipped one; if none is, use the commit `origin/main` last merged from `dev`. List what `dev` merged since then with `git log --first-parent --format='%h %s%n%b' <commit>..origin/dev`.
2. Releases above the last shipped one never reached users: replace them with a single new release at the top, with today's `date` and the short hash of `origin/dev` as `commit`.
3. Leave out anything added and then removed since the last shipped release, and add no line saying it's gone.
4. Sort each change users can notice into `added`, `changed` or `fixed`. Give each one short English line, most important first, merging related PRs. Only a value that changed, such as a limit or a number, reads "Thing: before → after", like "Map size limit: 300 → 600 megapixels."; describe other changes in a sentence. Leave out what users can't notice, such as docs, tests, refactors and build tooling. Omit empty lists.
5. Add the French for each line to the "What’s new" block of `src/locales/fr.ts`.
6. Run `npm test` and `npm run build` (only the build type-checks the tests), then commit as `docs: changelog for <date>`. Don't create tags or GitHub releases.

## Testing

- Write focused tests for meaningful behavior. No smoke tests, and no regression tests for intentionally deleted features.
- Do not use computer use or a browser for testing unless explicitly asked.
- Check that an optimisation is faster with `npm run bench -- --against origin/dev` (headless Chrome on this Mac; see `bench/run.ts`). Only "faster" counts; "noise" means no measurable change.
