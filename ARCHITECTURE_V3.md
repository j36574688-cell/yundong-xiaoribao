# 運動小日報｜Architecture v3

## 目的

本文件是在 Architecture v2 上進行「穩定性＋可維運性＋效能」升級的規格。v3 不重寫既有新聞引擎；任何修改都必須以保留 29 sport、95 league、28 content type、聯盟 HARD FILTER、內容類型 HARD FILTER、電競與翻譯功能為前提。

## 本版納入

1. 持久化新聞 section cache：優先使用 Upstash Redis REST；Redis 不可用時 fallback 到 in-memory Map。
2. Cache key：cacheVersion + configVersion + sport + league + sorted contentTypes + hours。
3. Source timeout：每個新聞來源通道 8 秒；多來源使用 Promise.allSettled／分批並行。
4. localeResultHints：NPB、KBO 等多語言賽果訊號由 config 管理，避免 per-league regex 散落在核心程式。
5. Source Health：新增 /api/health，觀察市場通道／發布來源的成功、失敗、最近錯誤與快取命中率。
6. Rate limit：/api/news、/api/translate、/api/health 使用 per-IP 限制；Redis 可用時持久化計數，不可用時使用記憶體 fallback。
7. Background warm-up：新增 /api/cron 與 vercel.json，預抓常用 section。
8. PWA：manifest.json、service worker、離線時保留前一次成功新聞資料。
9. Auto Test 擴充：加入 v3 static checks，驗證 locale hints、cache version、PWA、health、cron、rate-limit 與 Redis fallback 結構。

## 刻意不納入

- LINE／Email 推播
- 關鍵字／球員追蹤
- RSS／JSON 匯出
- TTS
- Heat Algorithm v2
- Event Timeline

上述功能保留於未來版本，不可在 v3 變更中順手加入，以降低回歸風險。

## Redis

環境變數：
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN

使用 REST 命令取得／寫入 cache、rate-limit counter 與 health 狀態。缺少 credentials 或 Redis 失敗時，功能仍需依靠 in-memory fallback 繼續運作。

## Cron

/api/cron 預抓常用 section。端點必須使用 CRON_SECRET 保護；沒有 CRON_SECRET 的 production 不應公開執行 warm-up。

schedule 預設為每 15 分鐘，但實際執行頻率受 Vercel 專案方案與平台限制影響。若使用 Hobby，應以目前 Vercel 官方對 Hobby Cron 的限制為準。

## PWA

- 靜態資源由 service worker cache-first。
- API 請求保持 network-first；POST /api/news 不直接寫入 Cache API，失敗時由前端 localStorage 提供最後成功資料。
- 離線狀態必須明確顯示「離線資料，可能非最新」。

## 防回歸

修改前：npm test baseline。
修改後：npm test + diff。

任何功能由 PASS 變 WARN/FAIL 都不得直接視為完成。
