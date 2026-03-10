# 在 Codex 安裝 `sbir-grants` Skill

本專案已包含標準 `SKILL.md`：

- [SKILL.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/SKILL.md)

這代表它可以被 Codex 當成 skill 安裝與載入。  
依目前 Codex skill installer 的工作方式，建議用「從 GitHub repo/path 安裝」或直接把 skill 目錄放進 `$CODEX_HOME/skills`。來源：

- OpenAI Skills repository: [https://github.com/openai/skills](https://github.com/openai/skills)

## 需求

1. 已安裝 Codex desktop 或可用的 Codex 執行環境
2. 可存取本 repo
3. 安裝後需重新啟動 Codex 才會載入新 skill

## 方式一：從 GitHub repo/path 安裝

若此 repo 已推到 GitHub，最穩定的方式是直接用 Codex 的 skill installer 從 repo/path 安裝。

安裝目標路徑應指向：

```text
sbir-grants
```

也就是含有 `SKILL.md` 的那層目錄，不是 repo 根目錄。

## 方式二：手動安裝到 `$CODEX_HOME/skills`

若你本機已經有這份 repo，也可以直接手動複製或連結：

```bash
mkdir -p ~/.codex/skills
ln -s /Users/backtrue/Documents/claude-sbir-skills/sbir-grants ~/.codex/skills/sbir-grants
```

如果已存在同名目錄，先處理舊連結或改用其他 skill 名稱。

## 安裝後如何確認

1. 重新啟動 Codex
2. 在 Codex 內要求使用 `$sbir-grants`
3. 確認它能讀到：
   - SBIR 方法論
   - `proposal_generator/questions.json`
   - `mcp-server/` 內的輔助工具與說明

## 建議使用方式

`Codex skill` 比較適合：

1. 生成 SBIR 撰寫策略
2. 查找本 repo 內的參考知識與方法論
3. 協助調整題目、提示、框架與流程設計
4. 搭配本 repo 的 MCP server 做更完整的資料處理

若你需要的是互動工具呼叫，而不是只讀取 skill 內容，請改看：

- [CLAUDE_CODE_MCP_SETUP.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/CLAUDE_CODE_MCP_SETUP.md)

## 目前限制

1. `SKILL.md` 只定義 skill 內容與使用情境，不會自動啟動 `mcp-server`
2. 若要使用 `enrich_answer`、`save_answer`、`get_progress` 這類 MCP 工具，仍需另外啟動 MCP server
3. `Codex` 與 `Claude Code` 的接法不同：
   - `Codex`：skill
   - `Claude Code`：MCP

## 相關檔案

1. [SKILL.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/SKILL.md)
2. [README.md](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/README.md)
3. [mcp-server/server.py](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/server.py)
4. [mcp-server/pyproject.toml](/Users/backtrue/Documents/claude-sbir-skills/sbir-grants/mcp-server/pyproject.toml)
