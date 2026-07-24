export interface FoodPortion {
  description: string;
  gramWeight: number;
  sequenceNumber?: number;
  modifier?: string;
}

export interface FoodItem {
  id: string;
  foodNo: string;
  indexNo: string;
  group: string;
  groupName: string;
  name: string;
  searchText: string;
  carbAvailableGPer100g: number | null;
  carbMonosaccharideEqGPer100g: number | null;
  totalSugarsGPer100g?: number | null;
  fiberGPer100g?: number | null;
  energyKcalPer100g?: number | null;
  proteinGPer100g?: number | null;
  fatGPer100g?: number | null;
  isEstimated: boolean;
  isTrace: boolean;
  raw: { carbAvailable: string; carbMonosaccharideEq: string };
  note: string;
  portions?: FoodPortion[];
  fdcId?: number;
  source: { name: string; sheet?: string; dataType?: string; publicationDate?: string; unit: string };
}

export interface FoodEmbedding {
  foodId: string;
  vector: number[];
  model: string;
  dimensionality: number;
  normalized: boolean;
}

export interface RankedFood {
  food: FoodItem;
  score: number;
  rank: number;
  source: "embedding" | "text" | "manual";
}

export type MeasurementMethod =
  | "webxr-caliper"
  | "marker-two-view"
  | "marker-video-visual-hull"
  | "manual";

export type ShapeModel = "box" | "ellipsoid" | "elliptic-cylinder" | "frustum" | "extruded" | "mound";

export interface GeometryMeasurement {
  method: MeasurementMethod;
  dimensionsMm: {
    length: number;
    width: number;
    height: number;
    topLength?: number;
    topWidth?: number;
  };
  projectedAreaMm2?: number;
  volumeMl: number;
  shape: ShapeModel;
  calibration: {
    kind: "webxr" | "apriltag" | "manual";
    reprojectionErrorPx?: number;
    visibleMarkerCount?: number;
    frameCount?: number;
    viewCoverageDeg?: number;
    depthAvailable?: boolean;
  };
  uncertainty: {
    relativePercent: number;
    lowerVolumeMl: number;
    upperVolumeMl: number;
    reasons: string[];
  };
  qualityReasons: string[];
}

export type MassSource = "fndds-volume" | "fndds-count" | "embedding-neighbor" | "gemini-assisted" | "manual";

export interface MassEvidence {
  source: MassSource;
  grams: number;
  minGrams: number;
  maxGrams: number;
  densityGPerMl?: number;
  densityRange?: [number, number];
  portionDescription?: string;
  edibleFraction: number;
  rationale: string;
}

export interface EstimateComponent {
  label: string;
  foodId?: string;
  grams: number;
  minGrams: number;
  maxGrams: number;
  rationale?: string;
}

export interface WeightEstimate {
  selectedFoodName: string;
  visibleComponents: string[];
  edibleGrams: number;
  minEdibleGrams: number;
  maxEdibleGrams: number;
  confidence: number;
  components: EstimateComponent[];
  rationale: string;
  massEvidence: MassEvidence;
  measurement: GeometryMeasurement;
}

export interface QuestionAnswer {
  questionId: string;
  label: string;
  value: string | number | string[];
  unit?: string;
  carbAdjustmentG?: number;
}

export interface CarbComponent {
  label: string;
  grams: number;
  carbsG: number;
  minCarbsG: number;
  maxCarbsG: number;
  source: "measurement" | "question";
}

export interface CarbEstimate {
  totalCarbsG: number;
  minCarbsG: number;
  maxCarbsG: number;
  edibleGrams: number;
  minEdibleGrams: number;
  maxEdibleGrams: number;
  components: CarbComponent[];
  rationale: string;
  caution: string;
}

export interface EmbeddingChunk {
  url: string;
  count: number;
  bytes: number;
  sha256: string;
  scope: "fndds" | "mext";
}

export interface EmbeddingManifest {
  source: string;
  model: string;
  dimensionality: number;
  normalized: boolean;
  totalCount: number;
  chunks: EmbeddingChunk[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
