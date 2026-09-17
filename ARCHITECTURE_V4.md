# 運動小日報｜Architecture v4

基於 v3 升級。既有 league / content type HARD FILTER、29 sport / 95 league / 28 content type 與 API Contract 保持相容。

## 新增核心
- cross-sport highlights x1：從既有 section 快取與 warm sections 取候選，不直接跨聯盟比較原始 heat。
- 每聯盟先轉百分位，再跨運動比較；五大頭條同 sport 最多 2 篇。
- Highlights KV 歷史保存 30 天，背景排程每 15 分鐘重算。
- Heat v2：在保留 v1 實作供對照的前提下，加入來源權威度權重。

## 使用者體驗
- 關鍵字／球員追蹤
- 收藏與分享／複製
- 新聞全文搜尋
- 五大頭條 7 日回顧
- 每個 section 的 RSS
- PWA / 離線 fallback

## 維運
- health-v4 顯示 highlights 是否存在、年齡與 stale 狀態。
- Redis/KV 不可用時維持 in-memory fallback。
- highlights 與既有 section warm-up 互相隔離。

## API
- POST /api/news（既有）
- GET /api/highlights
- GET /api/highlights?history=1&days=7
- GET /api/rss?sport=&league=&types=&hours=&id=
