# SBIR Grants

台灣經濟部 SBIR 申請輔助專案，包含兩條主線：

1. `SBIR Skill / MCP Server`
   - 給 `Codex`、`Claude Code`、`Claude Desktop` 使用
   - 以知識庫、MCP 工具、互動式問答與 Word 匯出為主

2. `SBIR SaaS`
   - 雲端 Web 版
   - 提供專案管理、AI 章節生成、文件上傳、RAG、品質評估與問答式專案資料整理

## 現況摘要

目前 repo 已對齊到這個方向：

1. `SaaS` 與 `Skill` 的關鍵題目規則已同步
   - `industry`
   - `business_model`
   - `team_experience`
   - `customer_validation`
   - `market_size`
   - `budget_total`
   - `expected_revenue_year1~3`

2. `Skill` 端已支援題目級補強
   - `行銷顧問` 這類自然語言可整理成官方行業分類大類
   - `要生成完整企劃書的時候要課金兩萬` 這類句子可整理成正式商業模式
   - `我不知道怎麼估` 這類句子可觸發經費 / 營收補強邏輯

3. `SaaS` 端目前主軸是「問答補齊」
   - 正式答案以 `project_answers` 為單一真相來源
   - 候選答案、顧問補寫、官方分類整理與 deterministic 經費試算已接上
   - 高風險 fail-open fallback 已收斂

## 使用入口

### 1. SaaS

正式站：

- [https://sbir.thinkwithblack.com](https://sbir.thinkwithblack.com)

技術文件：

- [SAAS.md](SAAS.md)

適合：

1. 一般使用者直接在瀏覽器完成 SBIR 專案資料與草稿生成
2. 上傳文件、建立多專案、做章節級生成與品質檢查

### 2. Codex

本 repo 內建標準 skill manifest：

- [SKILL.md](SKILL.md)

安裝與使用說明：

- [CODEX_SETUP.md](CODEX_SETUP.md)

適合：

1. 把這份 repo 當成 SBIR 專業知識 skill 載入
2. 讓 Codex 讀取方法論、FAQ、檢核清單、案例與提示規則

### 3. Claude Code / Claude Desktop

本 repo 另附 MCP server：

- [mcp-server/server.py](mcp-server/server.py)

設定說明：

- [CLAUDE_CODE_MCP_SETUP.md](CLAUDE_CODE_MCP_SETUP.md)
- [mcp-server/README.md](mcp-server/README.md)

適合：

1. 透過 MCP tools 執行互動式 proposal generator
2. 呼叫 `enrich_answer`、`get_progress`、`save_answer`、`generate_proposal`

## FAQ：是不是只能用 Claude？

不是。

目前可分成三種接法：

1. `Codex`
   - 透過 [SKILL.md](SKILL.md) 當成 skill 載入

2. `Claude Code`
   - 透過 [mcp-server/server.py](mcp-server/server.py) 以 stdio MCP server 連接

3. `Claude Desktop`
   - 透過同一個 MCP server 使用工具

差別是：

1. `Codex`
   - 偏 skill / repo knowledge

2. `Claude Code`
   - 偏 MCP tools 與流程互動

3. `Claude Desktop`
   - 偏桌面端使用 MCP 工具

對應的 GitHub 提問：

- [Issue #6: 請問只能使用Claude嗎](https://github.com/backtrue/sbir-grants/issues/6)

## 專案結構

```text
sbir-grants/
├── README.md
├── SKILL.md
├── SAAS.md
├── CODEX_SETUP.md
├── CLAUDE_CODE_MCP_SETUP.md
├── proposal_generator/
│   ├── questions.json
│   └── USAGE.md
├── mcp-server/
│   ├── server.py
│   ├── enrich_answer.py
│   ├── proposal_generator_impl.py
│   ├── roi_calculator.py
│   ├── pyproject.toml
│   └── README.md
├── references/
├── faq/
├── checklists/
└── templates/
```

## 目前功能

### Skill / MCP

1. `proposal generator`
   - 互動式問答
   - 保存答案與讀取進度
   - 生成 Phase 1 草稿

2. `enrich_answer`
   - 題目級補強
   - 支援和 SaaS 對齊的關鍵 deterministic 行為

3. `verify_company_eligibility_by_g0v`
   - 公司資格與基本資料檢核

4. `calculate_roi / validate_roi`
   - ROI / 營收試算與合理性檢查

5. `ingest / retrieve`
   - 參考文件讀取、分塊、標記、檢索

### SaaS

1. 專案管理
2. 問答式專案資料整理
3. 候選答案 / 顧問補寫 / 正式答案分流
4. 章節生成
5. 文件上傳與文件引用
6. 品質評估
7. BYOK
8. Cloudflare 部署

## 關鍵設計原則

### 1. 正式答案與候選答案分流

SaaS 端目前採：

1. `正式答案`
   - canonical、可生成、可驗證

2. `候選答案`
   - 顧問整理
   - 萃取建議
   - 補寫草稿
   - 需使用者確認後才成為正式答案

### 2. Deterministic 優先

對下列題目，優先使用規則與計算器，不放任模型自由編造：

1. `industry`
2. `business_model`
3. `customer_validation`
4. `budget_total`
5. `budget_breakdown`
6. `expected_revenue_year1~3`

### 3. Fail-closed

缺資料時，不應靠產品級 fallback 補空。  
目前 `SaaS` 端已經收掉主要的 fail-open 路徑，避免：

1. 缺資料還生成
2. 缺證據還判通過
3. 缺答案還塞預設值

## 安裝與啟動

### 本機 MCP Server

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
uv pip install -e .
uv run server.py
```

或：

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
pip install -e .
python server.py
```

依據：

- [mcp-server/pyproject.toml](mcp-server/pyproject.toml)
- [mcp-server/server.py](mcp-server/server.py)

### 本機 Skill 使用

若要給 Codex 載入，請看：

- [CODEX_SETUP.md](CODEX_SETUP.md)

### SaaS 部署

請看：

- [SAAS.md](SAAS.md)

## 文件索引

### 使用者導向

1. [GETTING_STARTED.md](GETTING_STARTED.md)
2. [FIRST_TIME_USE.md](FIRST_TIME_USE.md)
3. [HOW_TO_USE.md](HOW_TO_USE.md)
4. [FAQ.md](FAQ.md)
5. [INSTALLATION.md](INSTALLATION.md)
6. [VERIFICATION.md](VERIFICATION.md)

### SBIR 撰寫與知識內容

1. [references/](references)
2. [faq/](faq)
3. [checklists/](checklists)
4. [templates/](templates)

### 提案問答流程

1. [proposal_generator/README.md](proposal_generator/README.md)
2. [proposal_generator/USAGE.md](proposal_generator/USAGE.md)
3. [proposal_generator/questions.json](proposal_generator/questions.json)

### 技術與部署

1. [SAAS.md](SAAS.md)
2. [mcp-server/README.md](mcp-server/README.md)
3. [CODEX_SETUP.md](CODEX_SETUP.md)
4. [CLAUDE_CODE_MCP_SETUP.md](CLAUDE_CODE_MCP_SETUP.md)

## 現況限制

1. `Skill` 與 `SaaS` 已對齊關鍵題目規則，但還不是同一套完整執行環境
2. `Skill` 目前沒有 `SaaS` 那種：
   - 單題落庫
   - completion engine
   - planner-driven UI
3. `Claude Code` 與 `Claude Desktop` 的可用能力，取決於 MCP server 是否正確掛載

## 外部依據

1. OpenAI Skills repository  
   [https://github.com/openai/skills](https://github.com/openai/skills)

2. Anthropic Claude Code MCP  
   [https://docs.anthropic.com/en/docs/claude-code/mcp](https://docs.anthropic.com/en/docs/claude-code/mcp)

3. Anthropic Claude Code Slash Commands  
   [https://docs.anthropic.com/en/docs/claude-code/slash-commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

4. 行政院主計總處行業統計分類（官方主檔）  
   政府資料開放平臺：
   [https://data.gov.tw/dataset/14321](https://data.gov.tw/dataset/14321)

5. 主計總處第 12 次修正說明  
   [https://www.stat.gov.tw/News_Content.aspx?n=3110&s=235560](https://www.stat.gov.tw/News_Content.aspx?n=3110&s=235560)
