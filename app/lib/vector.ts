export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("ベクトルの次元数が一致しません。");
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
  return sum;
}

export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error("ベクトルを正規化できません。");
  return vector.map((value) => value / magnitude);
}
