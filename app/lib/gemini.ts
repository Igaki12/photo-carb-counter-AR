import type {
  FoodItem,
  GeometryMeasurement,
  MassEvidence,
  QuestionAnswer,
  RankedFood,
  WeightEstimate,
} from "../types/domain";
import { normalizeVector } from "./vector";
import type { ImagePayload } from "./image";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_MODEL = "gemini-embedding-2";
const GENERATION_MODEL = "gemini-3.5-flash";

async function geminiFetch(apiKey: string, path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini API エラー (${response.status}): ${message.slice(0, 240)}`);
  }
  return response;
}

export async function testGeminiConnection(apiKey: string): Promise<void> {
  await geminiFetch(apiKey, `models/${GENERATION_MODEL}:generateContent`, {
    contents: [{ parts: [{ text: "Reply with OK." }] }],
    generationConfig: { maxOutputTokens: 8 },
  });
}

export async function embedFoodImage(apiKey: string, image: ImagePayload): Promise<number[]> {
  const response = await geminiFetch(apiKey, `models/${EMBEDDING_MODEL}:embedContent`, {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }] },
    outputDimensionality: 768,
  });
  const data = await response.json() as { embedding?: { values?: number[] } };
  if (!Array.isArray(data.embedding?.values) || data.embedding.values.length !== 768) {
    throw new Error("画像embeddingの形式が想定外です。");
  }
  return normalizeVector(data.embedding.values);
}

const componentSchema = {
  type: "OBJECT",
  required: ["visibleComponents", "confidence", "components", "rationale"],
  properties: {
    visibleComponents: { type: "ARRAY", items: { type: "STRING" } },
    confidence: { type: "NUMBER" },
    rationale: { type: "STRING" },
    components: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["label", "foodId", "share", "rationale"],
        properties: {
          label: { type: "STRING" },
          foodId: { type: "STRING" },
          share: { type: "NUMBER" },
          rationale: { type: "STRING" },
        },
      },
    },
  },
};

export function localWeightEstimate(
  selectedFood: FoodItem,
  measurement: GeometryMeasurement,
  evidence: MassEvidence,
): WeightEstimate {
  return {
    selectedFoodName: selectedFood.name,
    visibleComponents: [selectedFood.name],
    edibleGrams: evidence.grams,
    minEdibleGrams: evidence.minGrams,
    maxEdibleGrams: evidence.maxGrams,
    confidence: Math.max(0.25, 1 - measurement.uncertainty.relativePercent / 100),
    components: [{
      label: selectedFood.name,
      foodId: selectedFood.id,
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

export async function assistWeightWithGemini(params: {
  apiKey: string;
  image: ImagePayload;
  selectedFood: FoodItem;
  rankedFoods: RankedFood[];
  measurement: GeometryMeasurement;
  evidence: MassEvidence;
  answers: QuestionAnswer[];
}): Promise<WeightEstimate> {
  const { apiKey, image, selectedFood, rankedFoods, measurement, evidence, answers } = params;
  const allowedFoods = rankedFoods.slice(0, 12).map((item) => `${item.food.id}:${item.food.name}`).join(" / ");
  const prompt = [
    "あなたは研究用カーボカウントアプリの食品部品配分モジュールです。",
    "実測された総重量を変更せず、写真に見える主要部品へ配分してください。治療判断やインスリン量は出力しません。",
    `選択食品: ${selectedFood.id}:${selectedFood.name}`,
    `実測方法: ${measurement.method}, 形状: ${measurement.shape}`,
    `寸法mm: ${JSON.stringify(measurement.dimensionsMm)}, 体積mL: ${measurement.volumeMl}`,
    `固定する総重量: ${evidence.grams}g (${evidence.minGrams}-${evidence.maxGrams}g)`,
    `重量根拠: ${evidence.source}, ${evidence.rationale}`,
    `利用可能な食品ID: ${allowedFoods}`,
    `追加回答: ${answers.map((answer) => `${answer.label}=${String(answer.value)}`).join(" / ")}`,
    "components.shareは0から1で、合計を1にしてください。foodIdは利用可能な食品IDから選んでください。",
    "根拠は80字以内の日本語にしてください。",
  ].join("\n");
  const response = await geminiFetch(apiKey, `models/${GENERATION_MODEL}:generateContent`, {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: componentSchema, temperature: 0.15 },
  });
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Geminiの部品配分結果が空です。");
  const parsed = JSON.parse(text) as {
    visibleComponents: string[];
    confidence: number;
    rationale: string;
    components: Array<{ label: string; foodId: string; share: number; rationale: string }>;
  };
  const validIds = new Set([selectedFood.id, ...rankedFoods.slice(0, 12).map((item) => item.food.id)]);
  const positive = parsed.components.filter((item) => Number(item.share) > 0);
  const shareTotal = positive.reduce((sum, item) => sum + Number(item.share), 0) || 1;
  const components = positive.map((item) => {
    const share = Number(item.share) / shareTotal;
    return {
      label: item.label,
      foodId: validIds.has(item.foodId) ? item.foodId : selectedFood.id,
      grams: Math.round(evidence.grams * share),
      minGrams: Math.round(evidence.minGrams * share),
      maxGrams: Math.round(evidence.maxGrams * share),
      rationale: item.rationale,
    };
  });
  return {
    selectedFoodName: selectedFood.name,
    visibleComponents: parsed.visibleComponents,
    edibleGrams: evidence.grams,
    minEdibleGrams: evidence.minGrams,
    maxEdibleGrams: evidence.maxGrams,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
    components: components.length ? components : localWeightEstimate(selectedFood, measurement, evidence).components,
    rationale: parsed.rationale,
    massEvidence: { ...evidence, source: "gemini-assisted", rationale: `${evidence.rationale} Geminiは部品配分のみ補助しました。` },
    measurement,
  };
}
