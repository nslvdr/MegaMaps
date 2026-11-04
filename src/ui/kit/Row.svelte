<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ClassValue, HTMLAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import { icons } from "../icons";
  // One row of a settings-like list: a round icon in its colour, a label with a
  // hint under it, then a value, a control, or an arrow saying it opens something.
  let {
    tag = "button", id, icon, tone = "var(--neon-view)", label, hint, hintId, value, valueId, arrow = false,
    external = false, disabled = false, hidden = false, class: className = "", iconClass = "", leading,
    children, onclick, href, current, expanded, dot, ...rest
  }: {
    tag?: "button" | "label" | "a" | "div" | "li"; id?: string; icon?: string; tone?: string; label: string;
    hint?: string; hintId?: string; value?: string; valueId?: string; arrow?: boolean; external?: boolean;
    disabled?: boolean; hidden?: boolean; class?: ClassValue; iconClass?: string;
    /** In place of the round icon, such as a map's thumbnail. */
    leading?: Snippet;
    /** A control at the row's end, such as a select or a switch. */
    children?: Snippet;
    onclick?: (event: MouseEvent) => void; href?: string; current?: boolean;
    /** Whether what the row folds open is showing; set, the row ends in a chevron. */
    expanded?: boolean;
    /** A dot on the icon: "ready" pulses lime, "due" stays in the backup colour. */
    dot?: "ready" | "due" | "";
    /** data-* hooks, such as which help topic a link opens. */
    [key: `data-${string}`]: string | undefined;
  } & Pick<HTMLAttributes<HTMLElement>, "onpointerdown" | "onpointerup" | "onpointercancel" | "onpointerleave" | "oncontextmenu"> = $props();
  const interactive = $derived(tag === "button" || tag === "a");
</script>

<svelte:element this={tag} {id} {hidden} {onclick} {href} aria-current={current || undefined} aria-expanded={expanded} {...rest}
  type={tag === "button" ? "button" : undefined} disabled={tag === "button" ? disabled : undefined}
  target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined}
  class={[
    "flex min-h-58 w-full items-center gap-12 px-12 py-8 text-left text-body text-inherit no-underline",
    tag !== "div" && tag !== "li" && "cursor-pointer",
    interactive && "enabled:active:scale-100 enabled:active:bg-white/6 enabled:hover:bg-white/4 [a&]:active:bg-white/6 [a&]:hover:bg-white/4",
    className,
  ]}>
  {#if leading}
    {@render leading()}
  {:else if icon}
    <span style:--k={tone}
      class={["relative grid size-32 shrink-0 place-items-center rounded-full border border-k/40 tint-k/16 text-k [&>svg]:size-17", iconClass]}>
      <Icon svg={icon} />
      {#if dot !== undefined}<span aria-hidden="true" class={dotClass(dot)}></span>{/if}
    </span>
  {/if}
  <span class="min-w-0 flex-1">{label}{#if hint !== undefined}<small id={hintId}
    class="mt-2 block text-small text-muted empty:hidden">{hint}</small>{/if}</span>
  {#if value !== undefined}<span id={valueId} class="text-small text-muted tabular-nums">{value}</span>{/if}
  {@render children?.()}
  {#if expanded !== undefined}
    <Icon svg={icons.chevronDown} class={["size-18 text-muted transition-transform duration-fast", expanded && "rotate-180"].filter(Boolean).join(" ")} />
  {/if}
  {#if external}
    <Icon svg={icons.externalLink} class="size-18 text-muted" />
  {:else if arrow}
    <Icon svg={icons.arrow} class={["size-18 rotate-180 text-muted", disabled && "invisible"].filter(Boolean).join(" ")} />
  {/if}
</svelte:element>

<script module lang="ts">
  /** The dot on Settings and its rows: a ready update pulses lime; a due backup stays cyan. */
  export const dotClass = (state: "ready" | "due" | "") => [
    "absolute -top-2 -right-2 size-10 rounded-full",
    state === "ready" && "block animate-pulse bg-neon-add shadow-[0_0_0_2px_var(--bg),0_0_8px_var(--neon-add)]",
    state === "due" && "block bg-neon-saved shadow-[0_0_0_2px_var(--bg),0_0_8px_var(--neon-saved)]",
    !state && "hidden",
  ];
</script>
