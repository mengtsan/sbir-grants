# 專案資料重構需求文件

## 文件目的

這份文件用來記錄「專案資料」模組的下一階段大改方向，先把需求、問題、目標行為、技術方案與分段實作順序講清楚，暫時不直接改現有功能。

這次要處理兩個主題：

1. 專案資料回答不足時，AI 要能主動追問，而不是直接放飛亂寫
2. 專案資料輸入方式要從「純打字」擴充成「可用對話/語音完成」

## 目前現況

目前專案資料入口主要在：

1. [AIInterviewer.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/components/AIInterviewer.tsx)
2. [ProjectDetails.tsx](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/pages/ProjectDetails.tsx)

現有邏輯重點：

1. 問題清單由 `questions.json` 驅動
2. 使用者輸入後，會經過：
   - `/api/enrich`
   - `/api/extract`
   - `/api/regenerate`
3. 回答最終會存進 `wizardAnswers`
4. 當前流程本質上仍然是：
   - 一題一答
   - 回答不足時最多做「擴寫/建議」
   - 不是完整的 slot-filling / missing-info clarification loop

### 當前核心問題

#### 問題 1：缺資料時沒有真正回頭追問

現況是：

1. 使用者答得不夠完整
2. AI 可能會幫忙補字、擴寫、合理推估
3. 但一旦進入後續草稿生成，系統不一定會把「缺資料」當成 blocker
4. 結果是模型會開始自行腦補，讓內容看起來完整，但真實性不足

這個行為對申請型 SaaS 不對，因為：

1. 真正缺的是 ground truth，不是文字潤飾
2. 提案草稿若建立在錯誤假設上，後面越寫越偏
3. 使用者會誤以為「AI 已經幫我整理完」，實際上是 AI 自行補空格

#### 問題 2：目標受眾不是鍵盤型使用者

你這次補充的使用者洞察很明確：

1. 目標受眾是中小企業老闆
2. 這群人通常比較會「講」，不一定會「打字整理」
3. 要他們把腦中想法先轉成簡單文字再輸入，本身就是門檻
4. 所以現在的打字式問答，不是最適合的交互模式

這代表「專案資料」未來不能只是聊天輸入框，而應該更接近：

1. 顧問式訪談
2. 即時追問
3. 從口語裡抽取欄位
4. 讓使用者用說的完成資料蒐集

## 需求理解

## 一、追問式專案資料（Clarification / Slot Filling）

### 需求本質

AI 不該把「資料不足」視為一個可以自我補完的寫作問題，而要視為「資料蒐集尚未完成」。

### 目標行為

系統未來應該具備：

1. 能判斷目前回答是否足以支撐後續草稿
2. 能辨識缺的是哪一種欄位或哪一段事實
3. 能針對缺的欄位發出具體追問
4. 能把追問得到的新資訊寫回正確欄位
5. 若答案跨多欄位，能自動拆分填入多個欄位
6. 在草稿生成階段，若缺關鍵資料，應優先回到蒐集，不直接硬寫

### 重要決策：29 題全部必填

這次需求已明確定義：

1. 現有 29 題不是參考題，而是核心必填題
2. 對話模式不是要減少題數，而是要更有效率地把 29 題收齊
3. 所以未來系統的完成條件不是「聊得差不多」，而是：
   - 29 題全部至少達到可接受完成狀態

這代表產品設計要從「自由訪談」收斂為：

1. 對話可發散
2. 但最後一定要回到 29 題 canonical schema
3. 若 29 題未完成，流程不能視為完成

### 這不是單純「問更多問題」

真正需要的是一個 **資料完備度迴圈**：

1. 收到答案
2. 判斷是否足夠
3. 缺什麼
4. 追問
5. 抽取
6. 寫回欄位
7. 再次判斷是否足夠

換句話說，未來專案資料應該像：

`stateful consultant loop`

而不是：

`static questionnaire`

### 推薦產品模型

建議把每個欄位分成三層狀態：

1. `missing`
2. `partial`
3. `confirmed`

並且對每個欄位保存：

1. `raw_user_utterances`
2. `normalized_answer`
3. `confidence`
4. `last_updated_by`
5. `why_missing`
6. `follow_up_question`

### 關鍵需求

1. 每次回答後要跑欄位抽取
2. 每次抽取後要跑完備度判斷
3. 追問要跟欄位綁定，不是泛泛而問
4. 草稿生成前要有 gate：
   - 若關鍵欄位未確認，不直接生成

## 二、語音/對話式專案資料（Voice-first Intake）

### 需求本質

不是單純加一個錄音按鈕，而是把「專案資料收集」從表單輸入改成 **顧問式對談**。

### 目標行為

1. 使用者可以直接用講的
2. AI 可以即時聽、即時回應、即時追問
3. 對談中抽取的欄位即時映射到專案資料
4. 使用者講完後，可以看到系統自動整理出的欄位摘要
5. 若欄位仍缺漏，系統繼續追問

### 重要決策：不重做語音引擎，重做語音資料流

這次需求已明確定義：

1. 不一定要自建完整 realtime voice engine
2. 核心不是「把語音做出來」，而是：
   - 把語音收到的內容
   - 用和現有填寫版一致的方式
   - 映射回 29 題
   - 存進資料庫

所以第一版語音設計重點不應放在語音傳輸層，而應放在：

1. speech / transcript ingestion
2. transcript -> slot extraction
3. slot confirmation
4. slot persistence

OpenAI 官方 Realtime / Voice / Audio 文件可支援低延遲語音互動，但本專案真正要做的是「把音訊結果變成結構化欄位更新」。  
[來源：OpenAI Realtime Guide](https://platform.openai.com/docs/guides/realtime)  
[來源：OpenAI Voice Agents](https://platform.openai.com/docs/guides/voice-agents)  
[來源：OpenAI Audio Guide](https://platform.openai.com/docs/guides/audio)

### 為什麼是 Realtime 路線

如果要做近似「顧問對話」的體驗，單純 upload audio 再轉文字通常不夠，因為：

1. 互動延遲高
2. 不適合邊講邊追問
3. 無法自然做 conversation turn-taking

OpenAI 官方 Realtime 文件說明，Realtime API 是為低延遲、多模態即時互動設計，支援 client-side real-time interaction。[來源：OpenAI Realtime Guide](https://platform.openai.com/docs/guides/realtime)

OpenAI 官方 Voice Agents / Audio 文件也提供語音互動與音訊輸入/輸出的官方路徑。[來源：OpenAI Voice Agents](https://platform.openai.com/docs/guides/voice-agents)  
[來源：OpenAI Audio Guide](https://platform.openai.com/docs/guides/audio)

### 這裡需要的不是只有語音辨識

核心其實有三件事：

1. 口語輸入
2. 對話式追問
3. 欄位抽取與寫回

所以 architecture 上不能只做 STT，而要做：

1. Realtime conversation session
2. Tool / function calling
3. Structured field updates

OpenAI 官方 tools/function calling 文件提供由模型觸發工具、回傳結構化結果的方式，這很適合拿來做欄位寫回與缺欄追問控制。[來源：OpenAI Tools](https://platform.openai.com/docs/guides/tools?api-mode=responses)

## 目標產品形態

未來「專案資料」可拆成兩個互補模式：

### 模式 A：文字顧問模式

適合：

1. 喜歡打字的使用者
2. 想要精修特定欄位的人
3. 後續補資料階段

核心能力：

1. 追問
2. 多欄位抽取
3. 欄位確認
4. 草稿前 gate

### 模式 B：語音訪談模式

適合：

1. 第一次建專案
2. 老闆或創辦人直接說明想法
3. 想快速把腦中想法傾倒出來的人

核心能力：

1. Realtime 語音對話
2. 即時追問
3. 即時欄位萃取
4. 對話結束後產生結構化摘要

### 共通原則

兩種模式不是兩套資料來源，而是共用同一個 canonical schema：

1. 最終都要回填同一份 29 題資料
2. 對話版與填寫版要能互相接續
3. 使用者可以：
   - 先用講的
   - 再用打字補
   - 或先打字再用對話補缺漏

## 建議的資料流

## A. 文字追問模式資料流

```text
使用者回答
-> 欄位抽取器
-> 更新候選欄位值
-> 完備度判斷器
-> 若不足，生成 follow-up question
-> 使用者補答
-> 重複直到關鍵欄位 confirmed
-> 才允許生成草稿
```

## B. 語音訪談模式資料流

```text
使用者語音
-> Realtime session
-> agent 判斷是否追問
-> tool call: update_project_fields
-> tool call: mark_field_partial/confirmed
-> tool call: next_missing_fields
-> AI 產生下一句追問
-> 對話結束
-> 生成專案資料摘要
```

## C. 最終完成條件

```text
任何模式輸入
-> 抽取到 canonical 29 題 schema
-> 每題狀態更新
-> 缺漏題目持續追問
-> 29 題全部完成
-> 才視為專案資料完成
-> 才允許完整草稿生成
```

## 系統拆分建議

這次不要把所有事情混在一個 prompt 裡。

建議拆成 4 個明確能力：

1. `field_extractor`
- 從文字或語音轉錄內容抽取對應欄位

2. `completeness_evaluator`
- 判斷目前欄位是否足夠

3. `follow_up_planner`
- 生成下一個最值得問的追問

4. `project_data_writer`
- 把結果寫回欄位與狀態

## 對現有系統的影響

### 現有可延用

1. `questions.json` 可保留，作為初始欄位定義
2. `wizardAnswers` 可保留，作為兼容層
3. `/api/extract`、`/api/enrich`、`/api/regenerate` 的部分能力可拆用

### 必須重做

1. 問答流程控制器
2. 欄位狀態模型（missing / partial / confirmed）
3. 草稿生成前的資料 gate
4. 語音 session 管理
5. 對話式欄位更新工具

### 必須新增的核心抽象

1. `canonical_29_question_schema`
2. `question_status`
3. `question_confidence`
4. `question_evidence`
5. `follow_up_queue`
6. `conversation_turns`

其中 `question_status` 建議至少有：

1. `missing`
2. `partial`
3. `confirmed`

這次已確認各狀態定義如下：

1. `missing`
   - 完全沒有內容
2. `partial`
   - 有內容，但 AI 判斷不足以支撐草稿
3. `confirmed`
   - 使用者已確認，可用於草稿

但因為你已明確要求 29 題都必填，實務上完成條件會是：

1. 29 題全部至少為 `confirmed`
2. 才能進完整草稿生成

## 風險與難點

### 1. 欄位抽取錯配

口語資料容易同時談多件事，模型可能把資訊寫錯欄位。

需要：

1. confidence
2. provenance
3. user confirmation

### 2. 追問過多造成疲勞

如果每次都追很細，使用者會煩。

需要：

1. 追問優先級
2. 只追關鍵欄位
3. 可先略過，稍後回補

### 3. 語音模式成本較高

Realtime + turn-taking + structured extraction 的成本會高於純文字問卷。

需要：

1. session timeout
2. 控制 token / audio 成本
3. 可能區分免費版與進階版

### 4. 草稿不能再「自行補全」

這是產品哲學上的重大變更。

未來要明確定義：

1. 哪些欄位可推估
2. 哪些欄位必須由使用者確認

## 建議分段開發

### Phase 1：先做文字追問版

目標：

1. 保留現有打字 UI
2. 新增欄位完備度判斷
3. 新增追問 loop
4. 新增草稿前 gate

原因：

1. 複雜度較低
2. 可先驗證「追問式專案資料」是否真的改善草稿品質
3. 也可先把資料模型重構好，為語音版鋪路

### Phase 2：再做語音對話版

目標：

1. 新增 voice intake mode
2. 建立即時欄位更新工具
3. 對談結束後產出欄位摘要與缺漏清單

原因：

1. 語音只是輸入介面
2. 真正困難的是欄位狀態機與追問 loop
3. 先把底層資料與流程做好，再上語音，風險最低

### Phase 2 的正確範圍

語音版第一階段不是做「炫技式 realtime UI」，而是做：

1. 接收語音/轉錄結果
2. 用與文字版同樣的抽取器和追問器處理
3. 將結果寫回同一份 29 題 schema

也就是：

`voice is an input mode, not a separate product logic`

## 建議 MVP 定義

如果只先做其中一個，我建議先做：

### MVP 1：文字追問式專案資料

驗收標準：

1. AI 可以辨識資料不足
2. AI 可以針對特定欄位追問
3. 追問得到的答案可寫回對應欄位
4. 29 題未完成時，草稿生成功能會阻擋並引導回補
5. 使用者可在填寫版與對話版之間切換而不丟資料
6. AI 可先將對話整理成候選答案，再由使用者確認

### MVP 2：語音 intake beta

驗收標準：

1. 使用者可透過語音完成至少一輪專案資料訪談
2. 語音轉錄結果可被映射到現行 29 題 schema
3. 系統可持續追問缺漏題目
4. 訪談結束後可輸出結構化摘要與 29 題完成狀態

## 待決策項目

這次已完成以下決策：

1. 29 題狀態定義採用：
   - `missing`
   - `partial`
   - `confirmed`
2. AI 可以先提出候選整理，但一定要使用者確認
3. 29 題未完成時，不允許生成草稿
4. 語音模式第一版放在現有「專案資料」tab 內，作為一種輸入模式

仍待後續細化的事項：

1. 29 題各自的 `partial -> confirmed` 判準
2. 追問的停止條件
3. 候選答案的 UI 呈現方式
4. 語音輸入的實際互動形式：
   - 即時回話
   - 或 push-to-talk + turn-based transcript

## 我目前的建議

先做順序：

1. `29 題 canonical schema 重構`
2. `欄位狀態模型`
3. `追問 loop`
4. `草稿前 gate`
5. `語音 intake`

理由：

1. 真正的核心不是語音，而是「缺資料時能不能回頭追問」
2. 你已經明確要求 29 題都必填，所以 canonical schema 必須先穩定
3. 語音是輸入體驗升級，但不應該先於資料狀態機

## 已收斂的一版正式產品定義

### 產品定位

「專案資料」是顧問式資料蒐集系統，不是單純表單。

### 核心原則

1. 29 題是唯一 canonical schema
2. 對話版與填寫版並存
3. AI 可以先整理候選答案
4. 候選答案必須經過使用者確認
5. 29 題未完成，不得生成草稿

### 第一版目標

1. 讓老闆能用更自然的方式把 29 題補齊
2. 系統在資料不足時會追問，不會自行放飛
3. 語音與文字最終都回填到同一份專案資料

## 現有 29 題順序分析

目前 [questions.json](/Users/backtrue/Documents/claude-sbir-skills/saas/frontend/src/data/questions.json) 的順序大致是：

1. 基本資訊
2. 問題陳述
3. 創新構想
4. 市場分析
5. 可行性評估
6. 團隊組成
7. 經費規劃
8. 預期成果

### 現有順序的優點

1. 符合傳統計畫書結構
2. 方便後續對應章節生成
3. 後端與現有 UI 已經建立在這個邏輯上

### 現有順序的問題

1. 一開始就先問公司、資本額、主持人，對老闆來說太像填表，不像顧問訪談
2. 在真正聊出產品核心以前，就開始問形式化資訊，容易讓使用者失去動力
3. 市場、TRL、經費、營收等高難度題目出得太早，若前面核心論述沒穩，後面很容易亂答
4. 對語音對談來說，這個順序不自然，因為人通常會先講「我想做什麼」，不會先講「我資本額多少」

## 我對順序的判斷

### 結論

1. `29 題本身不要刪`
2. `29 題 canonical schema 不變`
3. 但「提問順序」應該重排
4. 而且：
   - 對話版順序
   - 打字版順序
   可以不同

因為 canonical schema 跟 UX 順序不是同一件事。

## 建議的新順序原則

### 原則 1：先抓核心，再補框架

先讓使用者講出：

1. 想解決什麼問題
2. 打算怎麼解
3. 為什麼是你來解

之後再去補：

1. 市場
2. 風險
3. 團隊
4. 預算
5. 營收

### 原則 2：先容易講的，再難計算的

使用者通常比較容易先講：

1. 問題
2. 產品
3. 故事
4. 技術

比較難直接講：

1. TAM/SAM/SOM
2. TRL
3. 三年營收
4. 經費分配

所以高難度題目應該往後放。

### 原則 3：先讓 AI 建骨架，再逼精確數字

草稿品質的前提不是一開始就逼數字，而是先讓核心論述站得住腳。

## 建議的「對話版」重排順序

### Stage 1：核心訪談

目的：先讓 AI 顧問把產品骨架建立起來。

1. `problem_description`
2. `solution_description`
3. `innovation_points`
4. `competitive_advantage`
5. `technical_barriers`
6. `current_solutions`
7. `quantified_benefits`

### Stage 2：市場與客戶驗證

目的：確認這不是空想，而是真有市場與需求。

8. `target_market`
9. `customer_validation`
10. `customer_pain_score`
11. `market_size`
12. `business_model`

### Stage 3：可行性與執行

目的：讓案子看起來做得到，不只是概念。

13. `current_trl`
14. `target_trl`
15. `key_risks`
16. `team_composition`
17. `team_experience`

### Stage 4：基本資訊補齊

目的：把正式申請需要的公司資訊補完整。

18. `company_name`
19. `industry`
20. `company_size`
21. `capital`
22. `project_leader`

### Stage 5：經費與成果

目的：最後才處理最不直覺、但申請必要的題目。

23. `budget_total`
24. `budget_breakdown`
25. `problem_severity`
26. `expected_revenue_year1`
27. `expected_revenue_year2`
28. `expected_revenue_year3`
29. `revenue_calculation_basis`

## 建議的「打字版」重排順序

打字版不用完全像對話版，但也不建議維持現在的順序。

### 建議順序

1. `company_name`
2. `project_leader`
3. `problem_description`
4. `solution_description`
5. `innovation_points`
6. `competitive_advantage`
7. `technical_barriers`
8. `current_solutions`
9. `target_market`
10. `business_model`
11. `customer_validation`
12. `customer_pain_score`
13. `market_size`
14. `quantified_benefits`
15. `current_trl`
16. `target_trl`
17. `key_risks`
18. `team_composition`
19. `team_experience`
20. `industry`
21. `company_size`
22. `capital`
23. `budget_total`
24. `budget_breakdown`
25. `problem_severity`
26. `expected_revenue_year1`
27. `expected_revenue_year2`
28. `expected_revenue_year3`
29. `revenue_calculation_basis`

### 為什麼打字版也要調整

因為就算喜歡打字的人，也比較容易先寫出：

1. 問題
2. 解法
3. 差異

而不是一開始就寫：

1. 資本額
2. 員工數
3. 三年營收推估

## 推薦的產品策略

### 1. Canonical schema 不變

資料庫與後端仍用同一份 29 題 schema。

### 2. 顯示順序可變

前端可根據 mode 呈現不同順序：

1. `conversation_mode_sequence`
2. `form_mode_sequence`

### 3. 完成條件一致

無論哪個模式，最後都必須讓 29 題達到 `confirmed`。

## 對話模式的 PM 決策建議

我建議對話版不要直接明顯地一題一題念 29 題，而要讓使用者感覺像在被顧問引導。

但系統內部仍然要做：

1. 題目映射
2. 缺漏追問
3. 29 題完成度管理

也就是：

`UX 是對話`
`Engine 是 29 題狀態機`

## 下一步最適合細化的內容

接下來應該往下拆兩件事：

1. `29 題逐題 confirmed 標準`
   - 每題怎樣才算真的可用

2. `對話模式下的追問策略`
   - 哪些題可以同時抽
   - 哪些題要明確追問
   - 哪些題晚點補也可以

## 29 題逐題規格表（第一版）

這一段是為了讓後續前後端與 prompt / agent 邏輯可以落地。

每題定義 5 件事：

1. `目的`
2. `missing`
3. `partial`
4. `confirmed`
5. `可否自動抽取 / 追問方向`

### A. 基本資訊

#### 1. `company_name`

1. 目的：確認申請主體
2. `missing`：完全沒有公司名稱
3. `partial`：只有簡稱、暱稱、品牌名，無法確認法定主體
4. `confirmed`：有可辨識公司全名，且使用者確認
5. 自動抽取：高
6. 常見追問：
   - 「公司完整登記名稱是什麼？」
   - 「這是品牌名還是公司正式名稱？」

#### 2. `industry`

1. 目的：判定產業別與後續脈絡
2. `missing`：完全不知道產業
3. `partial`：只知道產品類型，但無法歸到主要產業
4. `confirmed`：可歸類到既有產業選項，且使用者確認
5. 自動抽取：中
6. 常見追問：
   - 「你們主要是做製造、資訊服務，還是生技醫療？」

#### 3. `company_size`

1. 目的：SBIR 資格判斷
2. `missing`：完全沒有員工數資訊
3. `partial`：只知道大概規模，例如「很小、幾個人」
4. `confirmed`：有具體員工數或清楚範圍，且使用者確認
5. 自動抽取：中
6. 常見追問：
   - 「目前全職加兼職，大約幾位核心成員？」

#### 4. `capital`

1. 目的：SBIR 資格判斷
2. `missing`：完全無資本額資訊
3. `partial`：只知道大約規模，沒有可用數字
4. `confirmed`：有具體萬元數，且使用者確認
5. 自動抽取：低
6. 常見追問：
   - 「公司實收資本額大概是多少萬元？」

#### 5. `project_leader`

1. 目的：計畫主體與執行責任人
2. `missing`：不知道誰主責
3. `partial`：只有姓名或只有職稱
4. `confirmed`：姓名 + 職稱完整
5. 自動抽取：中
6. 常見追問：
   - 「這次計畫主要由誰負責？他的職稱是什麼？」

### B. 問題陳述

#### 6. `problem_description`

1. 目的：定義要解決的核心問題
2. `missing`：只講想做什麼，沒有講問題
3. `partial`：有問題方向，但不清楚對誰、痛在哪、為何存在
4. `confirmed`：能清楚說出目標對象、痛點情境、問題後果
5. 自動抽取：高
6. 常見追問：
   - 「你真正想解的問題是什麼？」
   - 「這個問題現在怎麼發生？」
   - 「不解決會怎麼樣？」

#### 7. `problem_severity`

1. 目的：量化問題嚴重程度
2. `missing`：完全沒有嚴重程度判斷
3. `partial`：只說很痛、很麻煩，但沒有程度感
4. `confirmed`：有明確嚴重性描述，且可對應分級
5. 自動抽取：中
6. 常見追問：
   - 「如果 10 分最嚴重，你覺得客戶會打幾分？為什麼？」

#### 8. `current_solutions`

1. 目的：建立市場現況與比較基準
2. `missing`：完全不知道現在怎麼解這個問題
3. `partial`：只說有競品，但沒說缺點
4. `confirmed`：能說出現有解法 + 它們的不足
5. 自動抽取：中
6. 常見追問：
   - 「現在客戶用什麼方式解決？」
   - 「那些方法為什麼還是不夠好？」

#### 9. `customer_validation`

1. 目的：確認是否有真實客戶驗證
2. `missing`：完全不知道有沒有訪談
3. `partial`：說有聊過人，但沒有數量與對象
4. `confirmed`：有訪談數量或至少可明確描述驗證來源
5. 自動抽取：中
6. 常見追問：
   - 「你實際聊過幾位客戶或潛在客戶？」

#### 10. `customer_pain_score`

1. 目的：量化客戶痛感
2. `missing`：沒有任何痛感程度資訊
3. `partial`：只有描述、沒有平均程度
4. `confirmed`：能給出合理分數或清楚程度判斷
5. 自動抽取：低
6. 常見追問：
   - 「如果讓客戶自己評分，平均大概會幾分？」

### C. 創新構想

#### 11. `solution_description`

1. 目的：定義解決方案主體
2. `missing`：只講問題，沒講解法
3. `partial`：只有模糊方向，沒有方案樣貌
4. `confirmed`：能清楚說出產品/服務怎麼運作、提供什麼價值
5. 自動抽取：高
6. 常見追問：
   - 「你打算怎麼解這個問題？」
   - 「你的產品或服務實際長什麼樣？」

#### 12. `innovation_points`

1. 目的：整理創新性
2. `missing`：完全沒有創新點
3. `partial`：只有一句「我們比較創新」，沒有拆點
4. `confirmed`：至少能整理出 3 個清楚創新點，且使用者確認
5. 自動抽取：高
6. 常見追問：
   - 「你覺得這件事和別人最不一樣的 3 點是什麼？」

#### 13. `competitive_advantage`

1. 目的：建立差異化敘事
2. `missing`：完全沒有比較觀點
3. `partial`：只有泛泛優勢，例如更好、更快
4. `confirmed`：能清楚說出相對誰、差在哪、差異帶來什麼價值
5. 自動抽取：高
6. 常見追問：
   - 「如果客戶拿你和現有品牌比，你贏在哪？」

#### 14. `quantified_benefits`

1. 目的：讓價值可量化
2. `missing`：只有感覺上的好處
3. `partial`：有好處，但沒有數字或量級
4. `confirmed`：至少有 1 到 3 個合理量化效益
5. 自動抽取：中
6. 常見追問：
   - 「如果導入後，最可能節省多少時間/成本，或提升多少效率？」

#### 15. `technical_barriers`

1. 目的：建立難以模仿性
2. `missing`：沒有進入門檻描述
3. `partial`：只說技術很難，但沒講難在哪
4. `confirmed`：可具體說出專利、資料、 know-how、流程或整合門檻
5. 自動抽取：中
6. 常見追問：
   - 「別人如果今天想抄，最難抄的是哪一段？」

### D. 市場分析

#### 16. `target_market`

1. 目的：定義目標客群
2. `missing`：不知道賣給誰
3. `partial`：只有很大範圍，例如所有企業
4. `confirmed`：有明確客群輪廓與場景
5. 自動抽取：中
6. 常見追問：
   - 「你最想先賣給哪一類客戶？」

#### 17. `market_size`

1. 目的：估算市場空間
2. `missing`：完全沒有規模概念
3. `partial`：只有大概很大/很小，沒有分層
4. `confirmed`：至少有可解釋的 TAM/SAM/SOM 或同等邏輯
5. 自動抽取：低
6. 常見追問：
   - 「你估計全市場、可服務市場、短期能拿到的市場各有多大？」

#### 18. `business_model`

1. 目的：定義怎麼賺錢
2. `missing`：完全沒有收費方式
3. `partial`：知道會收錢，但模型不清楚
4. `confirmed`：可對應主要營收模式且使用者確認
5. 自動抽取：中
6. 常見追問：
   - 「你是賣斷、訂閱、授權，還是混合？」

### E. 可行性評估

#### 19. `current_trl`

1. 目的：知道現在做到哪
2. `missing`：完全不知道研發成熟度
3. `partial`：只知道有概念或有原型，無法判定階段
4. `confirmed`：能對應到一個合理 TRL 階段
5. 自動抽取：中
6. 常見追問：
   - 「你現在是概念、原型，還是已經接近可商用？」

#### 20. `target_trl`

1. 目的：定義 Phase 1 目標
2. `missing`：不知道案子做完要到哪
3. `partial`：只說想更成熟，沒有可對應層級
4. `confirmed`：可對應一個合理目標 TRL
5. 自動抽取：低
6. 常見追問：
   - 「這期補助結束後，你希望它做到什麼程度？」

#### 21. `key_risks`

1. 目的：建立風險意識與可行性
2. `missing`：完全沒談風險
3. `partial`：只說有困難，沒有風險與對策
4. `confirmed`：至少有主要風險 + 對應作法
5. 自動抽取：中
6. 常見追問：
   - 「你最怕哪件事做不出來？如果發生了你怎麼處理？」

### F. 團隊組成

#### 22. `team_composition`

1. 目的：知道誰負責把事做完
2. `missing`：完全沒有人員資訊
3. `partial`：只有說有團隊，沒拆角色
4. `confirmed`：有核心成員、角色與專長
5. 自動抽取：中
6. 常見追問：
   - 「這件事主要有哪些人一起做？各自負責什麼？」

#### 23. `team_experience`

1. 目的：建立團隊可信度
2. `missing`：看不出團隊是否有相關經驗
3. `partial`：只有泛稱有經驗，沒有案例或背景
4. `confirmed`：有可支撐的相關經驗或成果
5. 自動抽取：中
6. 常見追問：
   - 「你們過去做過什麼類似的事，能證明做得起來？」

### G. 經費規劃

#### 24. `budget_total`

1. 目的：補助規模與範圍
2. `missing`：不知道總預算
3. `partial`：只有模糊預算帶
4. `confirmed`：有具體總額，且使用者確認
5. 自動抽取：低
6. 常見追問：
   - 「這一期你預計大概投入多少萬？」

#### 25. `budget_breakdown`

1. 目的：看錢怎麼分配
2. `missing`：完全沒有預算結構
3. `partial`：只知道大項，沒有分配邏輯
4. `confirmed`：至少能拆出主要科目與比例
5. 自動抽取：低
6. 常見追問：
   - 「人事、設備、委外、材料，各大概佔多少？」

### H. 預期成果

#### 26. `expected_revenue_year1`

1. 目的：建立第一年效益基礎
2. `missing`：完全沒有預估
3. `partial`：只有模糊區間
4. `confirmed`：有具體數字且使用者確認
5. 自動抽取：低
6. 常見追問：
   - 「如果順利，第一年大概可以做到多少營收？」

#### 27. `expected_revenue_year2`

1. 目的：建立第二年成長路徑
2. `missing`：完全沒有預估
3. `partial`：只有感覺會成長
4. `confirmed`：有具體數字且使用者確認
5. 自動抽取：低
6. 常見追問：
   - 「第二年如果繼續擴大，營收會到哪裡？」

#### 28. `expected_revenue_year3`

1. 目的：建立三年投資效益
2. `missing`：完全沒有預估
3. `partial`：只有模糊期待
4. `confirmed`：有具體數字且使用者確認
5. 自動抽取：低
6. 常見追問：
   - 「第三年成熟後，你認為營收大概會到多少？」

#### 29. `revenue_calculation_basis`

1. 目的：證明營收不是亂猜
2. `missing`：只有數字、沒有依據
3. `partial`：有部分依據，但邏輯不完整
4. `confirmed`：有市場、客戶數、單價或轉換邏輯等支撐，且使用者確認
5. 自動抽取：低
6. 常見追問：
   - 「這個營收是怎麼算出來的？」
   - 「你的客戶數、單價或市佔率假設是什麼？」

## PM 結論：哪些題可以從對話中自然先收

最適合先用對話訪談抓的題目：

1. `problem_description`
2. `solution_description`
3. `innovation_points`
4. `competitive_advantage`
5. `technical_barriers`
6. `current_solutions`
7. `target_market`
8. `team_composition`
9. `team_experience`

中度適合由對話逐步帶出的題目：

1. `quantified_benefits`
2. `customer_validation`
3. `key_risks`
4. `business_model`
5. `problem_severity`

比較不適合純自由對話一次收齊、需要後段收斂的題目：

1. `market_size`
2. `budget_total`
3. `budget_breakdown`
4. `expected_revenue_year1`
5. `expected_revenue_year2`
6. `expected_revenue_year3`
7. `revenue_calculation_basis`
8. `capital`
9. `company_size`

## 下一步建議

現在已經可以繼續往下拆兩份實作文件：

1. `conversation-state-machine.md`
   - 專案資料對話狀態機
   - 追問規則
   - 候選答案確認流程

2. `project-data-schema-v2.md`
   - 29 題狀態模型
   - question_status
   - evidence / confidence / provenance

## 主要外部依據

1. OpenAI Realtime Guide  
   https://platform.openai.com/docs/guides/realtime
2. OpenAI Voice Agents Guide  
   https://platform.openai.com/docs/guides/voice-agents
3. OpenAI Audio Guide  
   https://platform.openai.com/docs/guides/audio
4. OpenAI Tools / Function Calling  
   https://platform.openai.com/docs/guides/tools?api-mode=responses

## 補充文件

為了把這次重構收斂到可直接開發與驗收，另行拆出三份配套文件：

1. [API Contracts](/Users/backtrue/Documents/claude-sbir-skills/planning/project-data-api-contracts.md)
2. [29 題依賴矩陣](/Users/backtrue/Documents/claude-sbir-skills/planning/question-dependency-matrix.md)
3. [驗收標準](/Users/backtrue/Documents/claude-sbir-skills/planning/project-data-acceptance.md)

這三份文件與：

1. [對話狀態機](/Users/backtrue/Documents/claude-sbir-skills/planning/conversation-state-machine.md)
2. [Schema v2](/Users/backtrue/Documents/claude-sbir-skills/planning/project-data-schema-v2.md)
3. [Migration 規格](/Users/backtrue/Documents/claude-sbir-skills/planning/project-data-migrations.md)
4. [前端互動規格](/Users/backtrue/Documents/claude-sbir-skills/planning/project-data-frontend-spec.md)
5. [實作拆分](/Users/backtrue/Documents/claude-sbir-skills/planning/project-data-implementation-plan.md)

一起構成目前這次「專案資料重構」的可驗收規格包。
