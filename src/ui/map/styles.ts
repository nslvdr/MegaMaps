// Classes the map's panels and cards share.

/** A floating surface over the map: Search, the task card and the panels sit
 * where the pill sits, as wide as a dialog. */
export const overMap = "absolute left-(--edge-l) right-(--edge-r) mx-auto w-(--surface-width) [--enter-from:var(--rise-from)]";
/** A card read beside the map: not modal, so not in the top layer; it floats
 * over the map's controls, sized to what there is to read, up to 70% of the
 * screen so the place stays visible above it. */
export const readingCard = `fixed top-auto bottom-12 z-20 my-0 h-auto max-h-[calc(70dvh-12px)] overflow-hidden select-text
  pb-[max(20px,calc(env(safe-area-inset-bottom)-12px))] open:flex open:flex-col [--accent:var(--c)] [--enter-from:translateY(32px)_scale(0.98)]`;
/** A card of rows (icon · label · control), each ruled from the next. */
export const panelCard = "overflow-hidden rounded-md border border-line bg-fill [&>*+*]:border-t [&>*+*]:border-line";
export const panelRow = "flex min-h-56 items-center gap-12 px-12 py-8";
/** A row's icon in a rounded square, tinted with its colour. */
export const rowIcon = "grid size-34 shrink-0 place-items-center rounded-sm bg-c/16 text-c [&>svg]:size-20";
export const rowText = "flex min-w-0 flex-1 flex-col gap-2 [&>strong]:text-body [&>strong]:font-semibold [&>strong]:[overflow-wrap:anywhere]";
export const rowHint = "overflow-hidden text-small leading-compact text-muted [overflow-wrap:anywhere] empty:hidden";
export const fieldHelp = "my-8 text-small leading-normal text-muted [overflow-wrap:anywhere]";
/** A panel's section heading. */
export const panelHeading = "mt-16 mb-8 text-small font-strong tracking-caps text-muted uppercase first:mt-0";
/** A form field's caption and what it holds, as the dialog's labels read. */
export const formField = "my-16 text-small text-muted";
