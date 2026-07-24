import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateCarbEstimate } from "../app/lib/carb.ts";
import { createGeometryMeasurement } from "../app/lib/geometry.ts";
import { estimateMass, parseVolumeMl } from "../app/lib/portion.ts";
import type { FoodItem, WeightEstimate } from "../app/types/domain.ts";

const foods = JSON.parse(await readFile(new URL("../public/data/foods.json", import.meta.url), "utf8")) as FoodItem[];
const latte = foods.find((food) => food.name === "Coffee, Latte")!;
const sandwich = foods.find((food) => food.name === "Cheese sandwich, NFS")!;

function localWeightEstimate(food: FoodItem, measurement: WeightEstimate["measurement"], evidence: WeightEstimate["massEvidence"]): WeightEstimate {
  return {
    selectedFoodName: food.name,
    visibleComponents: [food.name],
    edibleGrams: evidence.grams,
    minEdibleGrams: evidence.minGrams,
    maxEdibleGrams: evidence.maxGrams,
    confidence: 0.8,
    components: [{
      label: food.name,
      foodId: food.id,
      grams: evidence.grams,
      minGrams: evidence.minGrams,
      maxGrams: evidence.maxGrams,
      rationale: evidence.rationale,
    }],
    rationale: evidence.rationale,
    massEvidence: evidence,
    measurement,
  };
}

test("volume descriptions convert to millilitres", () => {
  assert.ok(Math.abs(parseVolumeMl("1 cup (8 fl oz)")! - 236.588) < 0.01);
  assert.ok(Math.abs(parseVolumeMl("1 fl oz")! - 29.5735) < 0.01);
});

test("latte uses FNDDS volume density", () => {
  const measurement = createGeometryMeasurement({ method: "manual", shape: "elliptic-cylinder", dimensionsMm: { length: 70, width: 70, height: 100 }, explicitVolumeMl: 240 });
  const evidence = estimateMass(latte, measurement, [], 1);
  assert.equal(evidence.source, "fndds-volume");
  assert.ok(evidence.grams >= 240 && evidence.grams <= 244);
});

test("sandwich uses count portion and calculates carbohydrates", () => {
  const measurement = createGeometryMeasurement({ method: "manual", shape: "box", dimensionsMm: { length: 120, width: 80, height: 50 } });
  const evidence = estimateMass(sandwich, measurement, [], 1);
  assert.equal(evidence.source, "fndds-count");
  assert.equal(evidence.grams, 102);
  const result = calculateCarbEstimate(sandwich, foods, localWeightEstimate(sandwich, measurement, evidence), []);
  assert.ok(Math.abs(result.totalCarbsG - 32.5) < 0.2);
});
