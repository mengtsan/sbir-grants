# 專案資料重構實作拆分

## 文件目的

這份文件把專案資料重構拆成可排期、可分工、可驗收的工程任務。

## 任務原則

1. 先改資料模型，再改 UI
2. 先讓打字版吃新 engine，再接對話版
3. 先讓文字對話走通，再接語音模式
4. 任何階段都不能破壞既有 draft 流程

## Phase 0：基礎盤點與兼容準備

### P0-1 問題 metadata 整理

輸出：

1. `questions.json` 新增 metadata：
   - `priority`
   - `conversation_order`
   - `form_order_v2`
   - `depends_on`
   - `auto_extractable`
   - `conversation_friendly`

### P0-2 question spec registry

輸出：

1. server 可讀的 question spec registry
2. 每題的 `missing / partial / confirmed` 判準函式

### P0-3 migration 與 backfill script

輸出：

1. 新 tables migration
2. legacy `wizardAnswers` 回填 script

## Phase 1：Canonical state 落地

### P1-1 `GET /project-data`

輸出：

1. 讀 29 題 state
2. 算 completion summary
3. 回 draft readiness

### P1-2 `PATCH /questions/:questionId`

輸出：

1. 表單單題寫入
2. evidence 留存
3. dual-write to `wizardAnswers`

### P1-3 `POST /questions/:questionId/confirm`

輸出：

1. candidate -> confirmed
2. confirmation history
3. dual-write to legacy

### P1-4 `GET /draft-readiness`

輸出：

1. blocking questions
2. all_confirmed gate

### Phase 1 驗收

1. 打字模式已能完全走新 canonical state
2. draft gate 已由 server 判斷
3. 舊 draft 流程仍可用

## Phase 2：打字版 UI 重構

### P2-1 專案資料頁 state store 重構

輸出：

1. `projectDataStore`
2. 29 題狀態渲染
3. 新完成度 header

### P2-2 打字版順序重排

輸出：

1. 打字版改用 `form_order_v2`
2. 前 10 題先呈現核心骨架題

### P2-3 question sidebar

輸出：

1. 29 題狀態 sidebar
2. missing / partial / confirmed 可視化

### Phase 2 驗收

1. 打字版可不依原始 `order`
2. 使用者清楚知道還缺哪些題
3. 未完成時 draft 入口 blocked

## Phase 3：文字顧問模式

### P3-1 session / turn backend

輸出：

1. `POST /conversation/sessions`
2. `POST /conversation/sessions/:id/turns`

### P3-2 extraction orchestrator

輸出：

1. model tool call -> candidate updates
2. evaluator -> follow-up planning
3. assistant summary builder

### P3-3 前端顧問對話 UI

輸出：

1. transcript panel
2. assistant summary card
3. extracted question chips
4. confirm flow

### Phase 3 驗收

1. 一輪對話可更新多題
2. AI 會追問，不會直接放飛補完
3. confirmed 前不覆蓋 final answer

## Phase 4：語音模式

### P4-1 realtime session bootstrap

輸出：

1. `POST /realtime/session`
2. WebRTC session init policy

### P4-2 transcript ingestion

輸出：

1. voice -> transcript -> conversation turn
2. 與文字模式共用 extraction pipeline

### P4-3 前端語音模式

輸出：

1. mic control
2. transcript stream
3. fallback to text mode

### Phase 4 驗收

1. 語音模式結果回同一份 29 題 state
2. 可切回打字版繼續補同一份資料
3. transcript/evidence 可追溯

## Phase 5：切換草稿讀取來源

### P5-1 草稿服務改讀 canonical confirmed data

輸出：

1. draft service 優先讀 `project_question_states.confirmed_answer`
2. `wizardAnswers` 改為 compat fallback

### P5-2 完成 dual-read -> single-source

輸出：

1. `wizardAnswers` 退役計畫
2. 風險回滾方案

## 風險管理

### 風險 1：extractor 過度樂觀，誤把 partial 當 confirmed

處理：

1. question spec 必須有明確判準
2. confirmed 一律需要 user confirmation

### 風險 2：語音體驗太重，拖慢第一版

處理：

1. Phase 4 後置
2. Phase 3 先用文字顧問模式驗證 state machine

### 風險 3：legacy draft 與 canonical state 不一致

處理：

1. dual-write + acceptance case
2. 最晚 Phase 5 切單一資料來源

## 建議 Sprint 切法

### Sprint 1

1. P0-1
2. P0-2
3. P0-3
4. P1-1
5. P1-2
6. P1-3
7. P1-4

### Sprint 2

1. P2-1
2. P2-2
3. P2-3
4. Phase 1/2 驗收修正

### Sprint 3

1. P3-1
2. P3-2
3. P3-3

### Sprint 4

1. P4-1
2. P4-2
3. P4-3
4. P5-1 規劃

## 最終交付物

1. canonical schema tables
2. dual-write backend
3. form mode v2
4. conversation mode
5. voice mode bootstrap
6. draft gate
7. acceptance suite
