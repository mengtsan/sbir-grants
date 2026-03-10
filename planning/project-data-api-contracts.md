# 專案資料 API Contracts

## 文件目的

這份文件把「專案資料重構」的 API 介面收斂到可直接進入 backend / frontend 開發的層級。

目標：

1. 29 題 canonical schema 維持不變
2. 打字版與對話版共用同一套 project data API
3. 對話/語音只是一種 intake mode，不是另一套資料模型
4. 所有草稿生成都必須被 `all_confirmed` gate 擋住

## 官方依據

1. OpenAI Realtime API 支援低延遲多模態互動，適合瀏覽器端即時語音／文字會話。  
   來源：OpenAI Realtime API  
   https://developers.openai.com/api/docs/guides/realtime
2. OpenAI Voice Agents 文件明確指出瀏覽器端 voice agent 優先選 WebRTC，server-side agent 才偏向 WebSocket。  
   來源：OpenAI Voice Agents  
   https://developers.openai.com/api/docs/guides/voice-agents
3. OpenAI Audio 文件指出若要低延遲即時互動，應使用 Realtime API；若要高控制、可預期腳本，可走 Speech-to-text / LLM / Text-to-speech 鏈。  
   來源：OpenAI Audio and speech  
   https://developers.openai.com/api/docs/guides/audio
4. OpenAI Tools 文件指出 function calling / tools 適合把模型輸出映射成結構化資料與自訂 function。  
   來源：OpenAI Using tools  
   https://developers.openai.com/api/docs/guides/tools

## API 設計原則

1. `project_question_states` 是 canonical read model
2. 所有 UI 都讀同一套 `GET /project-data`
3. 所有寫入都回傳最新 question state，而不是只回 `ok: true`
4. 每次對話抽取都必須留下 evidence 與 provenance
5. 候選答案與 confirmed answer 必須分離
6. 所有 mutation API 都要回傳 `completion_summary`
7. draft gate 由 server 決定，不由前端自行推論

## 認證與權限

1. 所有 API 均需登入
2. project 必須屬於目前 user
3. 對話 session、question state、evidence 都以 `project_id` 做 owner boundary
4. server 端禁止跨專案讀寫 session / question 狀態

## 共用資料結構

### `CompletionSummary`

```json
{
  "confirmed_count": 18,
  "partial_count": 7,
  "missing_count": 4,
  "total_required": 29,
  "all_confirmed": false,
  "draft_generation_allowed": false
}
```

### `QuestionState`

```json
{
  "question_id": "problem_description",
  "status": "partial",
  "candidate_answer": "中小型工廠目前仰賴人工檢測，導致效率與品質不穩。",
  "confirmed_answer": null,
  "confidence": 0.82,
  "follow_up_question": "這個問題通常在哪個生產場景最明顯？",
  "evidence": [
    {
      "source_type": "conversation_turn",
      "source_ref": "turn_12",
      "raw_content": "我們現在檢查都靠老師傅肉眼看",
      "extracted_content": "人工檢測導致效率低與穩定度不足",
      "confidence": 0.87
    }
  ],
  "updated_at": "2026-03-08T12:00:00Z",
  "confirmed_at": null
}
```

### `ConversationTurn`

```json
{
  "id": "turn_12",
  "session_id": "sess_001",
  "role": "user",
  "modality": "voice",
  "content": "我們現在檢查都靠老師傅肉眼看",
  "transcript": "我們現在檢查都靠老師傅肉眼看",
  "created_at": "2026-03-08T12:00:00Z"
}
```

## 1. 讀取整份專案資料

### `GET /api/projects/:id/project-data`

用途：

1. 專案資料 tab 初始化
2. 打字模式初始化
3. 對話模式初始化
4. 草稿生成前檢查

### Response `200`

```json
{
  "project_id": "proj_123",
  "mode_capabilities": {
    "form_enabled": true,
    "conversation_enabled": true,
    "voice_enabled": true
  },
  "completion_summary": {
    "confirmed_count": 18,
    "partial_count": 7,
    "missing_count": 4,
    "total_required": 29,
    "all_confirmed": false,
    "draft_generation_allowed": false
  },
  "questions": [
    {
      "question_id": "problem_description",
      "status": "confirmed",
      "candidate_answer": "...",
      "confirmed_answer": "...",
      "confidence": 0.94,
      "follow_up_question": null,
      "updated_at": "2026-03-08T12:00:00Z",
      "confirmed_at": "2026-03-08T12:01:00Z"
    }
  ],
  "current_session": {
    "id": "sess_001",
    "mode": "conversation",
    "session_status": "active"
  }
}
```

### Error

1. `401 UNAUTHORIZED`
2. `404 PROJECT_NOT_FOUND`
3. `403 PROJECT_ACCESS_DENIED`

## 2. 單題表單寫入

### `PATCH /api/projects/:id/project-data/questions/:questionId`

用途：

1. 打字模式儲存輸入
2. 使用者手動覆蓋 candidate
3. 使用者手動補資料

### Request

```json
{
  "input_mode": "form",
  "raw_input": "我們主要是幫中小工廠做低成本 AI 瑕疵檢測。",
  "confirm": false
}
```

### 行為

1. server 寫入 raw evidence
2. server 以 question spec 重新評估該題是 `missing / partial / confirmed`
3. 若 `confirm = true`，則直接把本次答案作為 `confirmed_answer`
4. 若 `confirm = false`，server 可產生 `candidate_answer` 與 `follow_up_question`

### Response `200`

```json
{
  "question": {
    "question_id": "solution_description",
    "status": "partial",
    "candidate_answer": "團隊計畫提供低成本 AI 瑕疵檢測方案，協助中小工廠縮短檢測時間。",
    "confirmed_answer": null,
    "confidence": 0.78,
    "follow_up_question": "這套方案跟目前人工檢測相比，最主要的差異在哪裡？",
    "updated_at": "2026-03-08T12:10:00Z"
  },
  "completion_summary": {
    "confirmed_count": 18,
    "partial_count": 8,
    "missing_count": 3,
    "total_required": 29,
    "all_confirmed": false,
    "draft_generation_allowed": false
  }
}
```

### Error

1. `400 INVALID_QUESTION_ID`
2. `400 INVALID_INPUT_PAYLOAD`
3. `413 INPUT_TOO_LARGE`
4. `422 QUESTION_VALIDATION_FAILED`

## 3. 對話 session 建立

### `POST /api/projects/:id/project-data/conversation/sessions`

用途：

1. 啟動新的文字顧問 session
2. 啟動新的語音顧問 session
3. 載入或續接未完成 session

### Request

```json
{
  "mode": "voice",
  "resume": true
}
```

### Response `201`

```json
{
  "session": {
    "id": "sess_001",
    "mode": "voice",
    "session_status": "active",
    "started_at": "2026-03-08T12:20:00Z"
  },
  "bootstrap": {
    "starting_stage": "product_core",
    "next_prompt": "先從最核心的開始。你們現在最想解決的是什麼問題？",
    "priority_questions": [
      "problem_description",
      "solution_description",
      "innovation_points",
      "competitive_advantage"
    ]
  },
  "completion_summary": {
    "confirmed_count": 0,
    "partial_count": 0,
    "missing_count": 29,
    "total_required": 29,
    "all_confirmed": false,
    "draft_generation_allowed": false
  }
}
```

## 4. 對話輪次寫入與抽取

### `POST /api/projects/:id/project-data/conversation/sessions/:sessionId/turns`

用途：

1. 新增一輪文字輸入
2. 新增一輪語音 transcript
3. 讓 server 進行 extraction + evaluation + follow-up planning

### Request

```json
{
  "role": "user",
  "modality": "voice",
  "content": "我們現在是幫中小工廠做生產品質檢測，但很多客戶都還靠老師傅看。",
  "transcript": "我們現在是幫中小工廠做生產品質檢測，但很多客戶都還靠老師傅看。",
  "audio_metadata": {
    "duration_ms": 6120,
    "language": "zh-TW"
  }
}
```

### Server side 行為

1. 寫入 `conversation_turns`
2. 呼叫 extraction tool / model，把本輪對話映射到多題 candidate updates
3. 依 question spec 計算：
   - 可提升為 `partial` 的題
   - 可直接進入候選回述的題
   - 缺什麼要追問
4. 產生顧問回述與下一題 follow-up

### Response `200`

```json
{
  "turn": {
    "id": "turn_12",
    "session_id": "sess_001",
    "role": "user",
    "modality": "voice",
    "content": "我們現在是幫中小工廠做生產品質檢測，但很多客戶都還靠老師傅看。",
    "created_at": "2026-03-08T12:30:00Z"
  },
  "candidate_updates": [
    {
      "question_id": "problem_description",
      "candidate_answer": "目標客戶仍大量依賴人工檢測，造成效率與穩定度不足。",
      "confidence": 0.88,
      "evidence_turn_ids": ["turn_12"]
    },
    {
      "question_id": "target_market",
      "candidate_answer": "目標客戶為中小型工廠。",
      "confidence": 0.73,
      "evidence_turn_ids": ["turn_12"]
    }
  ],
  "assistant_summary": "我先幫你整理一下：你們主要看到的是中小工廠仍靠人工做品質檢測，因此效率與穩定性都受限。這樣理解對嗎？",
  "confirmation_targets": [
    "problem_description"
  ],
  "follow_up_targets": [
    {
      "question_id": "solution_description",
      "follow_up_question": "那你們打算用什麼方式取代或改善這種人工檢測流程？"
    }
  ],
  "completion_summary": {
    "confirmed_count": 3,
    "partial_count": 5,
    "missing_count": 21,
    "total_required": 29,
    "all_confirmed": false,
    "draft_generation_allowed": false
  }
}
```

### Error

1. `400 INVALID_SESSION_ID`
2. `400 EMPTY_TRANSCRIPT`
3. `413 TURN_PAYLOAD_TOO_LARGE`
4. `422 EXTRACTION_FAILED`
5. `500 SESSION_WRITE_FAILED`

## 5. 候選答案確認

### `POST /api/projects/:id/project-data/questions/:questionId/confirm`

用途：

1. 對 AI 回述的候選答案按確認
2. 使用者修正後確認
3. 把 `candidate_answer` 轉為 `confirmed_answer`

### Request

```json
{
  "source": "conversation",
  "candidate_answer": "目標客戶仍大量依賴人工檢測，造成效率與穩定性不足。",
  "final_answer": "目前多數中小型工廠仍依賴老師傅以人工方式做品質檢測，造成檢測速度慢、標準不一且良率改善困難。",
  "confirmation_action": "edit_then_confirm"
}
```

### Response `200`

```json
{
  "question": {
    "question_id": "problem_description",
    "status": "confirmed",
    "candidate_answer": "目標客戶仍大量依賴人工檢測，造成效率與穩定性不足。",
    "confirmed_answer": "目前多數中小型工廠仍依賴老師傅以人工方式做品質檢測，造成檢測速度慢、標準不一且良率改善困難。",
    "confidence": 0.96,
    "follow_up_question": null,
    "updated_at": "2026-03-08T12:35:00Z",
    "confirmed_at": "2026-03-08T12:35:00Z"
  },
  "completion_summary": {
    "confirmed_count": 4,
    "partial_count": 4,
    "missing_count": 21,
    "total_required": 29,
    "all_confirmed": false,
    "draft_generation_allowed": false
  }
}
```

## 6. 取得下一輪追問建議

### `POST /api/projects/:id/project-data/follow-up-plan`

用途：

1. 表單模式下，使用者想知道下一個該補哪題
2. 對話模式斷線後重新規劃下一輪追問
3. 讓 UI 顯示「下一步建議」

### Request

```json
{
  "context": {
    "mode": "form",
    "recent_question_ids": [
      "problem_description",
      "solution_description"
    ]
  }
}
```

### Response `200`

```json
{
  "recommended_next_question_id": "innovation_points",
  "reason": "產品核心與解法已初步形成，下一步應先鎖定創新點，避免後續差異化與技術門檻失焦。",
  "follow_up_question": "如果要用一句話說，你們這個解法最新、最不同的地方是什麼？",
  "blocking_questions": [
    "innovation_points",
    "competitive_advantage",
    "technical_barriers"
  ]
}
```

## 7. 草稿生成 gate 檢查

### `GET /api/projects/:id/project-data/draft-readiness`

用途：

1. 草稿頁載入前
2. 使用者點「開始生成」前
3. backend 真正呼叫草稿生成前

### Response `200`

```json
{
  "project_id": "proj_123",
  "draft_generation_allowed": false,
  "blocking_questions": [
    {
      "question_id": "technical_barriers",
      "status": "partial",
      "reason": "內容仍停留在一般功能描述，尚未明確說明競爭者難以模仿的技術門檻。"
    },
    {
      "question_id": "quantified_benefits",
      "status": "missing",
      "reason": "尚未提供任何量化效益。"
    }
  ],
  "completion_summary": {
    "confirmed_count": 27,
    "partial_count": 1,
    "missing_count": 1,
    "total_required": 29,
    "all_confirmed": false,
    "draft_generation_allowed": false
  }
}
```

## 8. Realtime / 語音會話輔助

### `POST /api/projects/:id/project-data/realtime/session`

用途：

1. 前端瀏覽器建立 voice mode session 時，取得暫時性 client secret 或 server-issued session data
2. server 把 project context、mode、tool policy 帶入 Realtime session config

### Request

```json
{
  "mode": "voice",
  "language": "zh-TW"
}
```

### Response `200`

```json
{
  "transport": "webrtc",
  "session_config": {
    "client_secret": "ephemeral_or_client_secret",
    "model": "gpt-realtime",
    "instructions_version": "project-data-v1",
    "tooling": [
      "extract_project_slots",
      "plan_follow_up"
    ]
  },
  "conversation_session_id": "sess_001"
}
```

### 設計備註

1. 若 voice mode 採 browser-side realtime，優先 WebRTC
2. 若未來要由 server 代理 voice orchestration，再考慮 WebSocket
3. 即使採 Realtime，最終寫回仍必須走本系統的 canonical question state

## 9. 版本策略

### V1

1. `wizardAnswers` 仍存在
2. 新 API 寫入 `project_question_states`
3. server 同步投影到 `wizardAnswers`
4. 舊草稿先讀投影結果

### V2

1. 草稿生成改直接讀 `project_question_states.confirmed_answer`
2. `wizardAnswers` 退為兼容層或移除

## 10. Backend 實作順序建議

1. `GET /project-data`
2. `PATCH /questions/:questionId`
3. `POST /questions/:questionId/confirm`
4. `POST /conversation/sessions`
5. `POST /conversation/sessions/:sessionId/turns`
6. `GET /draft-readiness`
7. `POST /realtime/session`

## 11. 驗收重點

1. 同一套 API 可同時支援打字與對話
2. 對話輸入可一次更新多題
3. 任一題都保留 evidence 與 confirmation history
4. `draft_generation_allowed` 必須只由 server 決定
5. 29 題未全 confirmed 時，draft gate 必須回 false
