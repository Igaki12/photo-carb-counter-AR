"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateCarbEstimate } from "../lib/carb";
import { createGeometryMeasurement, defaultShapeForFood, SHAPE_LABELS } from "../lib/geometry";
import { assistWeightWithGemini, embedFoodImage, localWeightEstimate, testGeminiConnection } from "../lib/gemini";
import { cropImageFile, type ImagePayload } from "../lib/image";
import { detectAprilTags, estimateHeightFromMarkerImage, measureCropOnMat, type MarkerImageResult } from "../lib/marker";
import { estimateMass } from "../lib/portion";
import { answersFromValues, getQuestionsForFood, type QuestionDefinition } from "../lib/questions";
import { hydrateRankedFoods, rankFoodsByText } from "../lib/ranking";
import { runVisualHull } from "../lib/visual-hull";
import { startXrCaliper, supportsImmersiveAr } from "../lib/xr-caliper";
import type {
  CarbEstimate,
  CropRect,
  FoodItem,
  GeometryMeasurement,
  MeasurementMethod,
  RankedFood,
  ShapeModel,
  WeightEstimate,
} from "../types/domain";

const INITIAL_CROP: CropRect = { x: 0.18, y: 0.14, width: 0.64, height: 0.72 };
const INITIAL_DIMS = { length: 120, width: 80, height: 55, topLength: 100, topWidth: 65 };
const METHOD_LABELS: Record<MeasurementMethod, string> = {
  "webxr-caliper": "ARノギス",
  "marker-two-view": "計測マット",
  "marker-video-visual-hull": "動画Visual Hull",
  manual: "寸法を手入力",
};

function format(value: number, digits = 1): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function CropEditor({ imageUrl, crop, onChange, compact = false }: {
  imageUrl: string;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
  compact?: boolean;
}) {
  const set = (key: keyof CropRect, value: number) => {
    const next = { ...crop, [key]: value };
    next.width = Math.min(next.width, 1 - next.x);
    next.height = Math.min(next.height, 1 - next.y);
    onChange(next);
  };
  return (
    <div className={compact ? "crop-editor compact" : "crop-editor"}>
      <div className="crop-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="切り抜き対象" src={imageUrl} />
        <div className="crop-mask top" style={{ height: `${crop.y * 100}%` }} />
        <div className="crop-mask left" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
        <div className="crop-mask right" style={{ left: `${(crop.x + crop.width) * 100}%`, top: `${crop.y * 100}%`, right: 0, height: `${crop.height * 100}%` }} />
        <div className="crop-mask bottom" style={{ top: `${(crop.y + crop.height) * 100}%`, bottom: 0 }} />
        <div className="crop-frame" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
          <span>食品だけを囲む</span>
        </div>
      </div>
      <div className="crop-controls">
        <label>左 <input aria-label="切り抜き左位置" type="range" min="0" max="0.8" step="0.01" value={crop.x} onChange={(event) => set("x", Number(event.target.value))} /></label>
        <label>上 <input aria-label="切り抜き上位置" type="range" min="0" max="0.8" step="0.01" value={crop.y} onChange={(event) => set("y", Number(event.target.value))} /></label>
        <label>幅 <input aria-label="切り抜き幅" type="range" min="0.15" max={1 - crop.x} step="0.01" value={crop.width} onChange={(event) => set("width", Number(event.target.value))} /></label>
        <label>高さ <input aria-label="切り抜き高さ" type="range" min="0.15" max={1 - crop.y} step="0.01" value={crop.height} onChange={(event) => set("height", Number(event.target.value))} /></label>
      </div>
    </div>
  );
}

function Status({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "error"; children: React.ReactNode }) {
  return <div className={`inline-status ${tone}`}>{children}</div>;
}

function QuestionFields({ questions, values, onChange }: {
  questions: QuestionDefinition[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
}) {
  return (
    <div className="question-grid">
      {questions.map((question) => (
        <label className="field" key={question.id}>
          <span>{question.label}{question.unit ? ` (${question.unit})` : ""}</span>
          {question.kind === "single" ? (
            <select value={String(values[question.id] ?? question.defaultValue ?? "")} onChange={(event) => onChange(question.id, event.target.value)}>
              {question.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : question.kind === "number" ? (
            <input type="number" min="0" value={Number(values[question.id] ?? question.defaultValue ?? 0)} onChange={(event) => onChange(question.id, Number(event.target.value))} />
          ) : (
            <input type="text" value={String(values[question.id] ?? "")} onChange={(event) => onChange(question.id, event.target.value)} placeholder="任意" />
          )}
        </label>
      ))}
    </div>
  );
}

export function CarbCounterApp() {
  const [apiKey, setApiKey] = useState("");
  const [connection, setConnection] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [dataError, setDataError] = useState("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [crop, setCrop] = useState<CropRect>(INITIAL_CROP);
  const [croppedPayload, setCroppedPayload] = useState<ImagePayload | null>(null);
  const [rankedFoods, setRankedFoods] = useState<RankedFood[]>([]);
  const [rankingState, setRankingState] = useState<"idle" | "embedding" | "ready" | "error">("idle");
  const [rankingProgress, setRankingProgress] = useState(0);
  const [rankingMessage, setRankingMessage] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);

  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  const [xrStatus, setXrStatus] = useState("ARCore対応を確認中です。");
  const xrOverlayRef = useRef<HTMLDivElement | null>(null);
  const [method, setMethod] = useState<MeasurementMethod>("webxr-caliper");
  const [shape, setShape] = useState<ShapeModel>("box");
  const [dimensions, setDimensions] = useState(INITIAL_DIMS);
  const [projectedArea, setProjectedArea] = useState<number | undefined>();
  const [explicitVolume, setExplicitVolume] = useState<number | undefined>();
  const [measurementReasons, setMeasurementReasons] = useState<string[]>(["寸法の確定待ち"]);
  const [depthAvailable, setDepthAvailable] = useState(false);

  const [printScaleMm, setPrintScaleMm] = useState(100);
  const [topFile, setTopFile] = useState<File | null>(null);
  const [topUrl, setTopUrl] = useState("");
  const [angleFile, setAngleFile] = useState<File | null>(null);
  const [topDetection, setTopDetection] = useState<MarkerImageResult | null>(null);
  const [angleDetection, setAngleDetection] = useState<MarkerImageResult | null>(null);
  const [markerCrop, setMarkerCrop] = useState<CropRect>({ x: 0.3, y: 0.25, width: 0.4, height: 0.5 });
  const [angleTopY, setAngleTopY] = useState(0.34);
  const [angleBaseY, setAngleBaseY] = useState(0.72);
  const [markerState, setMarkerState] = useState<"idle" | "detecting" | "ready" | "error">("idle");
  const [markerMessage, setMarkerMessage] = useState("");
  const [calibrationCount, setCalibrationCount] = useState(0);
  const [calibrationError, setCalibrationError] = useState<number | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [visualState, setVisualState] = useState<"idle" | "processing" | "ready" | "error">("idle");
  const [visualProgress, setVisualProgress] = useState(0);
  const [visualMessage, setVisualMessage] = useState("");
  const [voxelMm, setVoxelMm] = useState(5);
  const [viewCoverage, setViewCoverage] = useState(180);
  const [visualFrameCount, setVisualFrameCount] = useState<number | undefined>();

  const [manualDensity, setManualDensity] = useState(1);
  const [questionValues, setQuestionValues] = useState<Record<string, unknown>>({});
  const [weightEstimate, setWeightEstimate] = useState<WeightEstimate | null>(null);
  const [resultState, setResultState] = useState<"idle" | "calculating" | "ready" | "error">("idle");
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    fetch("/data/foods.json")
      .then((response) => { if (!response.ok) throw new Error(`${response.status}`); return response.json(); })
      .then((items: FoodItem[]) => setFoods(items))
      .catch((error: Error) => setDataError(`食品データを読み込めません: ${error.message}`));
    void supportsImmersiveAr().then((supported) => {
      setXrSupported(supported);
      setXrStatus(supported ? "ARノギスを利用できます。Depthは開始時に確認します。" : "WebXRを利用できません。計測マットまたは手入力へ進んでください。");
      if (!supported) setMethod("marker-two-view");
    });
    const stored = localStorage.getItem("pcc-ar-camera-calibration");
    if (stored) {
      try {
        const value = JSON.parse(stored) as { count: number; error: number };
        queueMicrotask(() => {
          setCalibrationCount(value.count);
          setCalibrationError(value.error);
        });
      } catch { /* ignore malformed local calibration */ }
    }
  }, []);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (topUrl) URL.revokeObjectURL(topUrl);
  }, [photoUrl, topUrl]);

  const questions = useMemo(() => selectedFood ? getQuestionsForFood(selectedFood) : [], [selectedFood]);
  const answers = useMemo(() => answersFromValues(questions, questionValues), [questions, questionValues]);
  const relativeUncertainty = method === "webxr-caliper" ? 0.12 : method === "marker-two-view" ? 0.15 : method === "marker-video-visual-hull" ? 0.2 : 0.25;
  const measurement: GeometryMeasurement = useMemo(() => createGeometryMeasurement({
    method,
    shape,
    dimensionsMm: dimensions,
    projectedAreaMm2: projectedArea,
    relativeUncertainty,
    explicitVolumeMl: method === "marker-video-visual-hull" ? explicitVolume : undefined,
    calibration: {
      visibleMarkerCount: topDetection?.detections.length,
      reprojectionErrorPx: topDetection ? measureSafeReprojection(topDetection, markerCrop) : undefined,
      frameCount: visualFrameCount,
      viewCoverageDeg: method === "marker-video-visual-hull" ? viewCoverage : undefined,
      depthAvailable,
    },
    reasons: measurementReasons,
  }), [method, shape, dimensions, projectedArea, relativeUncertainty, explicitVolume, topDetection, markerCrop, visualFrameCount, viewCoverage, depthAvailable, measurementReasons]);
  const carbEstimate: CarbEstimate | null = useMemo(() => selectedFood && weightEstimate ? calculateCarbEstimate(selectedFood, foods, weightEstimate, answers) : null, [selectedFood, foods, weightEstimate, answers]);

  async function connectGemini() {
    setConnection("testing");
    setConnectionMessage("");
    try {
      await testGeminiConnection(apiKey.trim());
      setConnection("ok");
      setConnectionMessage("接続できました。キーはこの画面のメモリ内だけで使用します。");
    } catch (error) {
      setConnection("error");
      setConnectionMessage(error instanceof Error ? error.message : "接続できませんでした。");
    }
  }

  function selectFood(food: FoodItem | null) {
    setSelectedFood(food);
    if (food) {
      setShape(defaultShapeForFood(food.name, food.groupName));
      const initial: Record<string, unknown> = {};
      for (const question of getQuestionsForFood(food)) initial[question.id] = question.defaultValue ?? "";
      setQuestionValues(initial);
    } else {
      setQuestionValues({});
    }
    setWeightEstimate(null);
    setResultState("idle");
  }

  function choosePhoto(file: File | null) {
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
    setCrop(INITIAL_CROP);
    setCroppedPayload(null);
    setRankedFoods([]);
    selectFood(null);
    setRankingState("idle");
    setWeightEstimate(null);
  }

  async function classifyPhoto() {
    if (!photoFile || !apiKey.trim()) return;
    setRankingState("embedding");
    setRankingProgress(0);
    setRankingMessage("食品だけを切り抜き、画像embeddingを生成しています。");
    try {
      const payload = await cropImageFile(photoFile, crop);
      setCroppedPayload(payload);
      const vector = await embedFoodImage(apiKey.trim(), payload);
      const rankingWorker = new Worker("/workers/ranking-worker.js");
      const scores = await new Promise<Array<{ foodId: string; score: number }>>((resolve, reject) => {
        rankingWorker.onmessage = (event: MessageEvent<{ type: string; processed?: number; total?: number; scores?: Array<{ foodId: string; score: number }>; error?: string }>) => {
          if (event.data.type === "progress") setRankingProgress(Math.round(((event.data.processed ?? 0) / (event.data.total ?? 7970)) * 100));
          if (event.data.type === "error") { rankingWorker.terminate(); reject(new Error(event.data.error)); }
          if (event.data.type === "complete") { rankingWorker.terminate(); resolve(event.data.scores ?? []); }
        };
        rankingWorker.onerror = () => { rankingWorker.terminate(); reject(new Error("ランキングWorkerを開始できません。")); };
        rankingWorker.postMessage({ vector, manifestUrl: "/data/embeddings/manifest.json" });
      });
      const ranked = hydrateRankedFoods(foods, scores);
      setRankedFoods(ranked);
      selectFood(ranked[0]?.food ?? null);
      setRankingProgress(100);
      setRankingState("ready");
      setRankingMessage("7,970食品との正規化ベクトル内積を計算しました。");
    } catch (error) {
      setRankingState("error");
      setRankingMessage(`${error instanceof Error ? error.message : "分類に失敗しました。"} 手動検索は利用できます。`);
    }
  }

  function searchFoods(query: string) {
    setManualQuery(query);
    const matches = rankFoodsByText(foods, query, 20);
    setRankedFoods(matches);
    if (matches.length) setRankingState("ready");
  }

  async function beginXr() {
    if (!xrOverlayRef.current) return;
    setMethod("webxr-caliper");
    setXrStatus("ARを開始しています。");
    try {
      await startXrCaliper({
        overlay: xrOverlayRef.current,
        onStatus: setXrStatus,
        onComplete: (result) => {
          setDimensions((current) => ({ ...current, length: result.length, width: result.width, height: result.height }));
          setDepthAvailable(result.depthAvailable);
          setMeasurementReasons([result.depthAvailable ? "Depth対応ヒット点を使用" : "平面ヒット点を使用", `位置ジッター ${result.jitterMm}mm`]);
          setXrStatus("6点のAR計測が完了しました。寸法を確認してください。");
        },
      });
    } catch (error) {
      setXrStatus(error instanceof Error ? error.message : "ARを開始できませんでした。");
      setMethod("marker-two-view");
    }
  }

  async function detectMarkerImages() {
    if (!topFile || !angleFile) return;
    if (printScaleMm < 99 || printScaleMm > 101) {
      setMarkerState("error");
      setMarkerMessage("100mm確認線が99〜101mmになるよう、実際のサイズ100%で再印刷してください。");
      return;
    }
    setMarkerState("detecting");
    setMarkerMessage("端末内でAprilTagを検出しています。画像は送信しません。");
    try {
      const [top, angle] = await Promise.all([detectAprilTags(topFile), detectAprilTags(angleFile)]);
      setTopDetection(top);
      setAngleDetection(angle);
      if (top.detections.length < 3 || angle.detections.length < 3) throw new Error("各画像で3個以上のタグを写してください。");
      setMarkerState("ready");
      setMarkerMessage(`上面 ${top.detections.length}個 / 斜め ${angle.detections.length}個のタグを検出しました。`);
    } catch (error) {
      setMarkerState("error");
      setMarkerMessage(error instanceof Error ? error.message : "マーカー検出に失敗しました。");
    }
  }

  async function calibrateCamera(files: FileList | null) {
    if (!files?.length) return;
    setMarkerState("detecting");
    setMarkerMessage("5方向の校正画像を確認しています。");
    try {
      const selected = Array.from(files).slice(0, 5);
      const results = [] as MarkerImageResult[];
      for (const file of selected) results.push(await detectAprilTags(file));
      const valid = results.filter((item) => item.detections.length >= 3);
      const error = valid.length ? valid.reduce((sum, item) => sum + item.reprojectionErrorPx, 0) / valid.length : 99;
      setCalibrationCount(valid.length);
      setCalibrationError(Math.round(error * 100) / 100);
      localStorage.setItem("pcc-ar-camera-calibration", JSON.stringify({ count: valid.length, error }));
      setMarkerState(valid.length >= 5 ? "ready" : "error");
      setMarkerMessage(valid.length >= 5 ? "5方向の校正を端末内に保存しました。" : `有効な校正画像は${valid.length}/5枚です。各3タグ以上写して撮り直してください。`);
    } catch (error) {
      setMarkerState("error");
      setMarkerMessage(error instanceof Error ? error.message : "校正に失敗しました。");
    }
  }

  function applyMarkerMeasurement() {
    if (!topDetection || !angleDetection) return;
    try {
      const planar = measureCropOnMat(topDetection, markerCrop);
      const height = estimateHeightFromMarkerImage(angleDetection, angleBaseY, angleTopY);
      if (planar.reprojectionErrorPx > 2) throw new Error(`再投影誤差が${planar.reprojectionErrorPx}pxです。2px以下になるよう撮り直してください。`);
      setMethod("marker-two-view");
      setDimensions((current) => ({ ...current, length: planar.length, width: planar.width, height: Math.max(1, height) }));
      setProjectedArea(planar.area);
      setExplicitVolume(undefined);
      setMeasurementReasons([`上面${topDetection.detections.length}タグ`, `再投影誤差${planar.reprojectionErrorPx}px`, "斜め画像の高さ点を使用"]);
      setMarkerState("ready");
      setMarkerMessage("マット座標へ射影して寸法を反映しました。");
    } catch (error) {
      setMarkerState("error");
      setMarkerMessage(error instanceof Error ? error.message : "寸法を計算できませんでした。");
    }
  }

  async function processVisualHull() {
    if (!videoFile) return;
    if (viewCoverage < 120) {
      setVisualState("error");
      setVisualMessage("視点範囲は120度以上にしてください。");
      return;
    }
    setVisualState("processing");
    setVisualProgress(0);
    setVisualMessage("12フレームを抽出し、端末内でシルエットを交差しています。");
    try {
      const result = await runVisualHull({ file: videoFile, dimensions, voxelMm, viewCoverageDeg: viewCoverage, onProgress: setVisualProgress });
      setMethod("marker-video-visual-hull");
      setExplicitVolume(result.volumeMl);
      setVisualFrameCount(result.frameCount);
      setMeasurementReasons([`${result.frameCount}フレーム`, `${viewCoverage}度の視点範囲`, `${result.voxelMm}mmボクセル`, "凹部を埋める上限推定"]);
      setVisualState("ready");
      setVisualProgress(100);
      setVisualMessage(`Visual Hull体積 ${format(result.volumeMl)}mL。凹形状では過大になるため上限推定として扱います。`);
    } catch (error) {
      setVisualState("error");
      setVisualMessage(`${error instanceof Error ? error.message : "動画処理に失敗しました。"} 2画像または単純形状へ戻ってください。`);
      setMethod("marker-two-view");
    }
  }

  async function calculateResult() {
    if (!selectedFood || dimensions.length <= 0 || dimensions.width <= 0 || dimensions.height <= 0) return;
    setResultState("calculating");
    setResultMessage("実測体積と食品ポーションを照合しています。");
    try {
      const evidence = estimateMass(selectedFood, measurement, rankedFoods, manualDensity);
      let estimate = localWeightEstimate(selectedFood, measurement, evidence);
      if (apiKey.trim() && croppedPayload) {
        try {
          estimate = await assistWeightWithGemini({ apiKey: apiKey.trim(), image: croppedPayload, selectedFood, rankedFoods, measurement, evidence, answers });
          setResultMessage("実測重量を固定し、Geminiで複合食品の部品配分だけを補助しました。");
        } catch {
          setResultMessage("Geminiの部品配分は使わず、実測体積と食品データだけで計算しました。");
        }
      }
      setWeightEstimate(estimate);
      setResultState("ready");
    } catch (error) {
      setResultState("error");
      setResultMessage(error instanceof Error ? error.message : "結果を計算できませんでした。");
    }
  }

  const completed = [Boolean(apiKey), Boolean(photoFile), Boolean(selectedFood), measurement.volumeMl > 0, Boolean(weightEstimate), Boolean(carbEstimate)];

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="app-icon" alt="" src="/assets/app-icon.png" />
          <div><p className="eyebrow">PHOTO CARB COUNTER / AR</p><h1>食品ARノギス</h1></div>
          <span className="research-chip">研究用</span>
        </div>
        <p className="header-copy">食品だけを撮影し、実寸・体積・食品成分表から炭水化物量を推定します。</p>
        <ol className="stepper" aria-label="進行状況">
          {["キー", "撮影", "分類", "計測", "確認", "結果"].map((label, index) => <li className={completed[index] ? "done" : ""} key={label}><span>{index + 1}</span>{label}</li>)}
        </ol>
      </header>

      <div className="medical-notice"><strong>参考推定</strong><span>医療機器ではありません。治療判断・インスリン投与量の決定には使用しないでください。</span></div>
      {dataError ? <Status tone="error">{dataError}</Status> : null}

      <section className="panel" id="api">
        <div className="section-title"><span>01</span><div><h2>Gemini APIキー</h2><p>食品分類と部品配分に使用。保存・記録しません。</p></div></div>
        <div className="inline-form">
          <input aria-label="Gemini APIキー" autoComplete="off" type="password" value={apiKey} placeholder="APIキーを入力" onChange={(event) => { setApiKey(event.target.value); setConnection("idle"); }} />
          <button disabled={!apiKey.trim() || connection === "testing"} onClick={connectGemini}>{connection === "testing" ? "確認中…" : "接続確認"}</button>
        </div>
        {connectionMessage ? <Status tone={connection === "ok" ? "ok" : connection === "error" ? "error" : "neutral"}>{connectionMessage}</Status> : null}
      </section>

      <section className="panel" id="photo">
        <div className="section-title"><span>02</span><div><h2>食品だけを撮影・切り抜き</h2><p>手は写さず、食品領域だけを囲むと分類のぶれを抑えられます。</p></div></div>
        <label className="file-button">カメラまたは写真を選ぶ<input hidden accept="image/*" capture="environment" type="file" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} /></label>
        {photoUrl ? <CropEditor imageUrl={photoUrl} crop={crop} onChange={setCrop} /> : <div className="empty-media"><span>＋</span><p>手・伝票・カトラリーを避け、食品を中央に写してください。</p></div>}
        <button className="primary-wide" disabled={!photoFile || !apiKey.trim() || rankingState === "embedding"} onClick={classifyPhoto}>{rankingState === "embedding" ? `内積計算中 ${rankingProgress}%` : "切り抜きを確定して食品分類"}</button>
        {rankingMessage ? <Status tone={rankingState === "error" ? "warn" : rankingState === "ready" ? "ok" : "neutral"}>{rankingMessage}</Status> : null}
      </section>

      <section className="panel" id="food">
        <div className="section-title"><span>03</span><div><h2>食品候補を確定</h2><p>768次元の正規化ベクトル内積Top-20。手動検索も常に利用できます。</p></div></div>
        <div className="search-row"><input aria-label="食品名検索" value={manualQuery} placeholder="例: latte / サンドイッチ / ごはん" onChange={(event) => searchFoods(event.target.value)} /><span>{foods.length ? `${format(foods.length, 0)}件` : "読込中"}</span></div>
        {rankedFoods.length ? (
          <div className="candidate-list">
            {rankedFoods.map((item) => (
              <button className={selectedFood?.id === item.food.id ? "candidate selected" : "candidate"} key={item.food.id} onClick={() => selectFood(item.food)}>
                <span className="rank">{item.rank}</span><span className="candidate-main"><strong>{item.food.name}</strong><small>{item.food.groupName} · {item.food.source.name}</small></span>
                <span className="score">{item.source === "embedding" ? item.score.toFixed(3) : "検索"}</span>
              </button>
            ))}
          </div>
        ) : <div className="empty-copy">画像分類または食品名検索で候補を表示します。</div>}
      </section>

      <section className="panel" id="measurement">
        <div className="section-title"><span>04</span><div><h2>デジタルノギスで実寸計測</h2><p>ARを優先し、非対応・不安定時は計測マットへ切り替えます。</p></div></div>
        <div className="method-tabs" role="tablist">
          {(Object.keys(METHOD_LABELS) as MeasurementMethod[]).map((value) => <button role="tab" aria-selected={method === value} className={method === value ? "active" : ""} key={value} onClick={() => setMethod(value)}>{METHOD_LABELS[value]}{value === "marker-video-visual-hull" ? <small>実験</small> : null}</button>)}
        </div>

        {method === "webxr-caliper" ? (
          <div className="measurement-box">
            <div className="capability-row"><span className={xrSupported ? "cap-dot ok" : "cap-dot"} /> <strong>{xrSupported === null ? "確認中" : xrSupported ? "ARCore / WebXR 対応" : "WebXR 非対応"}</strong><span>Depth: 開始時に検出</span></div>
            <p>長さ・幅・高さの各始点と終点、合計6点を中央照準で記録します。10フレームの揺れが5mm以下になった時だけ確定できます。</p>
            <button className="primary-wide" disabled={!xrSupported} onClick={beginXr}>ARノギスを開始</button>
            <Status tone={xrSupported ? "ok" : "warn"}>{xrStatus}</Status>
          </div>
        ) : null}

        {method === "marker-two-view" ? (
          <div className="measurement-box">
            <div className="download-row"><div><strong>A4 AprilTag計測マット</strong><p>実際のサイズ100%で印刷してください。</p></div><a className="link-button" href="/assets/photo-carb-counter-measurement-mat-a4.pdf" download>PDFを保存</a></div>
            <label className="field"><span>印刷後の100mm確認線</span><div className="unit-input"><input type="number" min="90" max="110" step="0.5" value={printScaleMm} onChange={(event) => setPrintScaleMm(Number(event.target.value))} /><em>mm</em></div></label>
            <div className="calibration-box"><div><strong>初回カメラ校正</strong><p>マット全体を異なる5方向から撮影。各画像3タグ以上。</p><small>{calibrationCount}/5枚 {calibrationError !== null ? `· 推定誤差 ${calibrationError.toFixed(2)}px` : ""}</small></div><label className="secondary-button">校正画像を選ぶ<input hidden multiple accept="image/*" type="file" onChange={(event) => void calibrateCamera(event.target.files)} /></label></div>
            <div className="two-files">
              <label className="file-button secondary">真上画像<input hidden accept="image/*" capture="environment" type="file" onChange={(event) => { const file = event.target.files?.[0] ?? null; setTopFile(file); if (file) { if (topUrl) URL.revokeObjectURL(topUrl); setTopUrl(URL.createObjectURL(file)); } }} /></label>
              <label className="file-button secondary">斜め画像<input hidden accept="image/*" capture="environment" type="file" onChange={(event) => setAngleFile(event.target.files?.[0] ?? null)} /></label>
            </div>
            {topUrl ? <><p className="micro-label">真上画像で食品の外形を囲む</p><CropEditor compact imageUrl={topUrl} crop={markerCrop} onChange={setMarkerCrop} /></> : null}
            <div className="angle-points">
              <label>斜め画像の上端 <input type="range" min="0.05" max="0.9" step="0.01" value={angleTopY} onChange={(event) => setAngleTopY(Number(event.target.value))} /></label>
              <label>斜め画像の底面 <input type="range" min="0.1" max="0.95" step="0.01" value={angleBaseY} onChange={(event) => setAngleBaseY(Number(event.target.value))} /></label>
            </div>
            <div className="button-pair"><button disabled={!topFile || !angleFile || markerState === "detecting"} onClick={detectMarkerImages}>タグを検出</button><button className="secondary-action" disabled={!topDetection || !angleDetection} onClick={applyMarkerMeasurement}>寸法を反映</button></div>
            {markerMessage ? <Status tone={markerState === "error" ? "error" : markerState === "ready" ? "ok" : "neutral"}>{markerMessage}</Status> : null}
          </div>
        ) : null}

        {method === "marker-video-visual-hull" ? (
          <div className="measurement-box">
            <div className="experimental-banner"><strong>実験機能</strong><span>凹部を埋めやすいため、体積の上限推定として表示します。</span></div>
            <p>食品とマットを動かさず、カメラを半周以上ゆっくり動かして5〜10秒撮影してください。動画は端末外へ送信しません。</p>
            <label className="file-button">周回動画を選ぶ<input hidden accept="video/*" capture="environment" type="file" onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)} /></label>
            <div className="settings-row"><label className="field"><span>ボクセル</span><select value={voxelMm} onChange={(event) => setVoxelMm(Number(event.target.value))}><option value="2">2 mm（高負荷）</option><option value="5">5 mm</option><option value="8">8 mm（軽量）</option></select></label><label className="field"><span>撮影範囲</span><select value={viewCoverage} onChange={(event) => setViewCoverage(Number(event.target.value))}><option value="120">120度</option><option value="180">180度</option><option value="270">270度</option><option value="360">360度</option></select></label></div>
            <button className="primary-wide" disabled={!videoFile || visualState === "processing"} onClick={processVisualHull}>{visualState === "processing" ? `ボクセル処理中 ${visualProgress}%` : "Visual Hullを計算"}</button>
            {visualMessage ? <Status tone={visualState === "error" ? "error" : visualState === "ready" ? "ok" : "neutral"}>{visualMessage}</Status> : null}
          </div>
        ) : null}

        <div className="dimension-editor">
          <div className="dimension-head"><strong>計測値の確認</strong><span>単位 mm · 必要なら修正可</span></div>
          <div className="dimension-grid">
            {(["length", "width", "height"] as const).map((key) => <label className="field" key={key}><span>{key === "length" ? "長さ" : key === "width" ? "幅" : "高さ"}</span><input type="number" min="1" max="1000" value={dimensions[key]} onChange={(event) => { setDimensions((current) => ({ ...current, [key]: Number(event.target.value) })); setMeasurementReasons((current) => [...current.filter((item) => item !== "ユーザーが寸法を補正"), "ユーザーが寸法を補正"]); }} /></label>)}
          </div>
          <label className="field"><span>形状モデル</span><select value={shape} onChange={(event) => setShape(event.target.value as ShapeModel)}>{(Object.keys(SHAPE_LABELS) as ShapeModel[]).map((value) => <option value={value} key={value}>{SHAPE_LABELS[value]}</option>)}</select></label>
          {shape === "frustum" ? <div className="dimension-grid two"><label className="field"><span>上面の長さ</span><input type="number" min="1" value={dimensions.topLength} onChange={(event) => setDimensions((current) => ({ ...current, topLength: Number(event.target.value) }))} /></label><label className="field"><span>上面の幅</span><input type="number" min="1" value={dimensions.topWidth} onChange={(event) => setDimensions((current) => ({ ...current, topWidth: Number(event.target.value) }))} /></label></div> : null}
          <div className="measurement-summary"><div><span>推定体積</span><strong>{format(measurement.volumeMl)} <small>mL</small></strong></div><div><span>範囲</span><strong>{format(measurement.uncertainty.lowerVolumeMl)}–{format(measurement.uncertainty.upperVolumeMl)} <small>mL</small></strong></div><div><span>方法</span><strong className="method-name">{METHOD_LABELS[method]}</strong></div></div>
        </div>
      </section>

      <section className="panel" id="confirm">
        <div className="section-title"><span>05</span><div><h2>食べた量と追加情報</h2><p>選択食品に応じた補正だけを追加します。</p></div></div>
        {selectedFood ? <>
          <div className="selected-food"><div><span>選択食品</span><strong>{selectedFood.name}</strong><small>{selectedFood.groupName} · 炭水化物 {selectedFood.carbAvailableGPer100g ?? "不明"}g / 100g</small></div><span className="selected-check">✓</span></div>
          <QuestionFields questions={questions} values={questionValues} onChange={(id, value) => setQuestionValues((current) => ({ ...current, [id]: value }))} />
          <label className="field"><span>見かけ密度（該当ポーションがない場合のみ）</span><div className="unit-input"><input type="number" min="0.15" max="2.2" step="0.05" value={manualDensity} onChange={(event) => setManualDensity(Number(event.target.value))} /><em>g/mL</em></div></label>
          <button className="primary-wide result-button" disabled={resultState === "calculating"} onClick={calculateResult}>{resultState === "calculating" ? "計算中…" : "炭水化物量を計算"}</button>
          {resultMessage ? <Status tone={resultState === "error" ? "error" : resultState === "ready" ? "ok" : "neutral"}>{resultMessage}</Status> : null}
        </> : <div className="empty-copy">先に食品候補を確定してください。</div>}
      </section>

      <section className="result-panel" id="result" aria-live="polite">
        <div className="section-title light"><span>06</span><div><h2>推定結果</h2><p>実測根拠と不確かさを含む参考値</p></div></div>
        {carbEstimate && weightEstimate ? <>
          <div className="result-hero"><div><span>炭水化物</span><strong>{format(carbEstimate.totalCarbsG)}<small> g</small></strong><em>{format(carbEstimate.minCarbsG)}–{format(carbEstimate.maxCarbsG)} g</em></div><div><span>可食部重量</span><strong>{format(carbEstimate.edibleGrams, 0)}<small> g</small></strong><em>{format(carbEstimate.minEdibleGrams, 0)}–{format(carbEstimate.maxEdibleGrams, 0)} g</em></div></div>
          <div className="evidence-grid"><div><span>体積</span><strong>{format(measurement.volumeMl)} mL</strong><small>{SHAPE_LABELS[shape]} / {METHOD_LABELS[method]}</small></div><div><span>重量根拠</span><strong>{weightEstimate.massEvidence.source}</strong><small>{weightEstimate.massEvidence.portionDescription ?? "密度範囲"}</small></div><div><span>不確かさ</span><strong>±{measurement.uncertainty.relativePercent}%</strong><small>{measurement.uncertainty.reasons.join(" / ")}</small></div></div>
          <div className="component-list">{carbEstimate.components.map((component, index) => <div key={`${component.label}-${index}`}><span>{component.label}</span><em>{component.source === "question" ? "質問補正" : `${format(component.grams)}g`}</em><strong>{format(component.carbsG)}g</strong></div>)}</div>
          <p className="rationale">根拠: {carbEstimate.rationale}</p>
          <div className="result-caution">⚠ {carbEstimate.caution}</div>
        </> : <div className="result-empty"><span>—</span><p>食品・寸法・形状を確定すると、ここに推定範囲と根拠を表示します。</p></div>}
      </section>

      <footer><button className="text-button" onClick={() => window.location.reload()}>最初からやり直す</button><a href="/vendor/apriltag/LICENSE">第三者ライセンス</a><span>Photo Carb Counter Research</span></footer>

      <div className="xr-overlay" ref={xrOverlayRef}>
        <div className="xr-top"><strong>AR食品ノギス</strong><button data-xr-end>終了</button></div>
        <div className="xr-reticle"><span /><i /></div>
        <div className="xr-bottom"><p>{xrStatus}</p><span data-xr-quality>面を探索中</span><div className="xr-actions"><button data-xr-undo>1点戻す</button><button data-xr-reset>全点やり直す</button><button data-xr-record>この点を記録</button></div></div>
      </div>
    </main>
  );
}

function measureSafeReprojection(result: MarkerImageResult, crop: CropRect): number | undefined {
  try { return measureCropOnMat(result, crop).reprojectionErrorPx; } catch { return undefined; }
}
