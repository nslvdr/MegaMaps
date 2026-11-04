<script lang="ts">
  import { locale, t } from "../../i18n";
  import { preference } from "../../preferences";
  import { speedDelays } from "../../viewer/compass";
  import { NORTH_MAX, NORTH_MIN } from "../../viewer/navigation";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { fieldHelp, panelCard, panelRow, rowIcon, rowText } from "./styles";

  // Rotation is one list: each row is a mode, or Compass mode with how it
  // follows; the chosen row is tinted and checked. Auto's speeds and the map's
  // north offset only show for Compass mode.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const view = $derived.by(() => {
    controls.tick;
    const mode = controls.state.rotationMode;
    return { mode, follow: preference("compass-follow"), speed: preference("compass-speed"), north: controls.state.northOffset,
      help: controls.compassHelp() };
  });
  const choices = [
    { id: "rotation-locked", label: t("Locked"), help: t("Rotation is locked."), icon: icons.rotationLock },
    { id: "rotation-free", label: t("Manual"), help: t("Turn the map freely with two fingers."), icon: icons.freeRotation },
    { id: "compass-follow-tap", label: t("Tap"), help: t("Double-tap the map to orient it with the compass."), icon: icons.followTap },
    { id: "compass-follow-auto", label: t("Auto"), help: t("The map follows the compass on its own."), icon: icons.compass },
  ] as const;
  const chosen = (id: (typeof choices)[number]["id"]) =>
    id === "rotation-locked" ? view.mode === "locked" : id === "rotation-free" ? view.mode === "free"
    : view.mode === "compass" && id === `compass-follow-${view.follow}`;
  function pick(id: (typeof choices)[number]["id"]) {
    if (id === "rotation-locked") controls.setRotationMode("locked");
    else if (id === "rotation-free") controls.setRotationMode("free");
    else controls.pickFollow(id === "compass-follow-tap" ? "tap" : "auto");
  }
  // Slowest first, as one pill; the line below says how long a heading must hold.
  const speeds = [["mid", t("Mid"), icons.speedMid], ["high", t("High"), icons.speedHigh], ["live", t("Live"), icons.speedLive]] as const;
  // A wheel of whole degrees, like the iOS Clock picker; the middle one is chosen.
  const degrees = Array.from({ length: NORTH_MAX - NORTH_MIN + 1 }, (_, i) => NORTH_MIN + i);
  const fill = "absolute inset-0 m-0 size-full cursor-pointer opacity-0";
</script>

{#snippet choice(item: (typeof choices)[number])}
  {@const on = chosen(item.id)}
  <label class={[panelRow, "relative cursor-pointer", on && !(item.id === "compass-follow-auto") && "bg-c/7"]}>
    <input type="radio" name="rotation" id={item.id} checked={on} onchange={() => pick(item.id)}
      onclick={() => item.id.startsWith("compass") && controls.retryCompass()} class="pointer-events-none absolute opacity-0" />
    <span class={[rowIcon, !on && "bg-fill! text-muted!"]}><Icon svg={item.icon} /></span>
    <span class={rowText}><strong>{item.label}</strong><small class="text-small leading-compact text-muted">{item.help}</small></span>
    <Icon svg={icons.check} class={["size-20 text-c", !on && "invisible"].filter(Boolean).join(" ")} />
  </label>
{/snippet}

<div id="sheet-rotation" {hidden}>
  <div class={panelCard}>
    {#each choices.slice(0, 3) as item (item.id)}{@render choice(item)}{/each}
    <!-- Auto and its speeds read as one tinted block while Auto is chosen. -->
    <div class={chosen("compass-follow-auto") ? "bg-c/7" : ""}>
      {@render choice(choices[3])}
      <div id="speed-field" hidden={view.mode !== "compass" || view.follow !== "auto"} class="px-12 pb-12">
        <div role="radiogroup" aria-label={t("Speed")} aria-describedby="speed-help"
          class="grid auto-cols-fr grid-flow-col gap-4 rounded-pill border border-line bg-fill p-4">
          {#each speeds as [speed, label, icon] (speed)}
            <label class="relative flex min-h-44 min-w-0 cursor-pointer items-center justify-center gap-4 rounded-pill text-small font-medium text-muted
              has-checked:text-text has-checked:tint-c/18 has-checked:inset-ring has-checked:inset-ring-c/45 has-checked:[&>svg]:text-c">
              <input type="radio" name="compass-speed" id="compass-speed-{speed}" checked={view.speed === speed}
                onchange={() => controls.pickSpeed(speed)} class={fill} /><Icon svg={icon} class="size-18 flex-none" /><span>{label}</span>
            </label>
          {/each}
        </div>
        <!-- Live costs a lot of battery, so that warning gets its own line. -->
        <p id="speed-help" class={[fieldHelp, "mb-0"]}>
          {#if view.speed === "live"}{t("Instant.")}<span class="block text-danger">{t("Very hungry for battery.")}</span>
          {:else}{t("Turns after {seconds} s in the same direction.", { seconds: (speedDelays[view.speed] / 1000).toLocaleString(locale) })}{/if}
        </p>
      </div>
    </div>
  </div>
  <!-- Each row explains its mode, so the line below the list only reports the compass. -->
  <p id="rotation-help" role="status" hidden={!view.help} class={fieldHelp}>{view.help}</p>
  <div id="north-field" hidden={view.mode !== "compass"} class={[panelCard, "mt-12"]}>
    <div class={panelRow}>
      <span class={rowIcon}><Icon svg={icons.north} /></span>
      <span class={rowText}><strong id="north-label">{t("North offset")}</strong><small id="north-help"
        class="text-small leading-compact text-muted">{t("Turn clockwise if the map’s top isn’t north")}</small></span>
      <!-- The band marks the chosen degree; an empty row above and below lets the
           first and last degrees reach the middle. -->
      <div class="relative w-84 shrink-0 rounded-sm before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-32 before:rounded-sm before:bg-c/18">
        <div id="north-offset" role="spinbutton" aria-labelledby="north-label" aria-describedby="north-help" aria-valuemin={NORTH_MIN}
          aria-valuemax={NORTH_MAX} aria-valuenow={view.north} aria-valuetext={t("{degrees}° clockwise", { degrees: view.north })}
          onscroll={(event) => controls.northScrolled(event.currentTarget.scrollTop)}
          class="no-scrollbar relative h-96 snap-y snap-mandatory overflow-y-auto overscroll-contain [mask-image:linear-gradient(transparent,#000_35%,#000_65%,transparent)]
            before:block before:h-32 before:content-[''] after:block after:h-32 after:content-['']">
          {#each degrees as degree (degree)}
            <span aria-hidden="true" data-selected={degree === view.north || undefined}
              class={["block h-32 snap-center text-center text-body leading-[32px] tabular-nums", degree === view.north ? "font-strong text-text" : "text-muted"]}
              >{String(degree).replace("-", "−")}°</span>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
