# SBIR MCP Server

`sbir-grants` 的 MCP server，提供本機互動式 SBIR 問答、答案補強、公司資格檢核、ROI 計算、文件檢索與草稿輸出。

這份 README 只描述目前 repo 內**實際存在**的 MCP server 行為，不保留舊版單純「市場數據查詢器」的描述。

## 入口

主要程式：

- [server.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/server.py)

套件定義：

- [pyproject.toml](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/pyproject.toml)

啟動方式：

1. `server.py` 的 `main()` 使用 `mcp.server.stdio.stdio_server`
2. `pyproject.toml` 已定義：
   - `sbir-data-server = "server:main"`

## 適用場景

這個 MCP server 主要用在：

1. `Claude Code`
2. `Claude Desktop`
3. 任何支援 stdio MCP 的 client

若你要的是 `Codex` skill 載入，請看：

- [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CODEX_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CODEX_SETUP.md)

若你要的是 `Claude Code` 設定，請看：

- [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md)

## 目前提供的能力

### 1. Proposal Generator

互動式 SBIR 問答流程：

1. 開始問答
2. 保存單題答案
3. 讀取進度
4. 生成草稿

相關檔案：

- [proposal_generator_impl.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/proposal_generator_impl.py)
- [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/proposal_generator/questions.json](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/proposal_generator/questions.json)

### 2. 題目級補強

`enrich_answer` 現在已和 SaaS 的關鍵規則對齊，支援：

1. `industry` 自然語言整理成官方行業統計分類大類
2. `business_model` 自然語言整理成正式商業模式
3. `team_experience = 沒有 / 尚無 / 目前沒有`
4. `customer_validation = 0 / 尚未訪談`
5. `budget_total = 我不知道怎麼估`
6. `expected_revenue_year1~3 = 我不知道怎麼估`
7. `market_size = 我不知道怎麼估`

相關檔案：

- [enrich_answer.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/enrich_answer.py)
- [/Users/backtrue/Documents/claude-sbir-skills/shared_domain/enrich_criteria.json](/Users/backtrue/Documents/claude-sbir-skills/shared_domain/enrich_criteria.json)

### 3. 公司資格檢核

支援透過 g0v 做公司基本資料與資格檢核：

- `verify_company_eligibility_by_g0v`

### 4. ROI 與營收合理性檢查

支援：

1. `calculate_roi`
2. `validate_roi`

相關檔案：

- [roi_calculator.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/roi_calculator.py)

### 5. 文件 ingest / retrieval

支援：

1. 讀取文件
2. 分塊
3. 標記
4. 檢索對應 chunk

### 6. 草稿保存與匯出

支援：

1. 保存章節
2. 匯出 Word
3. 取得全部已保存章節

## 安裝

### 用 `uv`

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
uv pip install -e .
```

### 用 `pip`

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
pip install -e .
```

## 啟動

### 方式一：直接跑 server.py

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
uv run server.py
```

### 方式二：跑 script entry

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
uv run sbir-data-server
```

### 本機開發測試

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
python server.py
```

若要用 MCP Inspector：

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
npx @modelcontextprotocol/inspector uv --directory . run server.py
```

## Claude Desktop / Claude Code 設定

建議的 stdio MCP 設定：

```json
{
  "mcpServers": {
    "sbir-data": {
      "command": "uv",
      "args": [
        "--directory",
        "/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server",
        "run",
        "server.py"
      ]
    }
  }
}
```

更完整設定說明：

- [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md)

## 對 SaaS 的對齊狀態

目前已對齊：

1. 關鍵題目定義
2. 部分 deterministic 正規化與補強規則
3. `enrich_answer` 的關鍵輸入案例

目前還沒對齊成同一套執行環境的部分：

1. `SaaS` 的單題落庫 / completion engine
2. `SaaS` 的候選答案與確認流
3. `SaaS` 的 planner-driven UI

也就是：

- `Skill / MCP`：知識與工具導向
- `SaaS`：產品流程導向

## 驗證

對齊檢查腳本：

- [test_saas_alignment.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/test_saas_alignment.py)

可直接跑：

```bash
python3 /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/test_saas_alignment.py
```

若輸出：

```text
skill-saas-alignment: PASS
```

代表關鍵題目規則仍與 SaaS 同步。

## 相關文件

1. [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/README.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/README.md)
2. [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CODEX_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CODEX_SETUP.md)
3. [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md)
4. [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/proposal_generator/USAGE.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/proposal_generator/USAGE.md)
5. [/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/SAAS.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/SAAS.md)

## 外部依據

1. Anthropic Claude Code MCP  
   [https://docs.anthropic.com/en/docs/claude-code/mcp](https://docs.anthropic.com/en/docs/claude-code/mcp)

2. Anthropic Claude Code Slash Commands  
   [https://docs.anthropic.com/en/docs/claude-code/slash-commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

3. OpenAI Skills repository  
   [https://github.com/openai/skills](https://github.com/openai/skills)
