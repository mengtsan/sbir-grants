# 在 Claude Code 連接 `sbir-grants` MCP Server

本專案對 Claude Code 的支援方式不是 `SKILL.md`，而是 `MCP server`。

實際 server 入口：

- [mcp-server/server.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/server.py)

啟動方式依 repo 內容可確認為 stdio MCP：

- `main()` 使用 `mcp.server.stdio.stdio_server`
- `pyproject.toml` 已定義 script：`sbir-data-server = "server:main"`

來源：

- Anthropic Claude Code MCP: [https://docs.anthropic.com/en/docs/claude-code/mcp](https://docs.anthropic.com/en/docs/claude-code/mcp)
- Anthropic Claude Code Slash Commands: [https://docs.anthropic.com/en/docs/claude-code/slash-commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

## 需求

1. Python `>=3.10`
2. `uv` 或 `pip`
3. Claude Code 可讀取本機設定並啟動 stdio MCP server

## 安裝依賴

在本專案目錄執行：

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
uv pip install -e .
```

若不用 `uv`：

```bash
cd /Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server
pip install -e .
```

依據：

- [mcp-server/pyproject.toml](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/pyproject.toml)
- [mcp-server/requirements.txt](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/requirements.txt)

## 建議的 Claude Code MCP 設定

以 stdio 方式掛載：

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

若你偏好用 `pyproject.toml` 的 script entry，也可用：

```json
{
  "mcpServers": {
    "sbir-data": {
      "command": "uv",
      "args": [
        "--directory",
        "/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server",
        "run",
        "sbir-data-server"
      ]
    }
  }
}
```

這兩種寫法都對應到 repo 內真實存在的入口：

1. `server.py`
2. `sbir-data-server = "server:main"`

## 啟動後可用能力

目前這個 MCP server 內含：

1. 互動式 proposal generator 流程
2. `enrich_answer`
3. `save_answer`
4. `get_progress`
5. `generate_proposal`
6. `verify_company_eligibility_by_g0v`
7. `query_moea_statistics`
8. `calculate_roi`
9. `validate_roi`
10. 文件 ingest / retrieval 相關工具

實際工具定義可看：

- [mcp-server/server.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/server.py)

## 本 repo 對 Claude Code 的定位

Claude Code 這邊比較適合：

1. 透過 MCP tools 實際執行 SBIR 問答流程
2. 呼叫 `enrich_answer` 做題目級補強
3. 呼叫 `save_answer` / `get_progress` 維持本機 proposal 狀態
4. 呼叫 ROI、公司資格檢核與知識檢索工具

若你只需要讓 Codex 理解本 repo 的知識與方法論，而不是啟動工具，請看：

- [CODEX_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CODEX_SETUP.md)

## 建議驗證方式

確認 Claude Code 已成功連到 MCP server 後，至少應能呼叫：

1. `get_progress`
2. `enrich_answer`
3. `save_answer`

若 `enrich_answer` 可接受 `context` 並返回：

- 正規化答案
- 題目級補強建議
- 可接受候選版本

代表這條整合路徑正常。

## 相關檔案

1. [mcp-server/server.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/server.py)
2. [mcp-server/README.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/README.md)
3. [mcp-server/pyproject.toml](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/pyproject.toml)
4. [mcp-server/enrich_answer.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/enrich_answer.py)
