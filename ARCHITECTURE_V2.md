# 運動小日報｜Architecture v2

## 1. Timeout / Parallelism

- 單一 RSS request：8 秒。
- 多個 source jobs：`Promise.allSettled`。
- 同時執行的 fetch worker：最多 8。
- Frontend 正式 API timeout：45 秒。
- Auto Test 單案例 timeout：90 秒。
- Auto Test：最多 4 個案例同時執行。

## 2. Cache

### Raw source cache
TTL：5 分鐘。

### Section result cache
正常結果：7 分鐘。
空結果：2 分鐘。

Cache key：

```text
configVersion + sport + league + sorted(contentTypes) + hours
```

## 3. Strict filtering

- League：HARD FILTER。
- Content type：HARD FILTER。
- Sport：HARD ROUTING。

## 4. Event clustering

先 exact normalized-title dedupe，再做保守 clustering。

條件：

- 發布時間差 <= 30 小時
- token Jaccard >= 0.82，或一方 token 子集於另一方

Event clustering 不跨 sport 或 league。

## 5. Heat Algorithm

版本：`v1`

```text
raw =
  0.25 × log(sourceCount + 1)
+ 0.15 × min(1, languageCount / 3)
+ 0.20 × freshnessDecay
+ 0.15 × contentTypeWeight
+ 0.25 × eventCountScore

heat = clamp(round(raw / 1.25 × 100), 0, 100)
```

各聯盟獨立計算，不互相競爭。

## 6. API Contract

Version：`1.0`

Response 必須有：

```text
items: Array
count: Number
errors: Array
fetchedAt: String
contractVersion: String
configVersion: String
heatAlgorithmVersion: String
```

Item 必須包含：

```text
id
sectionId
title
url
sourceName
publishedAt
sport
league
eventType
eventTypes
sourceCount
languages
relatedSources
heat
```

## 7. Config governance

Canonical config：

```text
config/sports.v1.json
config/leagues.v1.json
config/content-types.v1.json
config/sources.v1.json
```

`config/` 是 backend 的資料來源；frontend 同時保留目前穩定的嵌入式選單，`audit.mjs` 會檢查兩者是否一致。

## 8. Legacy

Supabase `news-v22`：legacy / read-only reference。

正式請求不使用它。

## 9. Feature preservation

任何修改都必須先跑 baseline，再做修改，修改後重新跑 baseline diff。

不可因修某個聯盟、翻譯或測試功能而移除其他既有 sport / league / type / source。
