# 運動小日報｜Architecture v3 升級提案

補充文件 | 基於 v2 審查結果 | 給接手 AI（GPT）參考使用

## 文件用途

本文件是在 Architecture v2（已通過 `npm test`：audit / contract-test / regression-test 全數 PASS）基礎上，提出的下一階段升級建議。這不是取代 `ARCHITECTURE_V2.md`，而是補充項目。修改前請先讀完 v2 的 `ARCHITECTURE_V2.md` 與 `UPGRADE_REPORT.md`，並先跑一次 `npm test` 建立 baseline。

**核心原則不變**：任何修改前先跑 baseline，修改後重新跑 diff；不可因新增功能而移除既有 sport / league / content type / source；聯盟與內容類型維持 HARD FILTER。

---

## 一、優先處理：快取持久化（結構性隱患）

**現況問題**：`api/news.js` 目前用 `globalThis.__SD_NEWS_CACHE_V2` 這種 in-memory Map 做快取。Vercel serverless function 在 cold start 或跨 region/instance 時不共享記憶體，實際快取命中率可能遠低於文件宣稱的「7 分鐘 section cache」。

**建議方案**：
- 導入 Vercel KV 或 Upstash Redis（免費額度足夠這個規模）。
- 快取 key 結構沿用現有的 `configVersion + sport + league + sorted(contentTypes) + hours`。
- TTL 沿用 v2 既有數值（section 正常結果 7 分鐘、空結果 2 分鐘、raw source 5 分鐘），先不改變行為，只換儲存層。
- 若 KV 連線失敗，必須 fallback 回現有的 in-memory Map，不能讓快取層失效拖垮整個 `/api/news`。

**驗收標準**：加入後跑 `npm test` 必須全部維持 PASS；另外建議新增一個測試案例，模擬 KV 連線失敗時 fallback 是否正常運作。

---

## 二、聯盟語言判斷規則抽象化

**現況問題**：NPB 的日文賽果判斷（`npbResultSignal`）是直接寫在 `news.js` 程式碼裡的硬編碼 regex，只服務單一聯盟。未來若要支援 KBO 韓文賽果詞、其他語言聯盟，同樣模式會重複發生，變成程式碼裡散落一堆 per-league 特例。

**建議方案**：
- 在 `config/sources.v1.json` 新增 `localeResultHints`，格式例如：
  ```json
  {
    "localeResultHints": {
      "NPB": ["試合結果", "試合終了", "試合速報", "勝利", "敗戦", "勝った", "敗れた"],
      "KBO": ["경기결과", "승리", "패배"]
    }
  }
  ```
- `news.js` 改成讀取 `localeResultHints[league]` 做判斷，而不是為每個聯盟寫一段獨立 regex。
- 這個改動屬於「重構既有邏輯」，修改前後都要跑 regression-test，並確認 NPB 現有行為完全不變（這是防回歸的重點測試對象）。

---

## 三、自動化背景更新

**目標**：使用者打開網站時直接看到熱快取，不用等 8 秒 timeout 的冷啟動搜尋。

**建議方案**：
- 用 Vercel Cron（`vercel.json` 設定 schedule）每 10-15 分鐘背景呼叫 `/api/news`，針對使用者常用的 section 預抓一次，寫入快取層（見第一項的 KV）。
- Cron job 失敗不可影響正式 `/api/news` 端點的可用性，兩者要能獨立失敗。

---

## 四、通知與摘要推播

**建議方案（依投資回報排序）**：
1. **LINE Notify**：台灣使用者接受度高，串接成本低，適合當第一個推播管道。
2. **Email（Resend 或類似服務）**：作為備援管道。
3. 推播內容沿用「重要新聞」區塊的資料結構，不需要額外設計新的資料模型。
4. 使用者需要能在設定頁開關推播、設定推播時間，這些設定要存進使用者現有的 section 設定結構裡。

---

## 五、使用者功能面

### 5.1 關鍵字／球員追蹤
- 在 section 設定裡新增 `keywords` 欄位（陣列）。
- 符合 keyword 的新聞即使熱度不足以進「重要新聞」，也強制顯示（可以放進「重要新聞」或另開一個「追蹤中」子區塊，設計時再決定）。
- 這是新欄位、新邏輯分支，不得影響現有的 league / content type hard filter 邏輯。

### 5.2 PWA 化
- 新增 `manifest.json` 與最基本的 service worker（cache-first for 靜態資源，network-first for `/api/news`）。
- 離線時顯示最後一次成功抓取的快取新聞，並明確標示「離線資料，可能非最新」。

### 5.3 語音摘要（TTS）
- 用瀏覽器內建 `SpeechSynthesis` API，零成本、不需要額外 API。
- 針對「重要新聞」區塊的標題（翻譯後的繁體中文）做逐條朗讀。
- 純前端功能，不影響後端架構。

### 5.4 RSS / JSON 匯出
- 讓使用者把自己設定好的 section 轉成一條 RSS feed URL，方便丟進 Feedly 等閱讀器。
- 可以用現有的 `/api/news` 回應資料直接轉換，不需要新的資料來源。
- 需要一個新的 endpoint（例如 `/api/rss?sectionId=xxx`），輸出格式遵循標準 RSS 2.0。

---

## 六、資料品質再進一步

### 6.1 來源權威度加權
- 在 `applyHeat()` 的公式裡新增 `sourceAuthorityWeight` 因子。
- 官方聯盟網站（如 NHL.com、MLB.com、LPL 官方站）給予比一般媒體轉述稍高的權重。
- 這會影響 Heat Algorithm 版本號，必須升級成 `v2` 並在 `ARCHITECTURE_V2.md`（或後續的 `ARCHITECTURE_V3.md`）裡明確寫出新公式，維持「熱度演算法版本化」的既有原則。
- 舊版 `v1` 公式保留在程式碼裡供對照，不要直接覆蓋刪除。

### 6.2 事件時間軸串接
- 利用現有的 `eventId` / `eventTypes` 資料結構，把同一位選手的「受傷 → 手術 → 復出」等關聯新聞串成一個時間軸卡片。
- 純前端呈現層升級，不需要新的資料抓取邏輯，只是換一種方式呈現既有資料。

---

## 七、維運與監控

### 7.1 來源健康度儀表板
- 設定頁新增一個面板，顯示每個新聞來源最近一次成功／失敗時間、失敗率。
- 資料來源可以用現有 `/api/news` 回應裡的 `errors` 陣列累積統計，不需要新的追蹤系統。

### 7.2 API 呼叫防護
- `/api/translate` 打的是 Google Translate 非官方端點，流量大時容易被暫時封鎖，建議加 per-IP rate limit（例如 Upstash Ratelimit）。
- `/api/news` 也建議加類似防護，避免被過度呼叫拖垮來源 API 額度。
- Rate limit 觸發時，回應格式仍要符合 API Contract（`items` 給空陣列、`errors` 說明原因），不可回傳跳脫 contract 格式的錯誤。

---

## 八、實作優先順序建議

1. **快取持久化（KV/Redis）**—— 解決現有架構隱性瓶頸，優先度最高。
2. **Vercel Cron 背景預抓** —— 依賴第 1 項完成後才有意義。
3. **來源健康度儀表板** —— 維運可視性，成本低、價值高。
4. 之後依實際使用情境挑選：LINE 推播、關鍵字追蹤、PWA、RSS 匯出等體驗型功能。
5. 來源權威度加權、事件時間軸屬於資料品質優化，可以與體驗型功能並行，不互相依賴。

---

## 九、給接手 AI（GPT）的提醒

- 本文件所有項目都是**新增或優化**，不是要求重寫既有架構。
- 動工前務必先跑 `npm test` 建立 baseline，任何修改後都要重新跑一次確認既有 29 sport / 95 league / 28 content type / hard filter 行為沒有被破壞。
- 每完成一項升級，請更新對應的 `UPGRADE_REPORT.md` 或新增 `UPGRADE_REPORT_V3.md`，並確保新增的測試案例被收進 `npm test` 的執行範圍，而不是只寫在報告文字裡卻沒有對應可執行的驗證程式碼。
