import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_SCALE, exampleNavigation, exampleOcr } from "../src/example/example-map";
import { PLAN_HEIGHT, PLAN_WIDTH, scaleBar } from "../src/example/plan";
import { searchMap } from "../src/viewer/map-search";

test("search finds the example map's printed names, and where two galleries meet", () => {
  const index = exampleOcr("example");
  assert.equal(searchMap(index, [], "allee 25").length, 2);
  const [meeting, ...others] = searchMap(index, [], "Allée 25; Allée 55");
  assert.ok(meeting && !others.length, "the two names pair up once");
  assert.equal(meeting.polygons.length, 4, "both words of each name light up");
});

test("the example's places and route sit on its image, and its scale bar reads 20 m", () => {
  const navigation = exampleNavigation("example");
  const points = [...navigation.markers.map((marker) => marker.point), ...navigation.routes.flatMap((route) => route.points)];
  for (const { x, y } of points)
    assert.ok(x > 0 && y > 0 && x < PLAN_WIDTH * EXAMPLE_SCALE && y < PLAN_HEIGHT * EXAMPLE_SCALE, `${x}, ${y} is on the map`);
  const [left, right] = scaleBar;
  const metres = Math.hypot(right.x - left.x, right.y - left.y) * EXAMPLE_SCALE * navigation.metresPerPixel!;
  assert.equal(Math.round(metres), 20);
});
