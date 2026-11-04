<script lang="ts" module>
  export type SheetAction = {
    label: string;
    icon: string;
    danger?: boolean;
    /** Filled red, waiting for a second tap. */
    armed?: boolean;
    /** Stays open after the tap, as a Delete armed for a second one does. */
    stay?: boolean;
    action: () => void;
  };
  /** What a sheet acts on: an icon's markup, or a map's preview with its filter. */
  export type SheetIcon = string | { src: string; filter: string };
</script>

<script lang="ts">
  import { t } from "../i18n";
  import { showDialog } from "./dialog";
  import { icons } from "./icons";
  import HeaderButton from "./kit/HeaderButton.svelte";
  import Icon from "./kit/Icon.svelte";

  // A ⋯ opens its item's actions in a small dialog, at the bottom on phones:
  // what it acts on first, then the actions, and Delete set apart below them.
  // While it leaves, it keeps showing what it showed.
  let { open, title, detail, icon, actions, onclose }: {
    open: boolean; title: string; detail?: string; icon: SheetIcon; actions: SheetAction[]; onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  const regular = $derived(actions.filter((item) => !item.danger));
  const dangers = $derived(actions.filter((item) => item.danger));

  $effect(() => {
    if (open && !dialog.open) showDialog(dialog);
    else if (!open && dialog.open) dialog.close();
  });
  function run(item: SheetAction) {
    if (!item.stay) dialog.close();
    item.action();
  }
</script>

<!-- The body fills the dialog, so only the backdrop around it hits the dialog itself. -->
<dialog bind:this={dialog} aria-label={title} data-sheet class="p-0 [--accent:var(--neon-saved)]" {onclose}
  onclick={(event) => event.target === dialog && dialog.close()}>
  <div class="p-20">
    <div class="mb-16 flex items-center gap-12">
      {#if typeof icon === "string"}
        <span class="grid size-28 flex-none place-items-center [&>svg]:size-28"><Icon svg={icon} /></span>
      {:else}
        <span class="grid size-48 flex-none place-items-center overflow-hidden rounded-sm border border-accent/22">
          <img src={icon.src} alt="" draggable="false" style:filter={icon.filter} class="size-full object-cover" />
        </span>
      {/if}
      <div class="min-w-0 flex-1">
        <h2 class="m-0 truncate text-body leading-tight">{title}</h2>
        {#if detail}<small class="block truncate text-muted">{detail}</small>{/if}
      </div>
      <HeaderButton icon={icons.close} label={t("Close")} onclick={() => dialog.close()} />
    </div>
    {#if regular.length}
      <div class="grid overflow-hidden rounded-md border border-accent/22 [&>*+*]:border-t [&>*+*]:border-accent/14">
        {#each regular as item (item.label)}
          <button type="button" onclick={() => run(item)} class="flex min-h-52 items-center gap-12 px-16 py-8 text-left text-body font-semibold
            [&>svg]:size-20 [&>svg]:text-accent enabled:active:scale-100 enabled:active:bg-accent/12 enabled:hover:bg-accent/8">
            <Icon svg={item.icon} /><span>{item.label}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#each dangers as item, index (index)}
      <button type="button" onclick={() => run(item)} class={[
        "flex min-h-52 w-full items-center justify-start gap-12 rounded-md border px-16 py-8 text-left text-body font-semibold [&>svg]:size-20",
        regular.length && "mt-12",
        item.armed
          ? "border-danger bg-danger text-[#1a0703]"
          : "border-danger/30 tint-danger/8 text-danger enabled:active:tint-danger/24 enabled:hover:tint-danger/22",
      ]}><Icon svg={item.icon} /><span>{item.label}</span></button>
    {/each}
  </div>
</dialog>
