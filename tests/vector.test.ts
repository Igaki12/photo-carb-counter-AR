import assert from "node:assert/strict";
import test from "node:test";
import { dotProduct, normalizeVector } from "../app/lib/vector.ts";

test("normalized dot product preserves ranking semantics", () => {
  const query = normalizeVector([0.9, 0.1]);
  assert.ok(dotProduct(query, [1, 0]) > dotProduct(query, [0, 1]));
  assert.ok(Math.abs(Math.hypot(...query) - 1) < 1e-12);
});
