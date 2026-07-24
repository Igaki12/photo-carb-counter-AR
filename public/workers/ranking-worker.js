function dot(a, b) {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
  return sum;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (event) => {
  const { vector, manifestUrl } = event.data;
  try {
    const manifestResponse = await fetch(manifestUrl, { cache: "force-cache" });
    if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (manifest.dimensionality !== vector.length || manifest.totalCount !== 7970) throw new Error("embedding manifestの件数または次元数が不正です。");
    let top = [];
    let processed = 0;
    for (const chunkMeta of manifest.chunks) {
      const response = await fetch(chunkMeta.url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`${chunkMeta.url}: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const digest = toHex(await crypto.subtle.digest("SHA-256", bytes));
      if (digest !== chunkMeta.sha256) throw new Error(`${chunkMeta.url}: SHA-256が一致しません。`);
      const chunk = JSON.parse(new TextDecoder().decode(bytes));
      if (chunk.embeddings.length !== chunkMeta.count) throw new Error(`${chunkMeta.url}: 件数が一致しません。`);
      for (const embedding of chunk.embeddings) {
        top.push({ foodId: embedding.foodId, score: dot(vector, embedding.vector) });
      }
      top.sort((a, b) => b.score - a.score);
      top = top.slice(0, 20);
      processed += chunk.embeddings.length;
      self.postMessage({ type: "progress", processed, total: manifest.totalCount });
    }
    self.postMessage({ type: "complete", scores: top, processed });
  } catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
