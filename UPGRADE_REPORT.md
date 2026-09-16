# Architecture v2 升級報告

## 已完成

- 新聞來源 job 使用 `Promise.allSettled` 分批並行收斂，單一來源失敗隔離。
- 單一來源 request timeout 8 秒。
- 查詢 worker 上限 8。
- raw RSS cache 5 分鐘。
- section result cache 7 分鐘；空結果 2 分鐘。
- cache key 包含 config version、sport、league、content types、hours。
- 聯盟與內容類型維持硬篩選。
- 保守 event clustering。
- Heat Algorithm v1 固定權重並輸出版本。
- API Contract v1.0。
- versioned config JSON。
- Config / Contract / Regression / Translation 自動測試。
- Auto Test 以最多 4 組並行、固定順序呈現。
- Browser news cache 5 分鐘；手動更新繞過。
- 翻譯錯誤不可進入新聞標題。

## 完整性

- 29 個運動
- 95 個聯盟
- 28 個內容類型
- 11 個電競聯盟來源組
- 中國電競來源保留

## 部署狀態

此 ZIP 是「升級候選完整包」，沒有自動覆蓋線上 Vercel production。
部署前請先執行 `npm test`。
