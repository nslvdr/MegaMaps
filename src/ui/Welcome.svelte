<script lang="ts">
  import { t } from "../i18n";
  import { preference, setPreference } from "../preferences";
  import { track } from "../stats";
  import { keepFormOpen, showDialog } from "./dialog";
  import { icons } from "./icons";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";

  let { hasExample, importMap, openExample }: {
    /** Whether there is, or soon will be, an example map to try. */
    hasExample(): boolean;
    importMap(): void;
    openExample(): void;
  } = $props();
  let dialog: HTMLDialogElement;
  let example = $state(false);

  /** A new device is asked once whether to import a map or try the example,
   *  and must pick one. A device that already has maps knows its way.
   *  Returns whether it showed anything. */
  export function atLaunch(hasMaps: boolean) {
    if (preference("tour") === "seen") return false;
    setPreference("tour", "seen");
    if (hasMaps) return false;
    example = hasExample();
    showDialog(dialog);
    return true;
  }

  function answer(choice: "import" | "example") {
    track("welcome_answered", { choice });
    dialog.close();
    if (choice === "import") importMap();
    else openExample();
  }
</script>

<dialog bind:this={dialog} id="welcome" aria-labelledby="welcome-title" oncancel={keepFormOpen}>
  <DialogHeader id="welcome-title" title={t("Your maps, offline")} icon={icons.map} />
  <p>{t("Open big maps on your phone, even with no signal. Plan routes, mark places and share them with friends.")}</p>
  <Actions>
    <Button id="welcome-import" icon={icons.download} label={t("Import a map")} onclick={() => answer("import")} />
    <Button id="welcome-example" variant="quiet" icon={icons.sparkle} label={t("Try the example first")} hidden={!example}
      onclick={() => answer("example")} />
  </Actions>
</dialog>
