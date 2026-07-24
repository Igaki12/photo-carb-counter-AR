import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = process.argv[2] ?? "../photo-carb-counter/public/data";
const outputRoot = process.argv[3] ?? "public/data/embeddings";
const maxBytes = 19 * 1024 * 1024;
await mkdir(outputRoot, { recursive: true });

const sources = [
  { scope: "fndds", filename: "food-embeddings.json" },
  { scope: "mext", filename: "mext-food-embeddings.json" },
];
const manifest = {
  source: "USDA FNDDS 2021-2023 / 文部科学省 日本食品標準成分表（八訂）増補2023年",
  model: "",
  dimensionality: 0,
  normalized: true,
  totalCount: 0,
  chunks: [],
};

for (const source of sources) {
  const file = JSON.parse(await readFile(path.join(sourceRoot, source.filename), "utf8"));
  manifest.model ||= file.model;
  manifest.dimensionality ||= file.outputDimensionality;
  if (file.model !== manifest.model || file.outputDimensionality !== manifest.dimensionality) throw new Error("embedding source mismatch");
  let current = [];
  let currentBytes = 40;
  let chunkIndex = 0;
  const flush = async () => {
    if (!current.length) return;
    const payload = JSON.stringify({ scope: source.scope, model: file.model, dimensionality: file.outputDimensionality, embeddings: current });
    const filename = `${source.scope}-${String(chunkIndex).padStart(2, "0")}.json`;
    const bytes = Buffer.byteLength(payload);
    if (bytes >= 25 * 1024 * 1024) throw new Error(`${filename} exceeds 25 MiB`);
    await writeFile(path.join(outputRoot, filename), payload);
    manifest.chunks.push({
      url: `/data/embeddings/${filename}`,
      count: current.length,
      bytes,
      sha256: createHash("sha256").update(payload).digest("hex"),
      scope: source.scope,
    });
    manifest.totalCount += current.length;
    current = [];
    currentBytes = 40;
    chunkIndex += 1;
  };
  for (const embedding of file.embeddings) {
    const serialized = JSON.stringify(embedding);
    if (current.length && currentBytes + Buffer.byteLength(serialized) + 1 > maxBytes) await flush();
    current.push(embedding);
    currentBytes += Buffer.byteLength(serialized) + 1;
  }
  await flush();
}

if (manifest.totalCount !== 7970 || manifest.dimensionality !== 768) throw new Error(`unexpected embedding totals: ${manifest.totalCount}/${manifest.dimensionality}`);
await writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`wrote ${manifest.chunks.length} chunks for ${manifest.totalCount} embeddings`);
