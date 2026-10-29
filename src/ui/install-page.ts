import { language, t } from "../i18n";
import { setPreference } from "../preferences";
import { dialogHeader, showDialog } from "./dialog";
import { icons } from "./icons";
import { fakePlan } from "./landing-map";

type Browser = Pick<Navigator, "userAgent" | "maxTouchPoints"> & { standalone?: boolean };
/** Chrome's own install sheet, offered once the app is installable. */
type InstallPrompt = Event & { prompt(): Promise<void> };

/** Opened from the home screen, not in a browser tab. iOS also reports it on navigator. */
export function isInstalled(view: Pick<Window, "matchMedia"> & { navigator: Browser } = window) {
  return view.navigator.standalone === true || view.matchMedia("(display-mode: standalone)").matches;
}

// iPadOS calls itself a Mac; only its touch screen tells it apart.
export const isApple = ({ userAgent, maxTouchPoints }: Browser) =>
  /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

const logo = (size: number) => `<img src="/icons/icon.svg" alt="" width="${size}" height="${size}" draggable="false">`;
const row = (icon: string, label: string, detail: string) =>
  `<li class="share-row"><span class="share-row-icon">${icon}</span><span class="share-row-label">${label}<small>${detail}</small></span></li>`;
export const installMarkup = `<section id="install" class="landing" aria-labelledby="landing-title" hidden>
<button type="button" id="landing-language">${language === "fr" ? "English" : "Français"}</button>
<div class="landing-intro">${logo(88)}<h1 id="landing-title">Mega Maps</h1><p>${t("A reader for underground plans that works offline.")}</p></div>
<button type="button" class="primary install-open">${icons.download}<span>${t("Install")}</span></button>
</section>
<dialog id="install-dialog" class="install-dialog" aria-labelledby="install-title">${dialogHeader("install-title", t("Install Mega Maps"), icons.download, "install-close")}
<p>${t("Three taps, and Mega Maps lives on your home screen, full screen and offline.")}</p>
<button type="button" class="primary" id="install-now" hidden>${icons.download}<span>${t("Install now")}</span></button>
<div class="install-demo" id="install-demo" data-step="0" aria-hidden="true"></div>
<ol class="share-summary install-steps" id="install-steps"></ol>
<p class="dialog-note" id="install-note"></p></dialog>`;

// A phone acting out the steps: the browser, its install menu, then the home screen.
function demo(apple: boolean, host: string) {
  const target = (step: number, inner: string, className = "") =>
    `<span class="demo-target ${className}" data-for="${step}">${inner}</span>`;
  const menuRow = (icon: string, label: string) => `${icon}<span>${label}</span>`;
  const page = `<div class="demo-page">${logo(56)}<span>Mega Maps</span></div>`;
  const address = `<span class="demo-address">${host}</span>`;
  const home = `<div class="demo-home">${'<span class="demo-app"></span>'.repeat(4)}${target(2, `${logo(48)}<span>Mega Maps</span>`, "demo-app demo-mega")}${'<span class="demo-app"></span>'.repeat(4)}</div>`;
  return `<div class="demo-phone">${apple
    ? `${page}<div class="demo-bar demo-bottom"><span class="demo-icon">${icons.arrow}</span>${address}${target(0, icons.shareApple, "demo-icon")}</div>
<div class="demo-sheet"><span class="demo-row">${menuRow(icons.copy, t("Copy"))}</span>${target(1, menuRow(icons.addToHome, t("Add to Home Screen")), "demo-row")}</div>`
    : `<div class="demo-bar demo-top">${address}${target(0, icons.browserMenu, "demo-icon")}</div>${page}
<div class="demo-menu"><span class="demo-row">${menuRow(icons.plus, t("New tab"))}</span>${target(1, menuRow(icons.download, t("Install app")), "demo-row")}</div>`}${home}</div>`;
}

const STEP_TIME = 2600;

/** Shows the landing page; its Install buttons open steps for this phone. */
export function initInstallPage(page: HTMLElement, dialog: HTMLDialogElement, browser: Browser = navigator, events: EventTarget = window, host = location.host) {
  const part = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  const installNow = part<HTMLButtonElement>("install-now");
  const demoBox = part("install-demo");
  const stepList = part("install-steps");
  const apple = isApple(browser);
  let prompt: InstallPrompt | undefined;
  let installed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  demoBox.innerHTML = demo(apple, host);
  const showStep = (step: number) => {
    demoBox.dataset.step = String(step);
    stepList.querySelectorAll("li").forEach((item, index) => item.toggleAttribute("aria-current", index === step));
  };
  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => showStep((Number(demoBox.dataset.step) + 1) % 3), STEP_TIME);
  };

  const render = () => {
    const manual = !prompt && !installed;
    const open = row(icons.phone, t("Open Mega Maps from your home screen"), t("Import your maps there, not in the browser"));
    // Imports made in a tab stay in the tab, so every path ends in the app.
    stepList.innerHTML = (manual
      ? apple
        ? row(icons.shareApple, t("Tap Share"), t("At the bottom of Safari, or in its ••• menu"))
          + row(icons.addToHome, t("Choose Add to Home Screen"), t("Scroll down the list if you don’t see it"))
        : row(icons.browserMenu, t("Open the browser menu"), t("Next to the address bar"))
          + row(icons.download, t("Choose Install app"), t("Or Add to Home screen"))
      : "") + open;
    installNow.hidden = !prompt;
    demoBox.hidden = !manual;
    part("install-note").textContent = installed
      ? t("Installed. Open Mega Maps from your home screen to import your maps.")
      : apple ? t("On iPhone and iPad, Safari and the app don’t share maps.") : "";
    if (manual) showStep(0);
  };

  events.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    render();
  });
  events.addEventListener("appinstalled", () => {
    prompt = undefined;
    installed = true;
    render();
  });
  // The sheet opens once; if dismissed, the manual steps take over.
  installNow.addEventListener("click", () => {
    const shown = prompt;
    prompt = undefined;
    render();
    void shown?.prompt().catch(() => {});
  });
  // Tapping a step shows it, then the demo carries on from there.
  stepList.addEventListener("click", (event) => {
    const item = (event.target as Element).closest("li");
    if (demoBox.hidden || !item) return;
    showStep([...stepList.children].indexOf(item));
    play();
  });
  for (const button of page.querySelectorAll(".install-open"))
    button.addEventListener("click", () => {
      showStep(0);
      play();
      showDialog(dialog);
    });
  part("install-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => clearInterval(timer));
  page.querySelector("#landing-language")!.addEventListener("click", () => {
    setPreference("language", language === "fr" ? "en" : "fr");
    location.reload();
  });
  render();
  // Drawn only here: an installed app never shows this page.
  page.insertAdjacentHTML("afterbegin", fakePlan());
  page.hidden = false;
}
