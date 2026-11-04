<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "./Icon.svelte";
  import TopEdge from "./TopEdge.svelte";
  // A page of its own over the library, such as Settings: Back returns. Only its
  // content slides in from the side, so the fixed top edge stays put.
  let { id, title, hidden = false, back, class: className = "", children }:
    { id: string; title: string; hidden?: boolean; back: () => void; class?: string; children: Snippet } = $props();
</script>

<section {id} {hidden} aria-labelledby="{id}-title"
  class={["mr-auto ml-(--surface-left) w-(--surface-width) pt-(--home-top) pb-[calc(16px+env(safe-area-inset-bottom))]", className]}>
  <TopEdge />
  <div class="animate-enter [--enter-from:translateX(32px)]">
    <header class="mb-8 flex items-center gap-12">
      <button type="button" id="{id}-back" aria-label={t("Back")} title={t("Back")} onclick={back}
        class="grid size-44 flex-none place-items-center rounded-full border border-neon-view/40 bg-black text-neon-view
          enabled:active:tint-neon-view/18 [&>svg]:size-22"><Icon svg={icons.arrow} /></button>
      <h1 id="{id}-title" class="m-0 text-heading font-bold tracking-tighter">{title}</h1>
    </header>
    {@render children()}
  </div>
</section>
