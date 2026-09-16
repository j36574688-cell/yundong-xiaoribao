# Architecture v4 升級報告

本版以 Architecture v3 完整升級包為基底，保留既有 hard filter、來源設定與測試體系。

完成：
1. Heat v2 與來源權威度加權，保留 v1 對照實作。
2. 今日五大頭條 x1：跨聯盟百分位、同 sport 最多 2 篇、多來源去重與入選理由。
3. Highlights KV 快取與 30 天歷史。
4. Cron 背景暖快取後獨立計算五大頭條。
5. 關鍵字／球員追蹤欄位。
6. 收藏、分享／複製、新聞搜尋。
7. RSS endpoint。
8. health-v4 的 highlights 新鮮度。
9. 新增 highlights-test 並收進 npm test。
10. 前端 PWA 沿用並升級至 v4 UI。


## 驗證
`npm test`：audit / contract-test / regression-test / v3-test / highlights-test 全部 PASS。前端內嵌 JavaScript syntax check PASS；專案未發現明顯硬編碼 API Key/Secret。
