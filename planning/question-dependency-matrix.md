# 29 題依賴矩陣與優先級

## 文件目的

這份文件定義 29 題在未來「對話版 / 打字版」中的依賴關係、優先級、推薦順序與追問策略。

重點：

1. canonical schema 不變
2. 29 題全部必填
3. 問題順序可依 UX 重新排序
4. 對話版與打字版順序可以不同

## 設計原則

1. 先問使用者最容易說出的內容
2. 先建立計畫骨架，再補量化與行政資料
3. 後續題目若依賴前題，就不應過早硬問
4. 對話模式優先追「高價值、低摩擦」問題
5. 打字模式優先呈現「最能帶出後續脈絡」的題目

## 題目分群

### A. 核心骨架層

1. `problem_description`
2. `solution_description`
3. `innovation_points`
4. `competitive_advantage`
5. `technical_barriers`
6. `current_solutions`
7. `quantified_benefits`

### B. 問題驗證與市場層

1. `problem_severity`
2. `customer_validation`
3. `customer_pain_score`
4. `target_market`
5. `market_size`
6. `business_model`

### C. 可行性與執行層

1. `current_trl`
2. `target_trl`
3. `key_risks`
4. `team_composition`
5. `team_experience`

### D. 財務與成長層

1. `business_model`
2. `expected_revenue_year1`
3. `expected_revenue_year2`
4. `expected_revenue_year3`
5. `revenue_calculation_basis`
6. `budget_total`
6. `budget_breakdown`

### E. 基本資訊層

1. `company_name`
2. `industry`
3. `company_size`
4. `capital`
5. `project_leader`

## 對話版推薦順序

1. `problem_description`
2. `current_solutions`
3. `solution_description`
4. `innovation_points`
5. `competitive_advantage`
6. `technical_barriers`
7. `quantified_benefits`
8. `problem_severity`
9. `customer_validation`
10. `customer_pain_score`
11. `target_market`
12. `business_model`
13. `market_size`
14. `current_trl`
15. `target_trl`
16. `key_risks`
17. `team_composition`
18. `team_experience`
19. `budget_total`
20. `expected_revenue_year1`
21. `expected_revenue_year2`
22. `expected_revenue_year3`
23. `revenue_calculation_basis`
24. `budget_breakdown`
25. `company_name`
26. `industry`
27. `company_size`
28. `capital`
29. `project_leader`

## 打字版推薦順序

1. `problem_description`
2. `solution_description`
3. `innovation_points`
4. `competitive_advantage`
5. `technical_barriers`
6. `current_solutions`
7. `quantified_benefits`
8. `target_market`
9. `business_model`
10. `problem_severity`
11. `customer_validation`
12. `customer_pain_score`
13. `market_size`
14. `current_trl`
15. `target_trl`
16. `key_risks`
17. `team_composition`
18. `team_experience`
19. `budget_total`
20. `expected_revenue_year1`
21. `expected_revenue_year2`
22. `expected_revenue_year3`
23. `revenue_calculation_basis`
24. `budget_breakdown`
25. `company_name`
26. `industry`
27. `company_size`
28. `capital`
29. `project_leader`

## 依賴矩陣

| question_id | 主要用途 | 建議優先級 | 依賴前題 | 為何依賴 | 對話版適合度 | 自動抽取機率 |
|---|---|---:|---|---|---|---|
| company_name | 基本識別 | 5 | 無 | 可隨時補 | 低 | 高 |
| industry | 基本定位 | 4 | company_name | 通常可一起收 | 中 | 中 |
| company_size | SBIR 資格判斷 | 5 | 無 | 行政資訊 | 低 | 低 |
| capital | SBIR 資格判斷 | 5 | 無 | 行政資訊 | 低 | 低 |
| project_leader | 計畫負責人 | 5 | 無 | 行政資訊 | 低 | 低 |
| problem_description | 問題骨架 | 1 | 無 | 全案起點 | 高 | 高 |
| problem_severity | 痛點強度 | 2 | problem_description | 先知道問題才能評估嚴重度 | 中 | 中 |
| current_solutions | 替代方案 | 1 | problem_description | 問題定義後才好比較現況 | 高 | 中 |
| customer_validation | 客戶驗證 | 2 | problem_description | 先知道問題，再問是否驗證過 | 中 | 中 |
| customer_pain_score | 痛點量化 | 3 | customer_validation | 沒訪談就沒有分數基礎 | 低 | 低 |
| solution_description | 解法骨架 | 1 | problem_description | 問題成立後才談解法 | 高 | 高 |
| innovation_points | 創新性 | 1 | solution_description | 先有解法才能拆創新點 | 高 | 中 |
| competitive_advantage | 差異化 | 1 | solution_description,current_solutions | 需同時知道你做什麼與別人在做什麼 | 高 | 中 |
| quantified_benefits | 量化效益 | 2 | solution_description | 必須先知道解法內容 | 中 | 低 |
| technical_barriers | 技術門檻 | 1 | innovation_points,competitive_advantage | 沒有創新與差異基礎就無法講門檻 | 中 | 低 |
| target_market | 客群範圍 | 2 | problem_description,solution_description | 問題與解法定位會決定客群 | 高 | 中 |
| market_size | 市場規模 | 4 | target_market | 先鎖定市場再估規模 | 低 | 低 |
| business_model | 收益模式 | 2 | target_market,solution_description | 客群與產品決定商模 | 中 | 中 |
| current_trl | 技術成熟度 | 3 | solution_description | 必須先有解法輪廓 | 中 | 低 |
| target_trl | 目標成熟度 | 3 | current_trl,solution_description | 要先知道目前在哪裡與要做到什麼 | 低 | 低 |
| key_risks | 技術風險 | 3 | solution_description,target_trl | 先知道方案與目標，才能談風險 | 中 | 低 |
| team_composition | 團隊組成 | 3 | solution_description | 先知道要做什麼，才能談誰負責 | 中 | 低 |
| team_experience | 團隊經驗 | 3 | team_composition | 先知道團隊成員，再談過往經驗 | 低 | 低 |
| budget_total | 總經費 | 4 | target_trl,key_risks | 通常要在目標與風險輪廓出來後才較能估 | 低 | 低 |
| expected_revenue_year1 | 營收預估 | 4 | business_model,target_market | 先有商模與客群輪廓 | 低 | 低 |
| expected_revenue_year2 | 營收預估 | 4 | expected_revenue_year1 | 逐年延伸 | 低 | 低 |
| expected_revenue_year3 | 營收預估 | 4 | expected_revenue_year2 | 逐年延伸 | 低 | 低 |
| revenue_calculation_basis | 預估依據 | 3 | business_model,expected_revenue_year1 | 沒有商模與首年預估就沒有依據 | 低 | 低 |
| budget_breakdown | 經費配置 | 4 | budget_total,key_risks,team_composition | 需先知道總額、主要風險與執行配置 | 低 | 低 |

## 追問策略

### 優先級 1

特徵：

1. 是整份提案骨架
2. 後續多題依賴它
3. 使用者通常能先用自然語言描述

策略：

1. 允許自然發散
2. 多做回述確認
3. 一輪對話可映射多題

### 優先級 2

特徵：

1. 骨架已立後就應快速補齊
2. 決定提案可信度與市場合理性

策略：

1. 用具體追問
2. 優先蒐集可驗證訊息
3. 可允許 `partial` 先存，再回補

### 優先級 3-5

特徵：

1. 行政、財務、量化、補強資訊
2. 使用者不一定一開始答得出來

策略：

1. 延後到骨架穩定後再問
2. 允許系統給模板或計算引導
3. 仍須 confirmed 才能過 gate

## 與現有 `questions.json` 的關係

1. 不需要刪欄位
2. 需要新增兩組排序：
   - `conversation_order`
   - `form_order_v2`
3. 原本 `order` 可保留做 legacy 兼容
4. question metadata 建議新增：
   - `priority`
   - `depends_on[]`
   - `auto_extractable`
   - `conversation_friendly`

## 驗收重點

1. 對話版第一輪不會先逼公司資本額等低語意題
2. 打字版前 10 題應優先露出核心骨架題
3. follow-up planner 必須尊重依賴關係
4. `customer_pain_score` 等依賴題不可在前置題未成形時硬問
