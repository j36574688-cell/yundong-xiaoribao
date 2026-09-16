# 運動小日報｜Architecture v2

這是「運動小日報」的完整升級候選版本，重點是：在不犧牲既有 29 個運動、95 個聯盟與 28 個內容類型的前提下，補上效能、快取、資料品質、API 合約、自動測試與 regression baseline。

## 目錄

```text
index.html
api/
  news.js
  translate.js
config/
  sports.v1.json
  leagues.v1.json
  content-types.v1.json
  sources.v1.json
scripts/
  audit.mjs
  contract-test.mjs
  build-manifest.mjs
package.json
README.md
AUTO_TEST.md
ARCHITECTURE_V2.md
DEPLOYMENT.md
```

## 主要升級

- `/api/news`：每個來源 request 8 秒 timeout。
- 來源 jobs 以 `Promise.allSettled` 分批並行，且有最大併發上限。
- 搜尋工作使用 `Promise.allSettled`；單一來源失敗不會拖垮其他來源。
- 查詢併發設上限 8，避免來源過度並發。
- 新聞結果快取 7 分鐘；完全空結果快取 2 分鐘。
- 原始 RSS 快取 5 分鐘。
- 快取 key 包含 `sport + league + contentTypes + hours + configVersion`。
- 聯盟與內容類型維持 HARD FILTER。
- 同標題去重後，再使用保守的事件 clustering。
- Heat Algorithm v1 固定公式並帶版本號。
- API contract version 1.0。
- 自動測試最多 4 組並行，但結果固定依測試案例順序呈現。
- Auto Test 增加 Config Integrity、API Contract、Translation Test、Regression Baseline。
- 前端加入 5 分鐘瀏覽器快取；手動「更新新聞」會強制繞過瀏覽器快取。
- 翻譯服務失敗時回退原文，絕不把 provider error 當成新聞標題。
- Supabase `news-v22` 視為 legacy，不參與正式新聞請求。

## 部署

Vercel 專案應使用本包的 `index.html`、`api/news.js`、`api/translate.js` 與 `config/`。

正式請求路徑：

```text
index.html → /api/news
index.html → /api/translate
```

不要把 Supabase `news-v22` 再接回主流程。

## 本機檢查

```bash
npm test
```

沒有第三方依賴，Node.js 只需支援 `fetch` 與 CommonJS `require`（Node 18+）。
