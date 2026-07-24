import type { FoodItem, RankedFood } from "../types/domain";

export function rankFoodsByText(foods: FoodItem[], query: string, limit = 20): RankedFood[] {
  const tokens = query.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  return foods
    .map((food) => {
      const haystack = `${food.name} ${food.groupName} ${food.note} ${food.searchText}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token.toLowerCase()) ? 1 : 0), 0) / tokens.length;
      return { food, score, rank: 0, source: "text" as const };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name, "ja"))
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function hydrateRankedFoods(
  foods: FoodItem[],
  scores: Array<{ foodId: string; score: number }>,
): RankedFood[] {
  const byId = new Map(foods.map((food) => [food.id, food]));
  return scores.flatMap((score, index) => {
    const food = byId.get(score.foodId);
    return food ? [{ food, score: score.score, rank: index + 1, source: "embedding" as const }] : [];
  });
}
