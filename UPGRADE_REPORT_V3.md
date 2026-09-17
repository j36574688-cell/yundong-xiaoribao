# Architecture v3 升級報告

## 已完成

- 持久化 section cache：Upstash Redis REST + in-memory fallback
- cache key 版本化
- NPB/KBO localeResultHints
- Source Health dashboard + /api/health
- /api/news、/api/translate、/api/health per-IP rate limit
- Vercel Cron /api/cron warm-up
- PWA manifest + service worker + 192/512 icon
- v3 自動檢查腳本
- package.json 升級為 3.0.0

## Regression 結果

npm test：
- Config audit：PASS
- API contract：PASS
- Regression：PASS
- v3 test：PASS

完整核心設定：29 sports / 95 leagues / 28 content types / 11 esports leagues。

## 注意

Redis 與 Cron 是「可選基礎設施」：未設定 Redis 時不應阻止新聞功能，但無法取得跨 instance 的持久化 cache、rate limit 與 health aggregation；未設定 CRON_SECRET 時 production cron warm-up 應保持關閉。

## 未納入

LINE／Email 推播、關鍵字追蹤、RSS/JSON、TTS、Heat v2、Event Timeline。

## Claude v3 提案採用範圍

已採用：持久化 cache、locale result hints、Cron warm-up、來源健康度、API rate limit、PWA。
未採用：LINE／Email 推播、關鍵字／球員追蹤、RSS／JSON 匯出、TTS、Heat v2、Event Timeline。
