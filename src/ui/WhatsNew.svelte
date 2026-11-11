<script lang="ts" module>
  import type { Release } from "../changelog";
  const SEEN = "megamaps:changelog-seen";
  /** Takes an answer to a release's question, with the release's commit. */
  export type Answer = (text: string, release: string) => void;

  /** Releases this device hasn't shown yet. A device that never stored one is new,
   *  unless it already has maps: then it updated from before the changelog existed. */
  export function unseenReleases(releases: Release[], seen: string | null, hasMaps: boolean) {
    if (seen === null) return hasMaps ? releases.slice(0, 1) : [];
    const index = releases.findIndex((release) => release.commit === seen);
    return index === -1 ? [] : releases.slice(0, index);
  }
</script>

<script lang="ts">
  import { flushSync } from "svelte";
  import { changelog } from "../changelog";
  import { locale, t, type Message } from "../i18n";
  import { showDialog } from "./dialog";
  import { icons } from "./icons";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Rows from "./kit/Rows.svelte";
  import HelpLink from "./HelpLink.svelte";

  let { releases = changelog }: { releases?: Release[] } = $props();
  let dialog: HTMLDialogElement, body: HTMLElement, track: HTMLElement;
  /** What's shown: since the last launch as one list per kind, or every release under its date. */
  let shown = $state<{ dated: boolean; releases: Release[] }>({ dated: false, releases: [] });
  let more = $state(false), thumb = $state({ height: 0, offset: 0 });
  /** The release whose question follows Got it, and where its answer goes. */
  let asking = $state<{ release: string; answer: Answer }>();
  let question = $state(false), reply = $state("");

  const sections = [
    ["added", "New features", icons.add],
    ["changed", "Changes", icons.changed],
    ["fixed", "Bug fixes", icons.fixed],
  ] as const satisfies [keyof Release, Message, string][];
  const lists = (releases: Release[]) => sections.flatMap(([key, heading, icon]) => {
    const items = releases.flatMap((release) => release[key] ?? []);
    return items.length ? [{ heading: t(heading), icon, items: items.map((item) => t(item)) }] : [];
  });
  // Release dates are calendar days, so they read the same in every time zone.
  const day = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(date));

  // Phones fade their scrollbars out, so a drawn one stays visible to show
  // there is more to read.
  function indicate() {
    const hidden = body.scrollHeight - body.clientHeight;
    more = hidden >= 1;
    if (!more) return;
    const height = Math.max(32, (track.clientHeight * body.clientHeight) / body.scrollHeight);
    thumb = { height, offset: (body.scrollTop / hidden) * (track.clientHeight - height) };
  }
  function show(releases: Release[], dated: boolean) {
    shown = { dated, releases };
    question = false;
    reply = "";
    flushSync();
    body.scrollTop = 0;
    showDialog(dialog);
    indicate();
  }

  /** Settings shows every release, newest first, each under its date. */
  export function openAll() {
    asking = undefined;
    show(releases, true);
  }
  /** Shows what's new since the last launch. When another dialog has the
   *  screen, it waits for the next launch. A release that asks follows Got it
   *  with its question, when there's somewhere to send the answer. */
  export function atLaunch(hasMaps: boolean, free = true, answer?: Answer) {
    const latest = releases[0];
    if (!latest) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN);
    } catch {}
    const unseen = unseenReleases(releases, seen, hasMaps);
    if (unseen.length && !free) return;
    try {
      localStorage.setItem(SEEN, latest.commit);
    } catch {}
    if (!unseen.length) return;
    const ask = unseen.find((release) => release.ask);
    asking = ask && answer && { release: ask.commit, answer };
    show(unseen, false);
  }

  function send() {
    const text = reply.trim();
    if (!text || !asking) return;
    asking.answer(text, asking.release);
    dialog.close();
  }
</script>

<svelte:window onresize={() => dialog.open && indicate()} />

{#snippet changes(releases: Release[])}
  {#each lists(releases) as section (section.heading)}
    <section class="[&+&]:mt-16">
      <h3 class="m-0 mb-8 flex items-center gap-8 text-body text-accent"><Icon svg={section.icon} class="size-20" />{section.heading}</h3>
      <ul class="m-0 grid list-disc gap-8 pl-20 text-body leading-normal">
        {#each section.items as item, index (index)}
          {@const [before, after] = item.split(" → ")}
          <!-- "Before → after" lines get their arrow drawn in the accent colour. -->
          <li>{#if after === undefined}{item}{:else}{before}<span class="text-accent">{" → "}</span>{after}{/if}</li>
        {/each}
      </ul>
    </section>
  {/each}
{/snippet}

<!-- What's new fills the screen: the header stays on top, the lists scroll and
     Got it stays within thumb reach. A release that asks follows Got it with
     its question on a page of its own. -->
<dialog bind:this={dialog} id="whats-new" aria-labelledby={question ? "whats-new-question-title" : "whats-new-title"}
  class="inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden rounded-none border-0 shadow-none
    [--side:max(20px,(100vw-var(--surface-max-width))/2)] open:flex open:flex-col
    pt-[max(12px,env(safe-area-inset-top))] pr-[max(var(--side),env(safe-area-inset-right))]
    pb-[max(12px,env(safe-area-inset-bottom))] pl-[max(var(--side),env(safe-area-inset-left))]">
  <div class="flex min-h-0 flex-1 flex-col" hidden={question}>
    <DialogHeader id="whats-new-title" title={t("What’s new")} icon={icons.sparkle} class="shrink-0" />
    <div class="relative flex min-h-0 flex-1">
      <div bind:this={body} id="whats-new-sections" onscroll={indicate}
        class="no-scrollbar flex-1 overflow-y-auto overscroll-contain pr-16">
        {#if shown.dated}
          {#each shown.releases as release (release.commit)}
            <article class="[&+&]:mt-24 [&+&]:border-t [&+&]:border-line [&+&]:pt-24">
              <p class="m-0 mb-12 text-small text-muted">{day(release.date)}</p>
              {@render changes([release])}
            </article>
          {/each}
        {:else}
          {@render changes(shown.releases)}
        {/if}
      </div>
      <div bind:this={track} aria-hidden="true" hidden={!more}
        class="pointer-events-none absolute inset-y-0 right-0 w-4 rounded-pill bg-line">
        <span class="block rounded-pill bg-muted" style:height="{thumb.height}px" style:transform="translateY({thumb.offset}px)"></span>
      </div>
    </div>
    <!-- The question that follows asks for ideas itself. -->
    <Rows class="shrink-0" hidden={!!asking}>
      <HelpLink topic="idea" icon={icons.idea} tone="var(--neon-view)" label={t("Have an idea for next time?")} hint={t("Suggest it on GitHub")} />
    </Rows>
    <Actions class="mt-12! shrink-0"><Button id="whats-new-done" icon={icons.check} label={t("Got it")}
      onclick={() => (asking ? (question = true) : dialog.close())} /></Actions>
  </div>
  {#if question}
    <!-- Arrives from the side, as the next page; the header's Close skips it. -->
    <div class="flex min-h-0 flex-1 animate-enter flex-col [--enter-from:translateX(24px)]">
      <DialogHeader id="whats-new-question-title" title={t("One question")} icon={icons.idea} class="shrink-0"
        close={{ id: "whats-new-question-close", onclick: () => dialog.close() }} />
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <p id="whats-new-question" class="m-0 text-heading leading-tight font-bold">{t("What would you add to the app?")}</p>
        <p class="mt-4 mb-0 text-small text-muted">{t("We read every answer.")}</p>
        <!-- Long enough for an idea, short enough to go out with the usage stats. -->
        <label class="block"><textarea id="whats-new-answer" bind:value={reply} aria-labelledby="whats-new-question"
          maxlength="2000" placeholder={t("A feature, a tool, anything you miss underground…")}></textarea></label>
      </div>
      <Actions class="shrink-0"><Button id="whats-new-send" icon={icons.send} label={t("Send")} disabled={!reply.trim()} onclick={send} /></Actions>
    </div>
  {/if}
</dialog>
