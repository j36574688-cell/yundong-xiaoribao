# Vercel 部署步驟

把以下完整結構部署到 GitHub repository：

```text
index.html
api/news.js
api/translate.js
config/sports.v1.json
config/leagues.v1.json
config/content-types.v1.json
config/sources.v1.json
```

`README.md`、`AUTO_TEST.md`、`ARCHITECTURE_V2.md`、`DEPLOYMENT.md`、`scripts/`、`package.json` 可一併保留作為維護工具。

Vercel 完成部署後：

1. 開啟網站。
2. 進入「設定」。
3. 確認「新聞標題自動翻譯」開啟。
4. 按「自動測試模式 → 開始測試」。
5. 確認 Config、API Contract、Translation 與新聞案例沒有 FAIL。

正式手動更新新聞時，前端會繞過 5 分鐘瀏覽器快取。
