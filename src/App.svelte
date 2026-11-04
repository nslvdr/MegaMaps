<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { app } from "./ui/app-state.svelte";
  import ActionSheet from "./ui/ActionSheet.svelte";
  import InstallPage from "./ui/InstallPage.svelte";
  import Library from "./ui/Library.svelte";
  import LibraryDialogs from "./ui/LibraryDialogs.svelte";
  import MapViewer from "./ui/map/MapViewer.svelte";
  import MapRename from "./ui/MapRename.svelte";
  import ReceiveDialog from "./ui/ReceiveDialog.svelte";
  import Settings from "./ui/Settings.svelte";
  import ShareDialog from "./ui/ShareDialog.svelte";
  import UpdateDialog from "./ui/UpdateDialog.svelte";
  import Welcome from "./ui/Welcome.svelte";
  import WhatsNew from "./ui/WhatsNew.svelte";

  // Every screen and dialog of the app. main.ts runs the app: it changes the
  // app state and calls on the parts it returns.
  let { library, dialogs, settings: settingsProps, updates: updatesProps, welcome: welcomeProps, rename: renameProps, receive: receiveProps, closeMap }: {
    library: Omit<ComponentProps<typeof Library>, "openImport">;
    dialogs: ComponentProps<typeof LibraryDialogs>;
    settings: ComponentProps<typeof Settings>;
    updates: ComponentProps<typeof UpdateDialog>;
    welcome: Omit<ComponentProps<typeof Welcome>, "importMap">;
    rename: ComponentProps<typeof MapRename>;
    receive: ComponentProps<typeof ReceiveDialog>;
    /** Back from an open map to the library. */
    closeMap: () => void;
  } = $props();

  let home: Library, libraryDialogs: LibraryDialogs, settings: Settings, updates: UpdateDialog, welcome: Welcome,
    whatsNew: WhatsNew, rename: MapRename, share: ShareDialog, receive: ReceiveDialog;
  /** The parts main.ts calls on, once mounted. */
  export const parts = () => ({ home, dialogs: libraryDialogs, settings, updates, welcome, whatsNew, rename, share, receive });
</script>

<Library bind:this={home} {...library} openImport={() => libraryDialogs.openImport()} />
<Settings bind:this={settings} {...settingsProps} />
{#if app.page === "install"}<InstallPage />{/if}
<MapViewer controls={app.controls} back={closeMap} hidden={app.page !== "viewer"} />

<LibraryDialogs bind:this={libraryDialogs} {...dialogs} />
<ActionSheet open={app.sheet.open} title={app.sheet.title} detail={app.sheet.detail} icon={app.sheet.icon} actions={app.sheet.actions}
  onclose={() => (app.sheet.open = false)} />
<MapRename bind:this={rename} {...renameProps} />
<ShareDialog bind:this={share} />
<ReceiveDialog bind:this={receive} {...receiveProps} />
<UpdateDialog bind:this={updates} {...updatesProps} />
<Welcome bind:this={welcome} {...welcomeProps} importMap={() => libraryDialogs.openImport()} />
<WhatsNew bind:this={whatsNew} />
