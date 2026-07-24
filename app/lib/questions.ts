import type { FoodItem, QuestionAnswer } from "../types/domain";

export interface QuestionOption {
  value: string;
  label: string;
  carbAdjustmentG?: number;
}

export interface QuestionDefinition {
  id: string;
  label: string;
  kind: "single" | "multi" | "number" | "text";
  unit?: string;
  defaultValue?: string | number | string[];
  options?: QuestionOption[];
}

function contains(food: FoodItem, pattern: RegExp): boolean {
  return pattern.test(`${food.name} ${food.groupName} ${food.note}`);
}

export function getQuestionsForFood(food: FoodItem): QuestionDefinition[] {
  const questions: QuestionDefinition[] = [];
  if (food.group === "16" || contains(food, /coffee|tea|juice|latte|drink|beverage|milk|コーヒー|茶|飲料|ジュース/i)) {
    questions.push(
      { id: "consumed_ratio", label: "飲食した割合", kind: "number", unit: "%", defaultValue: 100 },
      { id: "added_sugar_tsp", label: "追加した砂糖", kind: "number", unit: "小さじ", defaultValue: 0 },
      {
        id: "syrup",
        label: "シロップ・甘味ソース",
        kind: "single",
        defaultValue: "none",
        options: [
          { value: "none", label: "なし" },
          { value: "small", label: "少量", carbAdjustmentG: 5 },
          { value: "standard", label: "標準", carbAdjustmentG: 12 },
          { value: "large", label: "多め", carbAdjustmentG: 20 },
        ],
      },
    );
  }
  if (food.group === "01" || contains(food, /bread|sandwich|rice|noodle|pasta|pizza|burger|パン|サンド|米|ごはん|めん/i)) {
    questions.push(
      { id: "consumed_ratio", label: "食べた割合", kind: "number", unit: "%", defaultValue: 100 },
      {
        id: "spread",
        label: "甘いソース・スプレッド",
        kind: "single",
        defaultValue: "none",
        options: [
          { value: "none", label: "なし" },
          { value: "small", label: "少量", carbAdjustmentG: 2 },
          { value: "standard", label: "標準", carbAdjustmentG: 6 },
          { value: "large", label: "多め", carbAdjustmentG: 12 },
        ],
      },
    );
  }
  if (food.group === "15" || contains(food, /cake|cookie|dessert|ice cream|菓子|ケーキ|デザート|アイス/i)) {
    questions.push({
      id: "sweet_extra",
      label: "クリーム・ジャム等の追加",
      kind: "single",
      defaultValue: "none",
      options: [
        { value: "none", label: "なし" },
        { value: "small", label: "少量", carbAdjustmentG: 6 },
        { value: "standard", label: "標準", carbAdjustmentG: 14 },
      ],
    });
  }
  if (!questions.some((item) => item.id === "consumed_ratio")) {
    questions.unshift({ id: "consumed_ratio", label: "食べた割合", kind: "number", unit: "%", defaultValue: 100 });
  }
  questions.push({ id: "notes", label: "補足情報", kind: "text", defaultValue: "" });
  return questions;
}

export function answersFromValues(questions: QuestionDefinition[], values: Record<string, unknown>): QuestionAnswer[] {
  return questions.map((question) => {
    const raw = values[question.id] ?? question.defaultValue ?? "";
    let adjustment = 0;
    if (question.id === "added_sugar_tsp") adjustment += Math.max(0, Number(raw) || 0) * 3;
    if (question.kind === "single") adjustment += question.options?.find((option) => option.value === raw)?.carbAdjustmentG ?? 0;
    return {
      questionId: question.id,
      label: question.label,
      value: raw as string | number | string[],
      unit: question.unit,
      carbAdjustmentG: adjustment,
    };
  });
}
