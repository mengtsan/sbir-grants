# 專案資料前端互動規格

## 文件目的

這份文件把專案資料重構後的前端資訊架構、狀態流與互動模式收斂成可直接切版與切 state management 的規格。

目標：

1. 同一個「專案資料」tab 內同時支援打字版與對話／語音版
2. 使用者永遠看得到 29 題完成狀態
3. 對話不脫離 canonical schema
4. 不讓使用者在未完成 29 題時誤以為可以產生草稿

## 官方依據

1. OpenAI Realtime / Voice 文件支援低延遲語音互動，適合在單頁介面內做即時語音顧問模式。  
   來源：OpenAI Realtime API  
   https://developers.openai.com/api/docs/guides/realtime  
   來源：OpenAI Voice Agents  
   https://developers.openai.com/api/docs/guides/voice-agents
2. OpenAI Tools 文件可用於把對話結果結構化成欄位更新，不需要前端自己推論欄位寫回。  
   來源：OpenAI Using tools  
   https://developers.openai.com/api/docs/guides/tools

## 資訊架構

單一 `Project Data` 頁面拆成四塊：

1. `Header Summary`
2. `Mode Switcher`
3. `Interaction Panel`
4. `Question Status Sidebar`

## 1. Header Summary

必須顯示：

1. 完成度：`confirmed / 29`
2. `partial` 題數
3. `missing` 題數
4. 草稿狀態：
   - `尚不可生成草稿`
   - `已可生成草稿`

### 顯示文案原則

1. 不說「差不多完成」
2. 直接說還缺幾題
3. 若 blocked，顯示前 3 個 blocking questions

## 2. Mode Switcher

模式：

1. `表單填寫`
2. `顧問對話`
3. `語音訪談`

規則：

1. 三模式共用同一份 project data state
2. 切模式不重置資料
3. 切模式後 sidebar 顯示的 question state 不變

## 3. Interaction Panel

### A. 表單填寫模式

用途：

1. 使用者逐題填寫
2. 使用者修正 AI 候選答案
3. 使用者補充細節

元件：

1. question list
2. question editor
3. candidate hint
4. follow-up hint
5. confirm CTA

每題應顯示：

1. 題目
2. 狀態 badge：`missing / partial / confirmed`
3. 現有 confirmed answer 或 candidate answer
4. follow-up hint
5. `儲存` / `確認此題`

### B. 顧問對話模式

用途：

1. AI 用文字顧問方式追問
2. 每輪對話後產生 candidate updates
3. 使用者確認 AI 回述

元件：

1. conversation transcript
2. assistant summary card
3. confirmation box
4. follow-up prompt
5. extracted question chips

每輪回應應至少顯示：

1. AI 顧問回述
2. 本輪抽到哪些題
3. 哪些題從 `missing -> partial` 或 `partial -> confirmed`
4. 下一個追問

### C. 語音訪談模式

用途：

1. 使用者直接講
2. 前端即時顯示 transcript
3. AI 顧問即時回述與追問

元件：

1. 麥克風狀態
2. 即時 transcript stream
3. assistant summary card
4. extracted question chips
5. `暫停 / 繼續 / 結束並整理`

第一版不要求：

1. 複雜波形視覺
2. 多人對話辨識
3. 背景降噪自訂參數

## 4. Question Status Sidebar

這一塊是整個頁面的 anchor，不可省。

用途：

1. 讓使用者知道 29 題目前補到哪裡
2. 顯示缺漏題
3. 可點擊跳題

分組：

1. 核心骨架
2. 問題驗證與市場
3. 可行性與團隊
4. 經費與成果
5. 基本資訊

每題顯示：

1. label
2. 狀態顏色
3. 是否有 follow-up
4. 點擊後切到對應題或對應上下文

## 互動規則

### 規則 1：對話結果不得靜默覆蓋 confirmed answer

若某題已 `confirmed`：

1. 新對話抽到相同題，只能先產生新 candidate
2. UI 要顯示：
   - 目前已確認答案
   - 新候選答案
   - 使用者決定是否覆蓋

### 規則 2：AI 回述必須可被修正

使用者操作：

1. `直接確認`
2. `編輯後確認`
3. `補充後確認`
4. `不對，請重整`

### 規則 3：草稿入口永遠可見，但未完成時要 blocked

原因：

1. 使用者要知道最終目標是草稿
2. 但不能誤會現在已可生成

UI：

1. 顯示按鈕
2. disabled state
3. 點擊後顯示 blocking questions

## 前端狀態模型

建議拆成：

### `projectDataStore`

保存：

1. `questions[]`
2. `completion_summary`
3. `current_mode`
4. `current_session_id`
5. `draft_generation_allowed`

### `conversationStore`

保存：

1. `session`
2. `turns[]`
3. `pending_candidate_updates[]`
4. `assistant_summary`
5. `follow_up_targets[]`
6. `connection_status`

### `editorStore`

保存：

1. active question
2. form draft value
3. dirty state
4. confirm dialog state

## 前端事件流

### 打字模式

1. load `/project-data`
2. user edit question
3. PATCH `/questions/:questionId`
4. 更新 local question state
5. 若有 follow-up，UI 顯示追問提示

### 顧問對話模式

1. POST `/conversation/sessions`
2. user send turn
3. POST `/conversation/sessions/:sessionId/turns`
4. 更新 transcript / summary / candidate chips
5. 若 user confirm，POST `/questions/:questionId/confirm`
6. refresh completion summary

### 語音模式

1. POST `/realtime/session`
2. 建立 WebRTC / client realtime session
3. 收 transcript / turn event
4. turn 完成後走 `/conversation/sessions/:sessionId/turns`
5. 更新 question states

## Loading / Error 狀態

### 必須處理的錯誤

1. session 建立失敗
2. transcript 抽取失敗
3. confirm 寫回失敗
4. draft readiness 檢查失敗
5. realtime session 過期

### UI 原則

1. conversation turn 存成功但 extraction 失敗時，不可吃掉使用者內容
2. 必須讓使用者看得到這輪內容已保存，但需稍後重試整理
3. 若 voice mode 掛掉，要能無縫切回文字顧問模式

## 驗收重點

1. 單頁內可切換三模式且 state 不丟
2. sidebar 永遠反映 server 回傳的 canonical state
3. 對話 / 語音每輪都能看見：
   - 抽到哪些題
   - 哪些題仍缺
   - 下一步問什麼
4. 已 confirmed 的題不會被靜默覆蓋
5. draft 按鈕在未完成時只能顯示 blocked，不可誤進下一步
