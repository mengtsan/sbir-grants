# 專案資料 Schema v2 設計

## 文件目的

這份文件定義專案資料在下一階段重構後的 canonical schema、欄位狀態模型與資料持久化設計。

目標：

1. 保留 29 題 canonical schema
2. 支援打字與對話共用
3. 支援候選答案、確認、追問與證據留痕

## 設計原則

1. 29 題是唯一 truth model
2. 對話只是輸入模式，不是另一套 schema
3. 一題可有：
   - raw input
   - candidate answer
   - confirmed answer
4. 每題都要有狀態與證據
5. 草稿只吃 confirmed data

## 1. Canonical Question Model

每一題要有固定 metadata：

```json
{
  "question_id": "problem_description",
  "category": "問題陳述",
  "label": "請描述您要解決的核心問題",
  "required": true,
  "input_modes": ["form", "conversation", "voice"],
  "status_policy": {
    "allow_partial": true,
    "requires_user_confirmation": true
  }
}
```

## 2. Question Status Model

每題狀態：

1. `missing`
2. `partial`
3. `confirmed`

定義：

### `missing`

1. 沒有內容
2. 或內容無法用於判斷該題

### `partial`

1. 有內容
2. 但不足以支撐草稿
3. 需要追問或補充

### `confirmed`

1. 有內容
2. 內容達最低可用標準
3. 使用者已確認

## 3. 每題資料結構

建議每題在 DB / API 層都長成：

```json
{
  "question_id": "problem_description",
  "status": "partial",
  "raw_answers": [
    {
      "source": "conversation",
      "turn_id": "turn_12",
      "content": "我們想解決人工檢測太慢的問題",
      "created_at": "2026-03-08T11:00:00Z"
    }
  ],
  "candidate_answer": "中小型工廠目前仰賴人工檢測，造成檢測效率低、成本高且品質不穩定。",
  "confirmed_answer": null,
  "confidence": 0.82,
  "evidence_turn_ids": ["turn_12", "turn_13"],
  "follow_up_question": "這個問題主要發生在哪些工廠場景？",
  "updated_at": "2026-03-08T11:01:00Z"
}
```

## 4. 建議資料表

### 4.1 `project_question_states`

保存每題的 canonical 狀態。

```sql
CREATE TABLE project_question_states (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  status TEXT NOT NULL,
  candidate_answer TEXT,
  confirmed_answer TEXT,
  confidence REAL DEFAULT 0,
  follow_up_question TEXT,
  last_confirmed_at DATETIME,
  last_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, question_id)
);
```

### 4.2 `project_question_evidence`

保存證據來源。

```sql
CREATE TABLE project_question_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  extracted_content TEXT,
  confidence REAL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 `conversation_sessions`

保存一段訪談 session。

```sql
CREATE TABLE conversation_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  session_status TEXT NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

### 4.4 `conversation_turns`

保存逐輪對話。

```sql
CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  modality TEXT NOT NULL,
  content TEXT NOT NULL,
  transcript TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
);
```

### 4.5 `question_confirmations`

保存候選答案被確認或修正的歷程。

```sql
CREATE TABLE question_confirmations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  candidate_answer TEXT NOT NULL,
  final_answer TEXT NOT NULL,
  confirmation_action TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 5. API 結構建議

### 5.1 取完整專案資料狀態

`GET /api/projects/:id/project-data`

回傳：

```json
{
  "project_id": "xxx",
  "completion_summary": {
    "confirmed_count": 12,
    "partial_count": 9,
    "missing_count": 8,
    "all_confirmed": false
  },
  "questions": [
    {
      "question_id": "problem_description",
      "status": "confirmed",
      "confirmed_answer": "...",
      "candidate_answer": "...",
      "follow_up_question": null,
      "confidence": 0.92
    }
  ]
}
```

### 5.2 寫入表單答案

`PATCH /api/projects/:id/project-data/questions/:questionId`

用途：

1. 打字版直接更新
2. 或對話版確認後正式寫入

### 5.3 對話抽取寫回

`POST /api/projects/:id/project-data/conversation/extract`

輸入：

1. transcript / user utterance
2. session context

輸出：

1. candidate updates
2. follow-up targets

### 5.4 確認候選答案

`POST /api/projects/:id/project-data/questions/:questionId/confirm`

用途：

1. 候選答案轉 confirmed
2. 或讓使用者補述後確認

## 6. 與現有 `wizardAnswers` 的關係

### 相容策略

短期不必馬上移除 `wizardAnswers`，可以作為兼容層：

1. 新系統寫入 `project_question_states`
2. 同步投影回舊的 `wizardAnswers`
3. 舊草稿系統先繼續讀 `wizardAnswers`

### 中期目標

草稿生成應改成直接讀：

1. `confirmed_answer`
2. 而不是舊的自由字串 map

## 7. 欄位依賴關係

### 高依賴鏈

1. `problem_description` -> `solution_description`
2. `solution_description` -> `innovation_points`
3. `innovation_points` -> `competitive_advantage`
4. `target_market` -> `market_size`
5. `business_model` -> `expected_revenue_year1~3`
6. `expected_revenue_year1~3` -> `revenue_calculation_basis`

### 產品邏輯意義

若前面題目未 confirmed，後面題目很容易失真。

## 8. 完成度計算

```text
completion_ratio = confirmed_questions / 29
```

但草稿是否允許生成，不看 ratio，只看：

```text
all 29 questions status == confirmed
```

## 9. 草稿生成 Gate

草稿生成前系統必須檢查：

1. 是否仍有 `missing`
2. 是否仍有 `partial`

若有，回傳：

```json
{
  "error": "PROJECT_DATA_INCOMPLETE",
  "missing_questions": [...],
  "partial_questions": [...],
  "next_recommended_question": "..."
}
```

## 10. 語音模式如何接進 schema

Realtime / voice 模式不改 schema，只改 input source：

1. 語音
2. transcript
3. candidate extraction
4. candidate confirmation
5. writeback to `project_question_states`

## 11. 日誌與審計要求

每題都應可追溯：

1. 這題目前答案從哪一輪對話來
2. 是 AI 自動整理的還是使用者手改的
3. 是誰確認的

## 12. 第一版最小必要欄位

若想先做最小可用版本，第一版最少要有：

1. `status`
2. `candidate_answer`
3. `confirmed_answer`
4. `confidence`
5. `follow_up_question`
6. `evidence_turn_ids`

## 主要外部依據

1. OpenAI Realtime Guide  
   https://platform.openai.com/docs/guides/realtime
2. OpenAI Voice Agents Guide  
   https://platform.openai.com/docs/guides/voice-agents
3. OpenAI Audio Guide  
   https://platform.openai.com/docs/guides/audio
4. OpenAI Tools / Function Calling  
   https://platform.openai.com/docs/guides/tools?api-mode=responses
