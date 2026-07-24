export interface XrCaliperResult {
  length: number;
  width: number;
  height: number;
  jitterMm: number;
  depthAvailable: boolean;
}

type Point = { x: number; y: number; z: number };

export async function supportsImmersiveAr(): Promise<boolean> {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

function centroid(points: Point[]): Point {
  return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 });
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export async function startXrCaliper(params: {
  overlay: HTMLElement;
  onStatus: (message: string) => void;
  onComplete: (result: XrCaliperResult) => void;
}): Promise<() => Promise<void>> {
  if (!navigator.xr) throw new Error("このブラウザはWebXRに対応していません。計測マットを使用してください。");
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: false });
  if (!gl) throw new Error("AR描画を開始できません。");
  await (gl as WebGLRenderingContext & { makeXRCompatible?: () => Promise<void> }).makeXRCompatible?.();
  let session: XRSession;
  try {
    session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "depth-sensing", "anchors"],
      domOverlay: { root: params.overlay },
      depthSensing: { usagePreference: ["cpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"] },
    });
  } catch (error) {
    throw new Error(`ARセッションを開始できません: ${error instanceof Error ? error.message : String(error)}`);
  }
  const layer = new XRWebGLLayer(session, gl);
  session.updateRenderState({ baseLayer: layer, depthNear: 0.02, depthFar: 5 });
  const localSpace = await session.requestReferenceSpace("local");
  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  const recent: Point[] = [];
  const recorded: Point[] = [];
  let current: Point | null = null;
  let currentJitterMm = Infinity;
  let ended = false;
  const labels = ["長さ 始点", "長さ 終点", "幅 始点", "幅 終点", "高さ 底面", "高さ 上面"];

  const updateInstruction = () => {
    const next = labels[recorded.length] ?? "計測完了";
    params.onStatus(`${next}を中央の照準に合わせ、端末を静止してください。`);
  };

  const recordPoint = () => {
    if (!current || recent.length < 10) {
      params.onStatus("照準を面に合わせ、位置が安定するまで待ってください。");
      return;
    }
    if (currentJitterMm > 5) {
      params.onStatus(`位置の揺れが${currentJitterMm.toFixed(1)}mmあります。5mm以下になるまで静止してください。`);
      return;
    }
    recorded.push({ ...current });
    if (recorded.length >= 6) {
      const result = {
        length: Math.round(distance(recorded[0], recorded[1]) * 1000),
        width: Math.round(distance(recorded[2], recorded[3]) * 1000),
        height: Math.round(distance(recorded[4], recorded[5]) * 1000),
        jitterMm: Math.round(currentJitterMm * 10) / 10,
        depthAvailable: Boolean(session.depthUsage || session.depthDataFormat),
      };
      params.onComplete(result);
      void session.end();
      return;
    }
    updateInstruction();
  };

  const recordButton = params.overlay.querySelector<HTMLButtonElement>("[data-xr-record]");
  const undoButton = params.overlay.querySelector<HTMLButtonElement>("[data-xr-undo]");
  const resetButton = params.overlay.querySelector<HTMLButtonElement>("[data-xr-reset]");
  const endButton = params.overlay.querySelector<HTMLButtonElement>("[data-xr-end]");
  const undoPoint = () => {
    if (recorded.length) recorded.pop();
    updateInstruction();
  };
  const resetPoints = () => {
    recorded.length = 0;
    recent.length = 0;
    current = null;
    updateInstruction();
  };
  recordButton?.addEventListener("click", recordPoint);
  undoButton?.addEventListener("click", undoPoint);
  resetButton?.addEventListener("click", resetPoints);
  endButton?.addEventListener("click", () => void session.end());
  session.addEventListener("select", recordPoint);
  session.addEventListener("end", () => {
    ended = true;
    params.overlay.classList.remove("is-active");
    hitTestSource.cancel?.();
    recordButton?.removeEventListener("click", recordPoint);
    undoButton?.removeEventListener("click", undoPoint);
    resetButton?.removeEventListener("click", resetPoints);
  });
  params.overlay.classList.add("is-active");
  updateInstruction();

  const onFrame = (_time: number, frame: XRFrame) => {
    if (ended) return;
    session.requestAnimationFrame(onFrame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const results = frame.getHitTestResults(hitTestSource);
    if (!results.length) {
      recent.length = 0;
      current = null;
      params.overlay.classList.remove("has-hit");
      return;
    }
    const pose = results[0].getPose(localSpace);
    if (!pose) return;
    const position = pose.transform.position;
    recent.push({ x: position.x, y: position.y, z: position.z });
    while (recent.length > 10) recent.shift();
    current = centroid(recent);
    currentJitterMm = Math.max(...recent.map((point) => distance(point, current!))) * 1000;
    params.overlay.classList.toggle("has-hit", recent.length >= 10 && currentJitterMm <= 5);
    const quality = params.overlay.querySelector<HTMLElement>("[data-xr-quality]");
    if (quality) quality.textContent = recent.length < 10 ? `安定化中 ${recent.length}/10` : `揺れ ${currentJitterMm.toFixed(1)} mm`;
  };
  session.requestAnimationFrame(onFrame);

  return async () => {
    if (!ended) await session.end();
  };
}
