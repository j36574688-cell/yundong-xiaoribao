# Architecture v3 部署說明

## 必要檔案

- index.html
- api/news.js
- api/translate.js
- api/health.js
- api/cron.js
- api/lib/redis.js
- api/lib/rate-limit.js
- manifest.json
- sw.js
- icon-192.png
- icon-512.png
- config/*
- scripts/*
- package.json
- vercel.json

## Vercel Environment Variables

建議在 Vercel Project → Settings → Environment Variables 設定：

UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
CRON_SECRET

不把 token 寫進 GitHub。

## Redis 未設定時

新聞、翻譯、Auto Test 仍應可運作；cache、rate-limit、health 會使用 in-memory fallback，但不保證跨 serverless instance 共享。

## Cron

GitHub Actions 以每 15 分鐘排程呼叫 /api/cron；Vercel Hobby 不使用高頻 vercel.json Cron。詳見 CRON_HOBBY_SETUP.md。

## 第一次部署後驗收

1. 打開網站。
2. 設定 → 自動測試 → 開始測試。
3. 確認 Config / API Contract / 翻譯 / NHL / MLB / NPB / CPBL / NBA / F1 / 英超 / ATP / LPL / VCT / CS2 / Dota 2。
4. 設定 → 來源健康度 → 重新整理。
5. 瀏覽器離線後確認仍能看到最後一次成功資料，並顯示離線提示。
