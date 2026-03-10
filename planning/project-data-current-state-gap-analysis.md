# 專案資料現況與缺口分析

## 文件目的

這份文件只回答三件事：

1. 現在程式其實已經做了什麼
2. 真正還缺什麼
3. 下一步應該怎麼把既有零件接成正確流程

這不是重寫 PRD，也不是再發明新架構。  
這份文件的目的是避免把「其實已經做過的功能」又誤判成沒做，然後再重做一套。

---

## 一句話結論

目前系統不是沒有「追問、抽取、補齊」能力。  
目前系統的真實狀態是：

- `零件已經存在`
- `但沒有被接成同一個 completion engine`

也就是：

1. 已有逐題流程
2. 已有單題落庫
3. 已有 extract
4. 已有 enrich
5. 已有 29 題 schema

但缺：

1. 題目完成狀態模型
2. 缺題補齊的主控流程
3. extract / enrich 結果的正式確認與落庫規則
4. 以 DB 真實狀態為準的完成判定

---

## 現在已經有的東西

## 1. 29 題 canonical schema 已存在

來源：
- [questions.json](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/data/questions.json)

現況：

1. `metadata.total_questions = 29`
2. 每題有：
   - `id`
   - `order`
   - `question`
   - `required`
   - `validation`
   - `depends_on`（部分題）

代表：

- canonical question list 已經存在
- 題目本體不是現在的缺口

---

## 2. 前端已經有逐題式的專案資料流程

來源：
- [AIInterviewer.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/components/AIInterviewer.tsx)

現況：

1. `currentStepIndex` 控制目前題目
2. `firstUnansweredIndex` 會從第一個未回答題開始
3. 回答後會找下一個未回答題
4. 支援回頭編輯單題

代表：

- 系統不是一次送整包表單才處理
- 已經有基本的逐題流程控制器

限制：

- 它仍然是「固定題序問卷控制器」
- 還不是「缺口驅動的訪談控制器」

---

## 3. 單題落庫路徑已經存在

來源：
- [projects.ts](/Users/backtrue/Documents/claude-sbir-skills/saas/backend/src/projects.ts)
- [ProjectDetails.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/pages/ProjectDetails.tsx)
- [AIInterviewer.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/components/AIInterviewer.tsx)

現況：

1. backend 已有：
   - `PATCH /api/projects/:id/answers/:questionId`
2. 這支 API 會：
   - 驗證 `questionId`
   - 驗證專案 ownership
   - 單題 upsert 到 `project_answers`
3. frontend 現在也已改成：
   - 每答一題就送單題 patch

代表：

- 你要求的「每題即時落庫」現在已經不是缺的功能
- 正式答案表 `project_answers` 已存在且可寫

限制：

- 舊 `PUT /projects/:id` 仍然保留 `wizardAnswers` 相容寫入邏輯
- 這代表寫入主路徑雖然已建立，但舊路徑還沒完全退場

---

## 4. 從一句回答抽取多題答案的能力已存在

來源：
- [AIInterviewer.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/components/AIInterviewer.tsx)
- [extract.ts](/Users/backtrue/Documents/claude-sbir-skills/saas/backend/src/extract.ts)

現況：

1. 使用者回答一題後
2. 前端會把：
   - `user_input`
   - `unanswered_questions`
   送到 `/api/extract`
3. backend 會回傳：
   - `question_id`
   - `extracted_answer`

代表：

- 系統已具備「一段話補多題」的技術能力
- 這就是缺題補齊流程的核心零件之一

限制：

- extract 結果目前只是 `suggestion`
- 不是正式答案狀態的一部分

---

## 5. 回答不足時的 AI 補強能力已存在

來源：
- [AIInterviewer.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/components/AIInterviewer.tsx)
- [enrich.ts](/Users/backtrue/Documents/claude-sbir-skills/saas/backend/src/enrich.ts)

現況：

1. 對部分題目，前端會送 `/api/enrich`
2. backend 會回：
   - `sufficient`
   - `is_question`
   - `explanation`
   - `enriched_answer`
3. 前端會停在當前題，讓使用者確認後再送出

代表：

- 系統已經不只是死板表單
- 它已經有「回答太弱時，先補強」的互動雛形

限制：

- enrich 的 prompt 目前仍帶有過強的「代寫/推測」傾向
- 這和你現在要的「整理、回述、追問、確認」方向不完全一致

---

## 6. backend 生成端已經是從 `project_answers` 讀答案

來源：
- [ai.ts](/Users/backtrue/Documents/claude-sbir-skills/saas/backend/src/ai.ts)

現況：

1. 章節生成時會：
   - `SELECT question_id, answer_text FROM project_answers WHERE project_id = ?`
2. 再根據 `PHASE1_CHUNKS[n].relevant_question_ids` 組 chunk context

代表：

- 生成端的正式讀取來源其實已經偏向正確方向
- 不是完全還在靠 `progress_data`

限制：

- 缺資料時仍允許 fallback 推估
- 所以即使讀取來源正確，行為邏輯仍錯

---

## 現在真正缺的東西

## 1. 缺正式的題目完成狀態模型

目前有：

1. `answers`
2. `wizardAnswers`
3. `aiSuggestions`
4. `aiAutoFilled`

但沒有：

1. `question_status`
2. `candidate_answer`
3. `confirmed_answer`
4. `source`
5. `confirmed_by_user`

所以系統目前只能判斷：

- 有沒有字

但不能判斷：

1. 這題是使用者親自確認過，還是 AI 猜的
2. 這題是完整答案，還是半成品
3. 這題還要不要追問

這是最大的結構缺口。

---

## 2. 缺真正的「缺題補齊主控流程」

現在流程主控仍是：

- `currentStepIndex -> 下一個未回答題`

這代表系統還是：

- 以固定題序為核心

而不是：

- 以缺口補齊為核心

目前缺的是一個 planner，能在每次回答後重算：

1. 哪些題已 confirmed
2. 哪些題只是 partial
3. 哪些題 missing
4. 下一步最值得問哪一題

---

## 3. 缺 extract 結果的正式確認流程

現在 extract 的輸出只會進：

- `aiSuggestions`

也就是：

1. AI 可以從一句話抓到別題答案
2. 但這些答案沒有正式變成「待確認候選答案」
3. 也沒有正式回寫到 DB 狀態模型

所以現在 extract 比較像：

- `提示功能`

不是：

- `completion engine 的補題機制`

---

## 4. 缺以 DB 為準的完成度判定

現在前端有能力自己維護答案狀態，  
但還沒有正式的 server-side completion view，例如：

1. 已完成幾題
2. 哪些題 missing
3. 哪些題 partial
4. 哪些題 confirmed

因此目前還沒有一個正式機制能保證：

- 前端顯示的完成度 = DB 真實可用完成度

---

## 5. enrich 的產品策略需要改寫

`enrich.ts` 目前不是純粹在做：

- 追問
- 回述
- 整理

它的 prompt 還包含明顯的：

1. `具體生造`
2. `無中生有`
3. `直接幫他算好`
4. `讓讀起來是 100% 完整無缺漏的計畫書草稿`

這會導致系統走向：

- `代寫式補空`

而不是你要的：

- `顧問式逼出真實答案`

所以 enrich 不是不能留，
而是它的目標要從：

- `幫使用者直接補完`

改成：

- `幫使用者整理候選答案，並引導確認`

---

## 6. 舊相容層還沒有完全退乾淨

目前 [projects.ts](/Users/backtrue/Documents/claude-sbir-skills/saas/backend/src/projects.ts) 仍然：

1. `GET /projects/:id` 會把 `project_answers` 重組回 `progress_data.wizardAnswers`
2. `PUT /projects/:id` 仍會從 `progress_data.wizardAnswers` normalize 後寫入 `project_answers`

這代表：

- 新舊路徑仍並存

這在過渡期合理，
但如果不明確定義：

- 哪條是正式主路徑
- 哪條只是 compatibility

之後還會再混亂。

---

## 正確的重接線方向

不是重做一套新系統，而是把既有零件接成這條正式流程：

## 1. 單題輸入

來源：

1. 打字
2. 語音轉文字

都先變成：

- 當前使用者輸入

---

## 2. 單題即時落庫

使用正式路徑：

- `PATCH /api/projects/:id/answers/:questionId`

這一步只負責：

- 把使用者明確回答的那一題寫進 `project_answers`

---

## 3. extract 補題

系統接著對這段輸入做：

- `/api/extract`

把一句話中能對應其他題目的答案抓出來。

但這一步不應直接當 confirmed。  
應改成：

- 候選答案
- 待使用者確認

---

## 4. enrich / 回述 / 追問

若當前題回答過短、過弱、或不清楚：

- `/api/enrich`

但 enrich 的目標應改成：

1. 幫使用者整理成較完整表述
2. 回述給使用者確認
3. 不得直接把推測內容當正式答案

---

## 5. completion engine 重算狀態

每次：

1. 使用者答一題
2. extract 抓到其他候選題
3. enrich 產生候選補強

之後都要重新計算：

1. 哪些題 `missing`
2. 哪些題 `partial`
3. 哪些題 `confirmed`
4. 下一步該追問哪一題

這才是整個系統目前真正缺的主控器。

---

## 6. 草稿生成只吃 confirmed data

生成端不應再接受：

1. 缺值
2. partial
3. AI 未確認候選答案

只能吃：

- confirmed answers

這樣才不會再發生「醫療亂入」這種問題。

---

## 現在最應該改的，不是重新發明，而是這 6 件

## 第一優先

1. 明確定義：
   - 正式答案
   - 候選答案
   - 已確認答案

2. 明確定義：
   - `missing`
   - `partial`
   - `confirmed`

## 第二優先

3. 把 extract 從 suggestion 升級成：
   - 候選答案流程的一部分

4. 把 enrich 從代寫式補完，改成：
   - 顧問式回述確認

## 第三優先

5. 新增 server-side completion view
   - 讓前端永遠看 DB 的真實完成狀態

6. 生成端只允許 confirmed data

---

## 最後結論

你原本的判斷是對的：

- 「明明做過了」

這句話成立。

系統現在真正的問題不是缺功能，而是：

- 功能彼此分散存在
- 但沒有被接成一條正式的補題流程

所以正確方向不是重做，
而是：

- 盤點既有零件
- 定義正式狀態
- 把 extract / enrich / 單題落庫 / 生成 全部接到同一個 completion engine

這樣才是最小、正確、可延續的改法。
