self.onmessage = (event) => {
  const { dimensions, voxelMm, masks, maskWidth, maskHeight, viewCoverageDeg } = event.data;
  try {
    const nx = Math.max(1, Math.ceil(dimensions.length / voxelMm));
    const ny = Math.max(1, Math.ceil(dimensions.width / voxelMm));
    const nz = Math.max(1, Math.ceil(dimensions.height / voxelMm));
    const total = nx * ny * nz;
    if (total > 1800000) throw new Error("端末の安全上限を超えました。ボクセル幅を大きくしてください。");
    let occupied = 0;
    for (let iz = 0; iz < nz; iz += 1) {
      const zRatio = (iz + 0.5) / nz;
      for (let iy = 0; iy < ny; iy += 1) {
        const y = ((iy + 0.5) / ny - 0.5) * dimensions.width;
        for (let ix = 0; ix < nx; ix += 1) {
          const x = ((ix + 0.5) / nx - 0.5) * dimensions.length;
          let survives = true;
          for (let frame = 0; frame < masks.length; frame += 1) {
            const angle = ((frame / Math.max(1, masks.length - 1)) - 0.5) * viewCoverageDeg * Math.PI / 180;
            const projected = x * Math.cos(angle) + y * Math.sin(angle);
            const halfSpan = Math.abs(Math.cos(angle)) * dimensions.length / 2 + Math.abs(Math.sin(angle)) * dimensions.width / 2;
            const u = Math.max(0, Math.min(maskWidth - 1, Math.round((projected / (halfSpan * 2) + 0.5) * (maskWidth - 1))));
            const v = Math.max(0, Math.min(maskHeight - 1, Math.round((1 - zRatio) * (maskHeight - 1))));
            if (!masks[frame][v * maskWidth + u]) {
              survives = false;
              break;
            }
          }
          if (survives) occupied += 1;
        }
      }
      if (iz % Math.max(1, Math.floor(nz / 10)) === 0) self.postMessage({ type: "progress", progress: Math.round((iz / nz) * 100) });
    }
    const volumeMl = occupied * Math.pow(voxelMm, 3) / 1000;
    self.postMessage({ type: "complete", volumeMl: Math.round(volumeMl * 10) / 10, occupied, total, voxelMm });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
