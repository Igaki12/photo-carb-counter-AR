import type { GeometryMeasurement, MeasurementMethod, ShapeModel } from "../types/domain";

export const SHAPE_LABELS: Record<ShapeModel, string> = {
  box: "直方体",
  ellipsoid: "楕円体",
  "elliptic-cylinder": "楕円柱",
  frustum: "円錐台",
  extruded: "輪郭押し出し",
  mound: "皿上の山",
};

export function volumeForShape(
  shape: ShapeModel,
  dimensions: { length: number; width: number; height: number; topLength?: number; topWidth?: number },
  projectedAreaMm2?: number,
): number {
  const length = Math.max(0, dimensions.length);
  const width = Math.max(0, dimensions.width);
  const height = Math.max(0, dimensions.height);
  const footprint = projectedAreaMm2 && projectedAreaMm2 > 0 ? projectedAreaMm2 : Math.PI * length * width / 4;
  let mm3 = 0;
  switch (shape) {
    case "box":
      mm3 = length * width * height;
      break;
    case "ellipsoid":
      mm3 = Math.PI * length * width * height / 6;
      break;
    case "elliptic-cylinder":
      mm3 = Math.PI * length * width * height / 4;
      break;
    case "frustum": {
      const bottomArea = Math.PI * length * width / 4;
      const topArea = Math.PI * Math.max(0, dimensions.topLength ?? length * 0.82) * Math.max(0, dimensions.topWidth ?? width * 0.82) / 4;
      mm3 = height * (bottomArea + Math.sqrt(bottomArea * topArea) + topArea) / 3;
      break;
    }
    case "extruded":
      mm3 = footprint * height;
      break;
    case "mound":
      mm3 = footprint * height * 0.5;
      break;
  }
  return Math.round((mm3 / 1000) * 10) / 10;
}

export function createGeometryMeasurement(params: {
  method: MeasurementMethod;
  shape: ShapeModel;
  dimensionsMm: GeometryMeasurement["dimensionsMm"];
  projectedAreaMm2?: number;
  relativeUncertainty?: number;
  calibration?: Partial<GeometryMeasurement["calibration"]>;
  reasons?: string[];
  explicitVolumeMl?: number;
}): GeometryMeasurement {
  const relative = Math.max(0.03, params.relativeUncertainty ?? 0.15);
  const volumeMl = params.explicitVolumeMl ?? volumeForShape(params.shape, params.dimensionsMm, params.projectedAreaMm2);
  const reasons = params.reasons ?? [];
  return {
    method: params.method,
    dimensionsMm: params.dimensionsMm,
    projectedAreaMm2: params.projectedAreaMm2,
    volumeMl,
    shape: params.shape,
    calibration: {
      kind: params.method === "webxr-caliper" ? "webxr" : params.method === "manual" ? "manual" : "apriltag",
      ...params.calibration,
    },
    uncertainty: {
      relativePercent: Math.round(relative * 100),
      lowerVolumeMl: Math.round(Math.max(0, volumeMl * (1 - relative)) * 10) / 10,
      upperVolumeMl: Math.round(volumeMl * (1 + relative) * 10) / 10,
      reasons,
    },
    qualityReasons: reasons,
  };
}

export function defaultShapeForFood(name: string, groupName: string): ShapeModel {
  const text = `${name} ${groupName}`.toLowerCase();
  if (/drink|beverage|coffee|tea|latte|milk|juice|飲料|コーヒー|茶/.test(text)) return "frustum";
  if (/sandwich|bread|cake|tofu|サンド|パン|ケーキ|豆腐/.test(text)) return "box";
  if (/rice|pasta|noodle|ごはん|米|めん|盛り/.test(text)) return "mound";
  if (/apple|orange|potato|fruit|りんご|みかん|果実|いも/.test(text)) return "ellipsoid";
  return "elliptic-cylinder";
}
