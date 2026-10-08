import test from "node:test";
import assert from "node:assert/strict";
import { detectorInput } from "../src/ocr/detector";
import {
  probabilityRegions,
  regionPoint,
  sameRegion,
} from "../src/ocr/regions";

test("detector preprocessing preserves the model's BGR ordering and normalization", () => {
  const tensor = detectorInput(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
  assert.deepEqual(tensor.dims, [1, 3, 1, 1]);
  const values = tensor.data as Float32Array;
  assert.ok(Math.abs(values[0]! - (30 / 255 - 0.485) / 0.229) < 1e-6);
  assert.ok(Math.abs(values[1]! - (20 / 255 - 0.456) / 0.224) < 1e-6);
  assert.ok(Math.abs(values[2]! - (10 / 255 - 0.406) / 0.225) < 1e-6);
  tensor.dispose();
});

test("probability components produce oriented boxes and reject empty/low-confidence regions", () => {
  for (const angle of [0.3, Math.PI / 2, -0.9]) {
    const data = new Float32Array(128 * 128);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const dx = x - 64,
          dy = y - 64;
        if (Math.abs(c * dx + s * dy) < 30 && Math.abs(-s * dx + c * dy) < 6)
          data[y * 128 + x] = 0.9;
      }
    const regions = probabilityRegions(data, 128, 128, 256, 256);
    assert.equal(regions.length, 1);
    const region = regions[0]!;
    assert.ok(Math.hypot(region.center.x - 128, region.center.y - 128) < 1);
    assert.ok(Math.abs(Math.cos(region.angle - angle)) > 0.999);
    assert.ok(
      region.width > 120 && region.height > 24,
      "shrunken text interiors are expanded before cropping",
    );
    assert.equal(
      sameRegion(region, { ...region, angle: region.angle + Math.PI }),
      true,
    );
    assert.equal(
      sameRegion(region, { ...region, center: regionPoint(region, 200, 0) }),
      false,
    );
  }
  assert.deepEqual(
    probabilityRegions(new Float32Array(16 * 16), 16, 16, 16, 16),
    [],
  );
  assert.deepEqual(
    probabilityRegions(new Float32Array(16 * 16).fill(0.4), 16, 16, 16, 16),
    [],
  );
});
