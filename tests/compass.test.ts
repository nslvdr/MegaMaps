import test from "node:test";
import assert from "node:assert/strict";
import { screenHeading } from "../src/viewer/compass";

const reading = (fields: Partial<DeviceOrientationEvent> & { webkitCompassHeading?: number }) =>
  ({ absolute: false, alpha: null, ...fields }) as DeviceOrientationEvent;

test("compass headings: iOS and Android readings agree, and follow a sideways screen", () => {
  // iOS gives a heading clockwise from north; Android a counterclockwise alpha.
  assert.equal(screenHeading(reading({ webkitCompassHeading: 90 }), 0), 90);
  assert.equal(screenHeading(reading({ absolute: true, alpha: 270 }), 0), 90);
  // A phone held sideways shows its right edge at the top of the screen.
  assert.equal(screenHeading(reading({ webkitCompassHeading: 300 }), 90), 30);
  assert.equal(screenHeading(reading({ webkitCompassHeading: 10 }), 270), 280);
  // Alpha relative to wherever the page loaded is not a compass.
  assert.equal(screenHeading(reading({ absolute: false, alpha: 120 }), 0), undefined);
  assert.equal(screenHeading(reading({ absolute: true, alpha: null }), 0), undefined);
});
