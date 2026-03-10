# 專案資料重構驗收標準

## 文件目的

這份文件定義專案資料重構的驗收邊界、測試案例與 Done Definition。

目標不是驗證 UI 漂不漂亮，而是驗證：

1. 29 題 canonical schema 有沒有被守住
2. 對話／語音／打字是否真的共用同一份資料
3. AI 是否真的會追問而不是放飛補完
4. draft gate 是否真的擋得住不完整資料

## 驗收原則

1. 沒有任何一題可以繞過 confirmed gate 直接進草稿
2. 候選答案與 confirmed answer 必須分離
3. 任何對話寫回都必須可追溯到 evidence
4. 同一個 project 在 form / conversation / voice 三種模式下讀到的 question state 必須一致
5. 系統不得只因模型生成看似完整文字，就把 `partial` 誤升成 `confirmed`

## 官方依據

1. Realtime API 支援低延遲互動，適合語音模式，但不改變本專案 canonical schema 的責任邊界。  
   來源：OpenAI Realtime API  
   https://developers.openai.com/api/docs/guides/realtime
2. Voice Agents 文件明確區分 browser-side WebRTC 與 server-side WebSocket 架構。  
   來源：OpenAI Voice Agents  
   https://developers.openai.com/api/docs/guides/voice-agents
3. Audio 文件指出若需要高控制與可預期輸出，可採 STT / LLM / TTS 鏈；若需要即時互動，則採 Realtime API。  
   來源：OpenAI Audio and speech  
   https://developers.openai.com/api/docs/guides/audio
4. Tools 文件支援模型透過 function calling 觸發結構化欄位更新。  
   來源：OpenAI Using tools  
   https://developers.openai.com/api/docs/guides/tools

## 驗收範圍

### In Scope

1. 29 題狀態模型
2. 對話 session 與 turn persistence
3. candidate / confirmed / follow-up 流程
4. 打字版與對話版共用讀寫 API
5. voice mode session bootstrap
6. draft readiness gate

### Out of Scope

1. 最終草稿章節品質優化
2. 完整語音 UI 視覺打磨
3. 所有數學估算公式的精準度優化
4. 多語系支援

## Done Definition

### D1. Schema

1. 29 題全部存在於 canonical schema
2. 每題都可持有 `missing / partial / confirmed`
3. 每題都可存 evidence
4. 每題都可存 candidate 與 confirmed 版本

### D2. Form mode

1. 使用者在打字版輸入任一題時，可立即更新 question state
2. 若答案不足，server 回 `partial` 與 follow-up
3. 若答案足夠且使用者確認，server 回 `confirmed`

### D3. Conversation mode

1. 單輪對話可同時映射多題
2. server 會回傳顧問式回述
3. server 會標記 confirmation target
4. server 會給下一題追問

### D4. Voice mode

1. voice mode 可建立 session
2. transcript 可寫入 conversation turns
3. transcript 可抽取成 candidate updates
4. 結果回到同一份 question state

### D5. Draft gate

1. 任一題非 confirmed 時，`draft_generation_allowed = false`
2. 29 題全部 confirmed 時，`draft_generation_allowed = true`
3. backend 真正生成草稿前必須再檢查一次 gate

## 必過測試案例

### Case 1：打字輸入不足，系統不得放飛

前提：

1. `problem_description = missing`

操作：

1. 使用者輸入：`想解決工廠問題`

預期：

1. 該題狀態為 `partial`
2. server 回 follow-up：追問「是哪種工廠問題、影響是什麼」
3. 不可直接標記 `confirmed`
4. `draft_generation_allowed = false`

### Case 2：對話輸入跨多題，系統可拆分寫回

操作：

1. 使用者說：`我們想解決中小工廠還靠人工檢測的問題，打算用低成本 AI 視覺檢測系統處理，而且導入速度會比現在市面方案快很多。`

預期：

1. 系統至少抽出：
   - `problem_description`
   - `solution_description`
   - `competitive_advantage`
2. 這三題可同時進入 candidate update
3. 不可只寫進單一欄位

### Case 3：回述確認前，不得寫死 confirmed

操作：

1. AI 回述 candidate
2. 使用者尚未按確認，也未補述

預期：

1. `candidate_answer` 可存在
2. `confirmed_answer` 仍為空
3. 該題不得視為 completed

### Case 4：使用者修正後確認

操作：

1. AI 回述：`你們的目標客戶是中小工廠`
2. 使用者修正：`不是所有中小工廠，是做金屬加工的工廠`
3. 使用者確認

預期：

1. `question_confirmations` 留下 candidate 與 final diff
2. `confirmed_answer` 存修正後內容
3. `status = confirmed`

### Case 5：voice transcript 與 form mode 一致讀取

操作：

1. voice 模式填出 `solution_description`
2. 切回打字模式

預期：

1. 打字模式讀到同一份 `candidate/confirmed` 狀態
2. 不得出現兩套不同答案來源互相覆蓋卻無 evidence

### Case 6：29 題未完成時阻擋草稿

前提：

1. 28 題 `confirmed`
2. `budget_breakdown = missing`

操作：

1. 使用者點擊生成草稿

預期：

1. backend 回 `draft_generation_allowed = false`
2. response 明確指出 blocking question = `budget_breakdown`
3. 草稿生成 handler 不得偷偷繼續執行

### Case 7：依賴題不得過早要求

前提：

1. `customer_validation = missing`

操作：

1. 啟動 follow-up planning

預期：

1. 系統不得把 `customer_pain_score` 當第一優先追問
2. 必須先問 `customer_validation`

### Case 8：模型抽取失敗時，系統仍可恢復

操作：

1. conversation extract 發生模型解析失敗

預期：

1. turn 仍被寫入
2. session 不會壞掉
3. server 回 recoverable error 與 fallback follow-up
4. 前端可繼續下一輪輸入

### Case 9：舊 `wizardAnswers` 兼容投影正確

前提：

1. 系統仍在 V1 相容期

操作：

1. form / conversation 任一路徑更新 `confirmed_answer`

預期：

1. `project_question_states` 更新成功
2. legacy `wizardAnswers` 投影同步成功
3. draft 舊流程讀到的內容與 canonical state 一致

## 觀察指標

### 功能正確性

1. `all_confirmed` 命中率
2. `partial -> confirmed` 轉換率
3. `draft blocked because incomplete` 次數
4. `candidate confirmed without edit` 比例
5. `candidate edit_then_confirm` 比例

### 體驗有效性

1. 每完成一題平均需幾輪追問
2. voice 模式完成 29 題的平均 session 長度
3. form 模式與 conversation 模式的完成率差異
4. 使用者在核心骨架題的中斷率

## 工程驗收清單

1. API 契約文件與實作一致
2. question dependency matrix 已落在 metadata 或 planner 規則
3. schema migration 有 up/down 或可重放策略
4. 任何 error path 都有明確 error code
5. 任何 mutation 都有 audit/evidence 記錄
6. 沒有任何草稿入口可繞過 backend gate

## 最終驗收條件

只有同時滿足以下條件，才算此階段完成：

1. 29 題全部有 state model
2. form / conversation / voice 三模式共用同一套 canonical data
3. candidate / confirmed / evidence / follow-up 皆已落地
4. draft gate 確實阻擋任何未完成案例
5. 必過測試案例全部通過
