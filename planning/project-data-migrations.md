# 專案資料重構 Migration 規格

## 文件目的

這份文件把專案資料重構所需的資料表、索引、投影策略與 migration 順序收斂成可直接實作的 backend 規格。

目標：

1. 不破壞既有 `wizardAnswers` 流程
2. 先落地 canonical state tables
3. 允許 form / conversation / voice 三模式共用同一份資料
4. 保留 audit trail、evidence、confirmation history

## 官方依據

1. SQLite 支援外鍵、索引與交易，適合用來保存狀態表、事件表與 audit trail。  
   來源：SQLite CREATE TABLE  
   https://www.sqlite.org/lang_createtable.html
2. SQLite `PRAGMA foreign_keys` 文件說明外鍵需明確開啟並遵守約束。  
   來源：SQLite Foreign Key Support  
   https://www.sqlite.org/foreignkeys.html
3. Cloudflare D1 採 SQLite 相容 SQL，適合先以 migration 漸進增加資料表與索引。  
   來源：Cloudflare D1 SQL API  
   https://developers.cloudflare.com/d1/sql-api/sql-statements/
4. Cloudflare D1 migration / execute 指令可用於版本化 schema 變更。  
   來源：Cloudflare D1 Wrangler Commands  
   https://developers.cloudflare.com/d1/wrangler-commands/

## 設計原則

1. canonical state 與 legacy 投影分離
2. 所有 write path 先寫 canonical，再同步投影到 legacy
3. 所有 conversation turn 與 question evidence 都保留，不做覆蓋式更新
4. confirmed answer 必須是顯式確認結果，不得由模型直接覆蓋
5. 所有 mutation 應包在 transaction 中，避免 question state 與 evidence 分離

## 新資料表

### 1. `project_question_states`

用途：

1. 每題當前狀態 read model
2. 草稿 gate 的唯一判斷來源
3. form / conversation / voice 共用

```sql
CREATE TABLE project_question_states (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('missing', 'partial', 'confirmed')),
  candidate_answer TEXT,
  confirmed_answer TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  follow_up_question TEXT,
  last_source_type TEXT,
  last_source_ref TEXT,
  last_confirmed_at DATETIME,
  last_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, question_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

建議索引：

```sql
CREATE INDEX idx_pqs_project_status
ON project_question_states(project_id, status);

CREATE INDEX idx_pqs_project_updated_at
ON project_question_states(project_id, last_updated_at DESC);
```

### 2. `project_question_evidence`

用途：

1. 保存 raw utterance / form raw input / extract result
2. 支援追溯與 debug
3. 支援之後做品質分析與 prompt 調整

```sql
CREATE TABLE project_question_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  extracted_content TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

建議索引：

```sql
CREATE INDEX idx_pqe_project_question
ON project_question_evidence(project_id, question_id, created_at DESC);

CREATE INDEX idx_pqe_source_ref
ON project_question_evidence(source_ref);
```

### 3. `conversation_sessions`

用途：

1. 保存一段 project-data 訪談會話
2. 支援 resume / analytics / recoverability

```sql
CREATE TABLE conversation_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('conversation', 'voice')),
  session_status TEXT NOT NULL CHECK (session_status IN ('active', 'completed', 'abandoned', 'errored')),
  bootstrap_stage TEXT,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

建議索引：

```sql
CREATE INDEX idx_cs_project_status
ON conversation_sessions(project_id, session_status, started_at DESC);
```

### 4. `conversation_turns`

用途：

1. 保存逐輪互動
2. 文字與語音 transcript 共用
3. 支援 extraction 重跑與 audit

```sql
CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  modality TEXT NOT NULL CHECK (modality IN ('text', 'voice')),
  content TEXT NOT NULL,
  transcript TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'succeeded', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
);
```

建議索引：

```sql
CREATE INDEX idx_ct_session_created_at
ON conversation_turns(session_id, created_at ASC);

CREATE INDEX idx_ct_session_extraction_status
ON conversation_turns(session_id, extraction_status);
```

### 5. `question_confirmations`

用途：

1. 保存 candidate 到 final 的確認紀錄
2. 支援 `confirm / edit_then_confirm / reject` 分析

```sql
CREATE TABLE question_confirmations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  candidate_answer TEXT NOT NULL,
  final_answer TEXT NOT NULL,
  confirmation_action TEXT NOT NULL CHECK (confirmation_action IN ('confirm', 'edit_then_confirm', 'append_then_confirm')),
  confirmed_by TEXT NOT NULL,
  source_ref TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

建議索引：

```sql
CREATE INDEX idx_qc_project_question
ON question_confirmations(project_id, question_id, created_at DESC);
```

## 不新增資料表但需調整的欄位

### `projects`

短期可不動 schema，但建議中期補一個 read-only completion 快取欄位，避免列表頁每次掃 29 題。

候選欄位：

```sql
ALTER TABLE projects ADD COLUMN project_data_completion_json TEXT DEFAULT '{}';
```

這欄可延後，不是第一波 blocker。

## Migration 順序

### M1：建立 canonical state tables

1. `project_question_states`
2. `project_question_evidence`
3. `conversation_sessions`
4. `conversation_turns`
5. `question_confirmations`

### M2：回填既有專案的 29 題空狀態

對所有既有 project：

1. 建 29 筆 `project_question_states`
2. 預設 `status = missing`
3. 若 `wizardAnswers` 已有值，則：
   - `candidate_answer = wizardAnswers[question_id]`
   - `confirmed_answer = wizardAnswers[question_id]`
   - `status = confirmed`
   - `last_source_type = 'legacy_migration'`

注意：

1. 若 legacy 值為空字串或純空白，仍視為 `missing`
2. 若 legacy 欄位存在但明顯不符合 validation，可考慮先標 `partial`
3. 第一版為降低風險，可先全部映射成 `confirmed`，但需在 PRD 註記這是 migration 特例，不是未來寫入規則

### M3：上線 dual-write

所有現有寫入流程改成：

1. 寫 canonical `project_question_states`
2. 寫 evidence
3. 同步投影回 `wizardAnswers`

### M4：draft gate 改讀 canonical

1. 草稿生成前先查 29 題是否全 `confirmed`
2. 若否，直接回阻擋資訊
3. 這步完成後，`wizardAnswers` 才真正退居 compat layer

## 交易邊界

所有以下操作都應使用 transaction：

### 表單寫入

1. upsert `project_question_states`
2. insert `project_question_evidence`
3. 同步更新 legacy `wizardAnswers`

### 對話抽取寫回

1. insert `conversation_turns`
2. insert 多筆 `project_question_evidence`
3. update / upsert 多筆 `project_question_states`
4. 必要時 update `conversation_turns.extraction_status`

### 確認候選答案

1. insert `question_confirmations`
2. update `project_question_states`
3. 同步更新 legacy `wizardAnswers`

## Backfill 風險與處理

### 風險 1：legacy `wizardAnswers` 結構不齊

處理：

1. backfill script 對不存在 key 直接建 `missing`
2. 對 null / 空字串 / 空陣列做 normalize

### 風險 2：同 project 有不一致舊資料

處理：

1. canonical 先以 `wizardAnswers` 最終值為準
2. 不嘗試從歷史 prompt 或生成內容回推

### 風險 3：migration 太大造成 D1 execute 風險

處理：

1. schema migration 與 data backfill 分開
2. backfill 走 chunked script，不直接塞在單一 schema SQL 中

## 實作輸出建議

### SQL migration 檔

1. `0012_project_question_states.sql`
2. `0013_conversation_sessions.sql`
3. `0014_question_confirmations.sql`

### Node / TS backfill script

1. 讀所有 project
2. 讀 `wizardAnswers`
3. 產生 29 題初始 state
4. chunked batch 寫入 D1

## 驗收條件

1. 新表建立成功
2. 既有 project 都有 29 筆 state row
3. dual-write 後 form mode 更新 canonical 與 legacy 一致
4. 對話 turn、evidence、confirmation 可追溯
5. schema migration 與 backfill 可重跑，不會產生重複 row
