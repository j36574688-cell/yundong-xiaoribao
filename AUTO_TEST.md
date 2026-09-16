# 自動測試模式 v2

設定頁的「🧪 自動測試模式」會執行：

1. Config 完整性
2. API Contract
3. 標題翻譯服務
4. NHL 全部
5. MLB 比賽結果
6. NPB 比賽結果
7. CPBL 比賽結果
8. NBA 全部
9. F1 賽程
10. 英超 比賽結果
11. ATP 排名
12. LPL 全部
13. VCT 全部
14. CS2 全部
15. Dota 2 全部
16. Regression Baseline

新聞案例最多 4 組並行；UI 仍按照固定案例順序顯示結果。

每組新聞案例檢查：

- API 回應是否正常
- sport 是否正確
- league 是否正確
- content type hard filter 是否正常
- sectionId 是否正確路由
- 跨聯盟污染
- 部分來源錯誤是否被隔離

Regression Baseline 儲存在瀏覽器 localStorage 的 `sd_auto_test_baseline_v2`。
第一次執行會建立 baseline；之後執行會顯示狀態變化。
