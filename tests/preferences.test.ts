import test from "node:test";
import assert from "node:assert/strict";
import { preference, resetPreferences, setPreference } from "../src/preferences";

test("a choice storage refuses still applies for the session, and is saved once storage takes it", () => {
  const setItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  };
  try {
    assert.doesNotThrow(() => setPreference("label-size", "large"));
    assert.equal(preference("label-size"), "large");
  } finally {
    localStorage.setItem = setItem;
  }
  setPreference("label-size", "standard");
  assert.equal(localStorage.getItem("megamaps:label-size"), "standard");
  assert.equal(preference("label-size"), "standard");
  setPreference("label-size", "large");
  resetPreferences();
  assert.equal(preference("label-size"), "standard");
});
