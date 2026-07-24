# 食品ARノギス / Photo Carb Counter AR

ARCore対応Android Chrome向けの、研究用カーボカウントWebアプリです。食品だけを撮影・切り抜き、7,970件の食品embeddingとの正規化ベクトル内積、ARまたはAprilTagによる実寸計測、FNDDS/MEXTの食品成分・ポーション情報を組み合わせて炭水化物量の範囲を提示します。

医療機器ではありません。治療判断やインスリン投与量の決定には使用しないでください。

## プライバシー

- Gemini APIキーはReactのメモリ内だけで保持し、Storage、Cookie、URL、ログへ保存しません。
- Geminiへ送る画像は、ユーザーが確定した食品切り抜きだけです。
- AprilTag写真とVisual Hull動画は端末内Workerだけで処理します。
- 端末へ永続保存するのは、カメラ校正の要約とUI設定だけです。
- 手検出、手サイズ、手ランドマーク、手基準フォールバックは実装していません。

## 計測方法

1. `webxr-caliper`: WebXR Hit Testで長さ・幅・高さの6端点を取得。直近10フレームの位置ジッターが5mm以下の時だけ確定します。Depth Sensingは任意です。
2. `marker-two-view`: A4 AprilTag計測マットの真上・斜め画像を使い、各3タグ以上、再投影誤差2px以下で寸法を算出します。
3. `marker-video-visual-hull`: 5秒以上、120度以上の動画から12シルエットを抽出し、2〜8mmボクセルで端末内カービングします。凹部を埋めるため上限推定です。
4. `manual`: AR非対応・計測不良時に寸法を直接入力できます。

形状モデルは直方体、楕円体、楕円柱、円錐台、輪郭押し出し、楕円放物面相当の「皿上の山」に対応します。

## 開発

Node.js 22.13以上が必要です。

```bash
npm ci
npm run dev
npm run test
npm exec tsc -- --noEmit
npm run lint
npm run build
```

埋め込みチャンクと計測マットを再生成する場合:

```bash
npm run data:embeddings
npm run data:mat
```

埋め込みは各20MiB未満の決定的チャンクへ変換され、manifestのSHA-256をWorkerが読み込み時に検証します。計測マットは `public/assets/photo-carb-counter-measurement-mat-a4.pdf` です。

## Android Chrome実機確認

1. ARCore対応Android端末のChromeからHTTPSの公開URLを開き、カメラ権限を許可します。
2. 「ARノギスを開始」でimmersive-arへ入り、6点を記録します。揺れ5mm超で確定できないこと、Depth非対応でも平面Hit Testが動くことを確認します。
3. AR非対応端末では計測マットへ自動誘導されることを確認します。
4. マットPDFを100%で印刷し、100mm確認線が99〜101mmであることを物差しで確認します。
5. 真上・30〜50度の斜め写真で各3タグ以上を写し、輪郭と高さを補正して反映します。
6. APIキー入力後、食品だけの切り抜きが分類に送信され、マーカー写真・動画がネットワーク送信されないことをDevToolsで確認します。
7. ページ再読み込み後にAPIキー、画像、動画、測定結果が残らないことを確認します。

WebXRの完全な検証には実機が必要です。デスクトップ環境では能力検出、非対応フォールバック、幾何計算を確認できます。

## データと第三者ソフトウェア

- 食品: USDA FoodData Central FNDDS 2021–2023 5,432件、文部科学省 日本食品標準成分表（八訂）増補2023年 2,538件
- embedding: `gemini-embedding-2`、768次元、正規化済み
- AprilTag: `arenaxr/apriltag-js-standalone` commit `7a6ad7ddb3562031ab2deb0c5ac5faeb86df599c` に含まれるAprilRobotics由来WASM

詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) と `public/vendor/apriltag/LICENSE` を参照してください。
