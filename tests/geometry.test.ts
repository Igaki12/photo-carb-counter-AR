import assert from "node:assert/strict";
import test from "node:test";
import { createGeometryMeasurement, defaultShapeForFood, volumeForShape } from "../app/lib/geometry.ts";

test("shape volumes use millimetres and return millilitres", () => {
  assert.equal(volumeForShape("box", { length: 100, width: 100, height: 100 }), 1000);
  assert.equal(volumeForShape("elliptic-cylinder", { length: 100, width: 100, height: 100 }), 785.4);
  assert.equal(volumeForShape("ellipsoid", { length: 100, width: 100, height: 100 }), 523.6);
  assert.equal(volumeForShape("mound", { length: 100, width: 100, height: 100 }, 8000), 400);
});

test("measurement propagates uncertainty", () => {
  const result = createGeometryMeasurement({ method: "webxr-caliper", shape: "box", dimensionsMm: { length: 100, width: 80, height: 50 }, relativeUncertainty: 0.1 });
  assert.equal(result.volumeMl, 400);
  assert.equal(result.uncertainty.lowerVolumeMl, 360);
  assert.equal(result.uncertainty.upperVolumeMl, 440);
});

test("food names select editable shape defaults", () => {
  assert.equal(defaultShapeForFood("Coffee, Latte", "Beverages"), "frustum");
  assert.equal(defaultShapeForFood("Cheese sandwich, NFS", "Sandwiches"), "box");
});
