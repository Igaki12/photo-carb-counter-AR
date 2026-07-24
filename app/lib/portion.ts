import type { FoodItem, GeometryMeasurement, MassEvidence, RankedFood } from "../types/domain";

const ML_PER_CUP = 236.588;
const ML_PER_FL_OZ = 29.5735;
const ML_PER_TBSP = 14.7868;
const ML_PER_TSP = 4.92892;

export function parseVolumeMl(description: string): number | null {
  const text = description.toLowerCase().replace(/,/g, "");
  const parentheticalFlOz = text.match(/\((\d+(?:\.\d+)?)\s*fl\s*oz\)/);
  if (parentheticalFlOz) return Number(parentheticalFlOz[1]) * ML_PER_FL_OZ;
  const patterns: Array<[RegExp, number]> = [
    [/(\d+(?:\.\d+)?)\s*(?:ml|milliliters?)/, 1],
    [/(\d+(?:\.\d+)?)\s*(?:cups?|cup)/, ML_PER_CUP],
    [/(\d+(?:\.\d+)?)\s*fl\s*oz/, ML_PER_FL_OZ],
    [/(\d+(?:\.\d+)?)\s*(?:tbsp|tablespoons?)/, ML_PER_TBSP],
    [/(\d+(?:\.\d+)?)\s*(?:tsp|teaspoons?)/, ML_PER_TSP],
  ];
  for (const [pattern, multiplier] of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]) * multiplier;
  }
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function densitiesFor(food: FoodItem): Array<{ density: number; description: string }> {
  return (food.portions ?? []).flatMap((portion) => {
    const ml = parseVolumeMl(portion.description);
    if (!ml || portion.gramWeight <= 0) return [];
    const density = portion.gramWeight / ml;
    return density >= 0.15 && density <= 2.2 ? [{ density, description: portion.description }] : [];
  });
}

export function estimateMass(
  food: FoodItem,
  measurement: GeometryMeasurement,
  rankedFoods: RankedFood[],
  manualDensity?: number,
): MassEvidence {
  const own = densitiesFor(food);
  const neighbor = rankedFoods.filter((item) => item.food.id !== food.id).flatMap((item) => densitiesFor(item.food));
  if (own.length) {
    const values = own.map((item) => item.density);
    const density = median(values);
    const densityLow = percentile(values, 0.2);
    const densityHigh = percentile(values, 0.8);
    const grams = measurement.volumeMl * density;
    return {
      source: "fndds-volume",
      grams: Math.round(grams),
      minGrams: Math.round(measurement.uncertainty.lowerVolumeMl * Math.min(density, densityLow)),
      maxGrams: Math.round(measurement.uncertainty.upperVolumeMl * Math.max(density, densityHigh)),
      densityGPerMl: Math.round(density * 1000) / 1000,
      densityRange: [Math.round(densityLow * 1000) / 1000, Math.round(densityHigh * 1000) / 1000],
      portionDescription: own[0]?.description,
      edibleFraction: 1,
      rationale: "FNDDSの容積ポーション重量から見かけ密度を計算しました。",
    };
  }

  const countPortion = (food.portions ?? []).find((portion) =>
    !/quantity not specified/i.test(portion.description) && !parseVolumeMl(portion.description) && portion.gramWeight > 0,
  );
  if (countPortion) {
    const spread = Math.max(0.18, measurement.uncertainty.relativePercent / 100);
    return {
      source: "fndds-count",
      grams: Math.round(countPortion.gramWeight),
      minGrams: Math.round(countPortion.gramWeight * (1 - spread)),
      maxGrams: Math.round(countPortion.gramWeight * (1 + spread)),
      portionDescription: countPortion.description,
      edibleFraction: 1,
      rationale: `FNDDSの「${countPortion.description}」の重量を実測形状で照合しました。`,
    };
  }

  if (neighbor.length) {
    const values = neighbor.map((item) => item.density);
    const density = median(values);
    const densityLow = percentile(values, 0.2);
    const densityHigh = percentile(values, 0.8);
    return {
      source: "embedding-neighbor",
      grams: Math.round(measurement.volumeMl * density),
      minGrams: Math.round(measurement.uncertainty.lowerVolumeMl * Math.min(density, densityLow)),
      maxGrams: Math.round(measurement.uncertainty.upperVolumeMl * Math.max(density, densityHigh)),
      densityGPerMl: Math.round(density * 1000) / 1000,
      densityRange: [Math.round(densityLow * 1000) / 1000, Math.round(densityHigh * 1000) / 1000],
      portionDescription: neighbor[0]?.description,
      edibleFraction: 1,
      rationale: "近いFNDDS食品の容積ポーションから密度範囲を補いました。",
    };
  }

  const density = Math.max(0.15, Math.min(2.2, manualDensity ?? 1));
  const grams = measurement.volumeMl * density;
  return {
    source: "manual",
    grams: Math.round(grams),
    minGrams: Math.round(measurement.uncertainty.lowerVolumeMl * density * 0.85),
    maxGrams: Math.round(measurement.uncertainty.upperVolumeMl * density * 1.15),
    densityGPerMl: density,
    densityRange: [density * 0.85, density * 1.15],
    edibleFraction: 1,
    rationale: "入力した見かけ密度と実測体積から重量を計算しました。",
  };
}
