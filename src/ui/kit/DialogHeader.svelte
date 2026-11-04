<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import HeaderButton from "./HeaderButton.svelte";
  import Icon from "./Icon.svelte";
  // A dialog's heading: its coloured icon, the title, any header actions, and,
  // unless a choice is required, an explicitly labelled Close.
  let {
    id, title, icon, close, closeLabel = t("Close"), closeDisabled = false, closeArmed = false,
    class: className = "", subtitle, actions,
  }: {
    /** The title's id; its icon is `${id}-icon`. */
    id?: string; title: string; icon: string;
    close?: { id?: string; onclick: (event: MouseEvent) => void };
    closeLabel?: string; closeDisabled?: boolean; closeArmed?: boolean; class?: string;
    /** Under the title, such as when a place was last updated. */
    subtitle?: Snippet;
    /** Header buttons before Close, such as Edit. */
    actions?: Snippet;
  } = $props();
</script>

<div class={["mb-16 flex items-start gap-8", className]}>
  <span id={id && `${id}-icon`} aria-hidden="true"
    class="mt-[calc((var(--header-line-height)-24px)/2)] grid size-24 flex-none place-items-center text-accent"><Icon svg={icon} /></span>
  {#if subtitle}
    <div class="min-w-0 flex-1">
      <h2 {id} class="m-0 leading-(--header-line-height)">{title}</h2>
      {@render subtitle()}
    </div>
  {:else}
    <h2 {id} class="m-0 min-w-0 flex-1 leading-(--header-line-height)">{title}</h2>
  {/if}
  {@render actions?.()}
  {#if close}
    <HeaderButton id={close.id} icon={icons.close} label={closeLabel} onclick={close.onclick} disabled={closeDisabled} armed={closeArmed} />
  {/if}
</div>
