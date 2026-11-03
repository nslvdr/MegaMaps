import { fr, frNouns } from "./locales/fr";
import { preference, type Preferences } from "./preferences";

export type Language = Preferences["language"];
/** English text is the key: a sentence missing from French fails to compile. */
export type Message = keyof typeof fr;
export type Noun = keyof typeof frNouns;
type Values = Record<string, string | number>;

// Read once: changing the language reloads the app.
export const language: Language = preference("language");
export const locale = language === "fr" ? "fr-FR" : "en";

/** Fills {name} placeholders after picking the language's sentence. */
export function translate(to: Language, text: Message, values: Values = {}) {
  const template: string = to === "fr" ? fr[text] : text;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match);
}

export const t = (text: Message, values?: Values) => translate(language, text, values);

/** "1 place", "2 places"; French counts 0 and 1 as singular: "0 lieu". */
export function pluralIn(to: Language, count: number, noun: Noun) {
  const one = to === "fr" ? count < 2 : count === 1;
  const word = to === "fr" ? frNouns[noun][one ? 0 : 1]
    : one ? noun : `${noun}${/(s|x|ch|sh)$/.test(noun) ? "es" : "s"}`;
  return `${count.toLocaleString(to === "fr" ? "fr-FR" : "en")} ${word}`;
}

export const plural = (count: number, noun: Noun) => pluralIn(language, count, noun);

/** What went wrong, in words people can act on: a browser's own file and
 * storage errors are terse, technical and never translated. */
export function errorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotReadableError")
    return t("This file can’t be read. If it’s in a cloud folder, save it to the device first, then try again.");
  if (name === "QuotaExceededError")
    return t("Not enough device storage. Delete a map or free space and try again.");
  return error instanceof Error ? error.message : String(error);
}
