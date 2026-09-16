# 運動小日報｜Architecture v3

手機優先的體育新聞日報。v3 延續 v2 的嚴格聯盟／內容類型過濾，並新增持久化 cache、locale hints、來源健康度、rate limit、Cron warm-up 與 PWA。

## 指令

```bash
npm test
```

## 主要入口

- `/api/news`
- `/api/translate`
- `/api/health`
- `/api/cron`

## 核心設定

- 29 sports
- 95 leagues
- 28 content types
- 11 esports leagues

## 注意

本版沒有加入 LINE、Email、關鍵字追蹤、RSS、TTS、Heat v2、Event Timeline。
