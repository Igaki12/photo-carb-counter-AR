/* Apriltag WASM wrapper pinned from arenaxr/apriltag-js-standalone commit
 * 7a6ad7ddb3562031ab2deb0c5ac5faeb86df599c. BSD-3-Clause license is at
 * /vendor/apriltag/LICENSE. The detector embeds AprilRobotics tag36h11. */
importScripts("/wasm/apriltag_wasm.js");

let modulePromise = AprilTagWasm();
let apiPromise = modulePromise.then((Module) => {
  const init = Module.cwrap("atagjs_init", "number", []);
  const setOptions = Module.cwrap("atagjs_set_detector_options", "number", ["number", "number", "number", "number", "number", "number", "number"]);
  const setPoseInfo = Module.cwrap("atagjs_set_pose_info", "number", ["number", "number", "number", "number"]);
  const setImageBuffer = Module.cwrap("atagjs_set_img_buffer", "number", ["number", "number", "number"]);
  const setTagSize = Module.cwrap("atagjs_set_tag_size", null, ["number", "number"]);
  const detect = Module.cwrap("atagjs_detect", "number", []);
  init();
  setOptions(1.5, 0, 1, 1, 16, 1, 1);
  for (let id = 0; id < 4; id += 1) setTagSize(id, 0.024);
  return { Module, setPoseInfo, setImageBuffer, detect };
});

self.onmessage = async (event) => {
  const { id, type, rgba, width, height, camera } = event.data;
  try {
    const api = await apiPromise;
    if (type === "ready") {
      self.postMessage({ id, ok: true });
      return;
    }
    api.setPoseInfo(camera.fx, camera.fy, camera.cx, camera.cy);
    const gray = new Uint8Array(width * height);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
      gray[target] = Math.round(rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114);
    }
    const pointer = api.setImageBuffer(width, height, width);
    api.Module.HEAPU8.set(gray, pointer);
    const jsonPointer = api.detect();
    const length = api.Module.getValue(jsonPointer, "i32");
    if (!length) {
      self.postMessage({ id, ok: true, detections: [] });
      return;
    }
    const stringPointer = api.Module.getValue(jsonPointer + 4, "i32");
    const view = new Uint8Array(api.Module.HEAP8.buffer, stringPointer, length);
    const detections = JSON.parse(new TextDecoder().decode(view));
    self.postMessage({ id, ok: true, detections });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
