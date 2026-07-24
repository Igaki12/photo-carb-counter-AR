import type { CarbComponent, CarbEstimate, FoodItem, QuestionAnswer, WeightEstimate } from "../types/domain";

export const CAUTION_TEXT =
  "本アプリの推定値は研究目的の参考値です。治療判断やインスリン投与量の決定は医療専門職の指示に従ってください。";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateCarbEstimate(
  selectedFood: FoodItem,
  foods: FoodItem[],
  estimate: WeightEstimate,
  answers: QuestionAnswer[],
): CarbEstimate {
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const consumedRatio = Math.max(0, Math.min(1, Number(answers.find((answer) => answer.questionId === "consumed_ratio")?.value ?? 100) / 100));
  const components: CarbComponent[] = estimate.components.map((component) => {
    const food = component.foodId ? foodById.get(component.foodId) ?? selectedFood : selectedFood;
    const per100 = food.carbAvailableGPer100g ?? 0;
    return {
      label: component.label,
      grams: round1(component.grams * consumedRatio),
      carbsG: round1(component.grams * consumedRatio * per100 / 100),
      minCarbsG: round1(component.minGrams * consumedRatio * per100 / 100),
      maxCarbsG: round1(component.maxGrams * consumedRatio * per100 / 100),
      source: "measurement" as const,
    };
  });
  for (const answer of answers) {
    if (!answer.carbAdjustmentG) continue;
    components.push({
      label: answer.label,
      grams: 0,
      carbsG: round1(answer.carbAdjustmentG),
      minCarbsG: round1(answer.carbAdjustmentG * 0.75),
      maxCarbsG: round1(answer.carbAdjustmentG * 1.25),
      source: "question",
    });
  }
  return {
    totalCarbsG: round1(components.reduce((sum, item) => sum + item.carbsG, 0)),
    minCarbsG: round1(components.reduce((sum, item) => sum + item.minCarbsG, 0)),
    maxCarbsG: round1(components.reduce((sum, item) => sum + item.maxCarbsG, 0)),
    edibleGrams: round1(estimate.edibleGrams * consumedRatio),
    minEdibleGrams: round1(estimate.minEdibleGrams * consumedRatio),
    maxEdibleGrams: round1(estimate.maxEdibleGrams * consumedRatio),
    components,
    rationale: estimate.rationale,
    caution: CAUTION_TEXT,
  };
}
