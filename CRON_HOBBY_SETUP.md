# Hobby 方案高頻 Cron 設定

## 目的
Vercel Hobby 不使用 `vercel.json` 的高頻 Cron；改由 GitHub Actions 每 15 分鐘呼叫 `/api/cron`。

## 必要設定
在 GitHub Repository：
`j36574688-cell/yundong-xiaoribao`

新增 Repository Secret：

- Name: `CRON_SECRET`
- Value: 與 Vercel Production Environment 的 `CRON_SECRET` 完全相同

## 執行方式
`.github/workflows/sports-cron.yml` 每 15 分鐘呼叫：
`https://yundong-xiaoribao.vercel.app/api/cron`

也可在 GitHub Actions 手動執行 `運動小日報新聞暖快取`。

## 注意
GitHub Actions 的 scheduled workflow 並非保證精確到秒，可能因平台負載延遲；但排程頻率仍可設定為每 15 分鐘。
