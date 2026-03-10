# 草稿生成完整性修正計劃 v2

## 結論先講

前一版計劃不合理，主要錯在三點：

1. 把問題寫成「生成一致性工程」，但沒有先把最核心的不變條件講死。
2. 把 `snapshot tables` 提得太早，變成大工程，卻沒有先封住真正的致命錯誤。
3. 仍然保留了「單章節可各自判斷」的思路，這和目前已確認的產品規則衝突：
   - `29 題本來就是必填`
   - `29 題沒齊，不准生成`

這份 v2 計劃改成先處理真正的根因：

1. `project_answers` 成為唯一真相來源。
2. `wizardAnswers` 不再作為可寫入的正式資料來源。
3. 生成前一律先檢查 29 題是否真的都在 DB。
4. 任一題缺失，整個生成直接阻擋。
5. 移除「請依上下文合理推估」這種錯誤 fallback。

---

## 這次要解的兩個線上問題

### 問題 A

使用者答完多題後，到了生成階段，資料像是消失。

### 問題 B

生成內容跳到完全不相干的產業，例如醫療、智慧監控。

這兩個問題不是彼此無關，而是一條錯誤鏈：

1. 回答沒有穩定落到 `project_answers`
2. 生成時讀不到真實答案
3. 生成端仍允許 fallback 推估
4. 模型開始產生不屬於該專案的內容

---

## 三輪自檢後的修正原則

## 第一輪：需求對齊

已確認的產品規則：

1. 29 題全部必填。
2. 29 題沒完成，不准生成草稿。
3. 使用者答一題，就應該立即寫入資料庫。
4. 生成內容只能基於使用者資料，不能自行補產業敘事。

因此：

- 不需要先做「章節級容錯策略」
- 不需要先做「缺部分題目也可單章生成」
- 不需要先做「最佳努力生成」

正確策略只有一個：

- `fail closed`

---

## 第二輪：資料流檢查

真正該鎖住的不變條件如下：

1. `project_answers` 是唯一正式答案來源。
2. 前端顯示的 `wizardAnswers` 只是相容層投影，不是正式寫入來源。
3. 所有生成 API 在開始前，都必須重新從 DB 驗證 29 題完整性。
4. 任何生成結果都不得建立在前端暫存狀態上。

因此目前真正要拆掉的，不是只有 fallback，而是整個舊資料流殘留：

1. `PUT /projects/:id` 仍可透過 `progress_data.wizardAnswers` 回寫答案。
2. `GET /projects/:id` 仍把 `wizardAnswers` 嵌回 `progress_data` 給舊前端相容。
3. 草稿生成端沒有把「29 題完整」當成硬門檻。

其中第 2 點可以暫時保留作為讀取相容層，
但第 1 點不能再是正式寫入通道。

---

## 第三輪：技術前提校對

前一版把 `snapshot tables` 拉得太前面，技術上不是做不到，但目前不是第一優先。

依據：

1. Cloudflare D1 Worker API 官方文件說明 `batch()` 是用來減少 round trips，不是高階工作流協調工具。  
   來源：Cloudflare D1 Worker API  
   https://developers.cloudflare.com/d1/worker-api/d1-database/

2. Cloudflare D1 SQL Statements 官方文件說明 D1 使用 SQL statements / SQLite 相容語意，但這不代表一開始就需要額外設計三張 snapshot table 才能解目前的 bug。  
   來源：Cloudflare D1 SQL Statements  
   https://developers.cloudflare.com/d1/sql-api/sql-statements/

3. SQLite transaction 官方文件強調 transaction 是原子性的資料更新單位；但目前的主要故障不是 transaction 不存在，而是產品邏輯沒有先做完整性 gate。  
   來源：SQLite Transactions  
   https://www.sqlite.org/lang_transaction.html

4. HTTP PATCH 官方文件定義的是 partial update 語意，不會替應用層保證「整份專案資料已可生成」。  
   來源：MDN PATCH  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/PATCH

結論：

- `snapshot` 可以做，但不該是第一步。
- 第一優先應該是把「可生成」定義成 server 端可驗證的硬條件。

---

## 正確的修正目標

這次修正的完成條件應該是：

1. 使用者每答一題，答案立即寫入 `project_answers`。
2. 生成前，server 能明確判斷 29 題是否完整。
3. 若 29 題未齊，任何章節與全部生成都直接阻擋。
4. 生成 prompt 內不再允許「合理推估」這類 fallback 指令。
5. 已污染的章節資料不再被視為有效草稿。

---

## 修正策略

## Phase 0：先定正式不變條件

先把規則寫死，程式碼全部照這些規則收斂：

1. `project_answers` 是唯一正式答案來源。
2. `wizardAnswers` 只能是讀取投影，不是正式寫入來源。
3. 29 題任一題缺失，就不允許生成任何草稿。
4. 草稿生成不得使用 fallback 推估填空。

這一步不是文件工作，而是後續每支 API 都要照這個規則對齊。

---

## Phase 1：封住寫入通道

### 目標

把答案寫入路徑收斂成單一通道，避免再出現「前端看起來答完，但 DB 沒有」。

### 要做的事

1. 保留並使用：
   - `PATCH /api/projects/:id/answers/:questionId`

2. 把舊寫法降級成相容層，不再作為正式答案寫入通道：
   - `PUT /api/projects/:id` 若收到 `progress_data.wizardAnswers`
   - 後端應記錄 warning
   - 但不再把它當成主要寫入模型

3. 前端專案資料頁所有答題存檔，統一走單題 PATCH。

### 驗收

1. 任一題送出後，可立即在 `project_answers` 查到。
2. `progress_data` 即使壞掉，也不會影響正式答案。

---

## Phase 2：新增生成前預檢，並把規則改成「29 題全有才可生成」

### 目標

把「可不可以生成」變成 server 端的硬判斷，不再靠前端感覺。

### API

新增：

- `GET /api/projects/:id/draft-preflight`

### 回傳結構

```json
{
  "ready": false,
  "answered_count": 27,
  "required_count": 29,
  "missing_question_ids": ["problem_description", "innovation_points"],
  "missing_questions": [
    {
      "id": "problem_description",
      "question": "..."
    }
  ]
}
```

### 規則

1. `answered_count !== 29` 時，`ready = false`
2. `missing_question_ids.length > 0` 時，`ready = false`
3. `全部生成` 與 `單章節生成` 都必須先過這個檢查

### 關鍵調整

這裡明確放棄前一版的：

- `can_generate_sections`
- `blocking_sections`
- `單章節 relevant questions 缺失就只擋單章`

原因是目前產品規則已經講死：

- `29 題沒齊，不准生成`

所以第一版根本不需要做 section-level 彈性判斷。

---

## Phase 3：生成端改成 fail-closed

### 目標

讓生成端在資料不足時「不產生內容」，而不是「產生看似合理的假內容」。

### 要做的事

1. 移除 [ai.ts](/Users/backtrue/Documents/claude-sbir-skills/saas/backend/src/ai.ts) 中這段：

```ts
if (!hasData) {
    chunkContext += "(使用者未提供直接相關資訊，請依上下文合理推估)\n";
}
```

2. 在所有生成入口加上前置檢查：
   - 若 `draft-preflight.ready !== true`
   - 直接回 `409`

建議錯誤格式：

```json
{
  "error": "PROJECT_DATA_INCOMPLETE",
  "missing_question_ids": ["..."]
}
```

3. 若 preflight 不通過：
   - 不建立新 `project_sections.content`
   - 不覆寫既有內容
   - 不把章節狀態標成 `completed`

### 驗收

1. 29 題缺一題時，任何生成 API 都不會產生內容。
2. 不再出現模型自行跳產業的 fallback 內容。

---

## Phase 4：前端草稿頁改成先檢查、再生成

### 目標

讓使用者在 UI 上清楚知道「為什麼不能生成」，而不是看到髒結果。

### 要做的事

1. `全部生成` 按鈕：
   - 先打 `draft-preflight`
   - 若 `ready = false`
   - 不啟動任何章節生成

2. `單章節生成` 按鈕：
   - 同樣先打 `draft-preflight`
   - 若 `ready = false`
   - 不呼叫章節生成 API

3. UI 顯示：
   - 缺幾題
   - 缺哪些題
   - 導回 `專案資料` tab

### 顯示原則

不要顯示：

- `生成失敗`

應顯示：

- `專案資料尚未填完，無法生成草稿`

---

## Phase 5：污染資料治理

### 目標

把先前因錯誤邏輯產生的髒資料明確清掉，避免被誤認為正常草稿。

### 要做的事

1. 一次性掃描並清除：
   - `question_id = wizardAnswers`
   - `answer_text = [object Object]`

2. 掃描：
   - `project_answers` 題數不足 29
   - 但 `project_sections.content` 已存在

3. 對上述專案：
   - 清除污染章節
   - 記錄 audit log

### 驗收

1. 不再有「答案未齊但已有正式草稿」的專案狀態。

---

## Phase 6：之後才考慮 generation snapshot

### 為什麼不先做

因為目前最大的問題不是「生成中答案又被改掉」，而是：

1. 答案沒穩定落庫
2. 29 題未齊卻還能生成
3. 缺資料時還允許 hallucination fallback

這三件事先封住，才值得做 snapshot。

### 什麼情況下再做

當前面 Phase 1 到 Phase 5 都完成後，若仍出現：

1. 同一輪生成前後讀到不同答案
2. 使用者在生成中修改答案造成章節彼此不一致

才引入：

1. `draft_generation_runs`
2. `draft_generation_snapshot_answers`

也就是：

- snapshot 是第二階段優化
- 不是第一階段救火

---

## 不該再做的事

1. 不該再讓 `PUT /projects/:id` 成為正式答題寫入主路徑。
2. 不該再讓草稿生成根據前端暫存狀態判斷可不可生成。
3. 不該再保留「資料不足也先生成」的策略。
4. 不該再接受「只擋單章、不擋全案」這種半套邏輯。

---

## 這版計劃的實作順序

### Step 1

先做：

1. 後端 `draft-preflight` API
2. 所有生成 API 接 preflight gate
3. 拔掉 `合理推估` fallback

### Step 2

再做：

1. 前端 draft tab 在生成前先查 preflight
2. 顯示缺題清單
3. 導回專案資料 tab

### Step 3

最後做：

1. 舊 `wizardAnswers` 寫入路徑降級
2. 污染專案掃描與清理
3. 補 audit log

### Step 4

若前面完成後仍有生成一致性問題，再做：

1. generation snapshot

---

## 驗收標準

### A. 落庫

1. 每答一題，立即寫入 `project_answers`
2. 使用者離開頁面後再回來，答案仍從 `project_answers` 正確重建

### B. 生成阻擋

1. 少任一題時，`draft-preflight.ready = false`
2. `全部生成` 被阻擋
3. `單章節生成` 也被阻擋

### C. 內容正確性

1. 缺資料時不產生任何章節內容
2. 不再因 fallback 生成跨產業內容

### D. 狀態一致性

1. `project_answers` 題數不足 29 的專案，不應存在新的有效章節內容
2. 前端顯示與 server 判斷一致

---

## 結論

前一版最大的問題是把事情寫成大而全，但沒有先抓住真正的硬邏輯。

這次應該先鎖死四件事：

1. `project_answers` 才是真相來源
2. `29 題沒齊，不准生成`
3. `缺資料時不准推估`
4. `前端與後端都要先過同一個 preflight`

只要這四件事沒做到，任何 snapshot、run table、進階治理都只是加複雜度，不是根治。
