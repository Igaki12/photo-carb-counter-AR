import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { EmbeddingManifest, FoodItem } from "../app/types/domain.ts";

test("food and chunked embedding data stay complete", async () => {
  const foods = JSON.parse(await readFile(new URL("../public/data/foods.json", import.meta.url), "utf8")) as FoodItem[];
  assert.equal(foods.length, 7970);
  assert.equal(new Set(foods.map((food) => food.id)).size, 7970);
  assert.equal(foods.filter((food) => food.source.name === "FoodData Central FNDDS 2021-2023").length, 5432);
  assert.equal(foods.filter((food) => food.source.name === "日本食品標準成分表（八訂）増補2023年").length, 2538);
  assert.ok(foods.some((food) => food.name === "Coffee, Latte"));
  assert.ok(foods.some((food) => food.name === "Cheese sandwich, NFS"));

  const manifest = JSON.parse(await readFile(new URL("../public/data/embeddings/manifest.json", import.meta.url), "utf8")) as EmbeddingManifest;
  assert.equal(manifest.totalCount, 7970);
  assert.equal(manifest.dimensionality, 768);
  assert.match(manifest.source, /FNDDS.*日本食品標準成分表/);
  assert.equal(manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0), 7970);
  const allEmbeddings: Array<{ foodId: string; vector: number[] }> = [];
  let streamingTop: Array<{ foodId: string; score: number }> = [];
  let query: number[] | null = null;
  for (const chunk of manifest.chunks) {
    const url = new URL(`../public${chunk.url}`, import.meta.url);
    const metadata = await stat(url);
    assert.ok(metadata.size < 25 * 1024 * 1024);
    const contents = await readFile(url);
    assert.equal(createHash("sha256").update(contents).digest("hex"), chunk.sha256);
    const parsed = JSON.parse(contents.toString()) as { embeddings: Array<{ foodId: string; vector: number[] }> };
    assert.equal(parsed.embeddings.length, chunk.count);
    query ??= parsed.embeddings[17].vector;
    for (const embedding of parsed.embeddings) {
      assert.equal(embedding.vector.length, 768);
      assert.ok(embedding.vector.every(Number.isFinite));
      allEmbeddings.push(embedding);
      const score = embedding.vector.reduce((sum, value, index) => sum + value * query![index], 0);
      streamingTop.push({ foodId: embedding.foodId, score });
    }
    streamingTop.sort((a, b) => b.score - a.score || a.foodId.localeCompare(b.foodId));
    streamingTop = streamingTop.slice(0, 20);
  }
  const baselineTop = allEmbeddings
    .map((embedding) => ({
      foodId: embedding.foodId,
      score: embedding.vector.reduce((sum, value, index) => sum + value * query![index], 0),
    }))
    .sort((a, b) => b.score - a.score || a.foodId.localeCompare(b.foodId))
    .slice(0, 20);
  assert.deepEqual(streamingTop, baselineTop);
});
