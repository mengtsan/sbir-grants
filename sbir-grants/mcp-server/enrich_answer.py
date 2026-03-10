"""
SBIR Skill - 問答品質判斷與補強建議

目標：
1. 與 SaaS 端的題目規則與關鍵 deterministic 行為對齊
2. 接住自然語言回答、零值回答、否定型回答與求助型回答
3. 在本機 Skill 模式下，提供可直接採用的補寫框架與候選版本
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from roi_calculator import calculate_roi

SHARED_DOMAIN_DIR = Path(__file__).parent.parent.parent / "shared_domain"
PROJECT_ROOT = Path(__file__).parent.parent
QUESTIONS_FILE = PROJECT_ROOT / "proposal_generator" / "questions.json"


def load_enrich_criteria() -> dict[str, dict[str, Any]]:
    rules_file = SHARED_DOMAIN_DIR / "enrich_criteria.json"
    with open(rules_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("enrichable_questions", {})


def load_questions() -> dict[str, dict[str, Any]]:
    with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {question["id"]: question for question in data.get("questions", [])}


ENRICHABLE_QUESTIONS = load_enrich_criteria()
QUESTIONS = load_questions()

ZERO_EQUIVALENT_PATTERN = re.compile(
    r"^(0|零|沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|尚未訪談|尚未正式訪談|沒有訪談|未訪談|目前沒有訪談|目前尚未訪談)$"
)
NEGATIVE_TEAM_EXPERIENCE_PATTERN = re.compile(
    r"^(沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|無相關經驗|沒有相關經驗|目前沒有相關產業或技術的成功經驗)$"
)

OFFICIAL_INDUSTRY_OPTIONS = QUESTIONS["industry"]["options"]

INDUSTRY_ALIAS_GROUPS: list[tuple[str, list[str]]] = [
    ("A 農、林、漁、牧業", ["農業", "漁業", "畜牧", "農產"]),
    ("C 製造業", ["製造", "加工", "機械", "設備", "精密加工", "工廠", "五金"]),
    ("F 營建工程業", ["營建", "建築", "工程", "裝修"]),
    ("G 批發及零售業", ["零售", "批發", "電商", "通路"]),
    ("I 住宿及餐飲業", ["餐飲", "旅宿", "飯店", "咖啡", "民宿"]),
    ("J 出版影音及資通訊業", ["軟體", "saas", "平台", "app", "資訊", "資通", "ai", "系統"]),
    ("M 專業、科學及技術服務業", ["顧問", "行銷", "廣告", "設計", "研發服務", "技術服務", "公關"]),
    ("Q 醫療保健及社會工作服務業", ["醫療", "生技", "照護", "健康", "診所", "醫材"]),
    ("S 其他服務業", ["服務業", "清潔", "美容", "維修", "其他服務"]),
]

BUSINESS_MODEL_ALIAS_GROUPS: list[tuple[str, list[str]]] = [
    ("一次性銷售（賣斷）", ["賣斷", "一次性", "專案制", "一次買斷", "單次收費", "一次收費", "每份收費", "按件收費", "企劃書收費", "接案收費", "課金", "付兩萬", "收兩萬"]),
    ("訂閱制（SaaS）", ["訂閱", "saas", "月費", "年費", "租用"]),
    ("授權金", ["授權", "權利金", "royalty"]),
    ("混合模式", ["混合", "都有", "搭配", "雙軌"]),
    ("其他", ["其他"]),
]


def normalize_text(value: str) -> str:
    return (
        (value or "")
        .strip()
        .replace("０", "0")
        .replace("１", "1")
        .replace("２", "2")
        .replace("３", "3")
        .replace("４", "4")
        .replace("５", "5")
        .replace("６", "6")
        .replace("７", "7")
        .replace("８", "8")
        .replace("９", "9")
        .replace("，", ",")
    )


def extract_number(value: str) -> float | None:
    normalized = normalize_text(value)
    matched = re.search(r"-?\d+(?:\.\d+)?", normalized)
    if not matched:
        return None
    try:
        return float(matched.group(0))
    except ValueError:
        return None


def is_negative_team_experience(value: str) -> bool:
    answer = normalize_text(value)
    if not answer:
        return False
    if "\n" in answer or re.search(r"(^|\s)[1-4][\.\)]", answer):
        return False
    if NEGATIVE_TEAM_EXPERIENCE_PATTERN.match(answer):
        return True
    return (
        ("沒有" in answer or "尚無" in answer or "目前沒有" in answer or answer == "無")
        and any(keyword in answer for keyword in ["成功經驗", "相關經驗", "相關產業", "相關技術"])
    )


def is_help_request(value: str) -> bool:
    answer = normalize_text(value)
    return bool(re.search(r"不知道怎麼|不確定怎麼|我不確定|你幫我|幫我估|不會估|不太會估|不曉得", answer))


def infer_choice_option(question_id: str, answer: str) -> str | None:
    question = QUESTIONS.get(question_id)
    if not question:
        return None

    options = question.get("options", [])
    normalized = normalize_text(answer).lower()
    if not normalized:
        return None

    for option in options:
        if normalized == option.lower() or normalized in option.lower():
            return option

    if question_id == "industry":
        for option, aliases in INDUSTRY_ALIAS_GROUPS:
            if any(alias in normalized for alias in aliases):
                return option

    if question_id == "business_model":
        for option, aliases in BUSINESS_MODEL_ALIAS_GROUPS:
            if any(alias in normalized for alias in aliases):
                return option
        if (
            any(token in normalized for token in ["收", "費", "報價", "課金", "付"])
            and any(token in normalized for token in ["企劃書", "提案", "專案", "一次", "生成"])
        ):
            return "一次性銷售（賣斷）"

    return None


def infer_industry_bucket(industry_answer: str) -> str:
    official = infer_choice_option("industry", industry_answer)
    if not official:
        return "服務業"
    if official.startswith("C "):
        return "製造業"
    if official.startswith("J "):
        return "資通訊"
    if official.startswith("Q "):
        return "生技/醫療"
    if official.startswith("M ") or official.startswith("S ") or official.startswith("G "):
        return "服務業"
    return "製造業"


def build_team_experience_candidate(context: dict[str, Any] | None) -> str:
    ctx = context or {}
    leader = normalize_text(str(ctx.get("project_leader", "")))
    team = normalize_text(str(ctx.get("team_composition", "")))
    solution = normalize_text(str(ctx.get("solution_description", "")))
    problem = normalize_text(str(ctx.get("problem_description", "")))
    company = normalize_text(str(ctx.get("company_name", "")))

    subject = f"{company} 團隊" if company else "目前團隊"
    capability_signals: list[str] = []
    if leader:
        capability_signals.append(f"由 {leader} 擔任核心執行角色")
    if team:
        capability_signals.append("已具備明確的團隊分工與執行配置")
    if solution:
        capability_signals.append("已能具體說明預計交付的解決方案")
    if problem:
        capability_signals.append("已能清楚界定要解決的市場問題與應用情境")

    gap_reason = (
        f"{subject} 目前切入的是新的產品化或技術應用情境，與過往經驗並非完全同型，因此尚未累積可直接對應本案的成功案例。"
        if solution or problem
        else f"{subject} 目前正在切入新的題目與應用情境，因此尚未累積可直接對應本案的成功案例。"
    )
    capability_evidence = (
        "；".join(capability_signals)
        if capability_signals
        else "團隊仍具備需求理解、方案規劃、問題拆解與專案推進能力，可作為本案執行的基礎旁證。"
    )

    return "\n".join([
        "1. 經驗現況：目前團隊尚無與本案完全對應的直接成功案例。",
        f"2. 缺口原因：{gap_reason}",
        f"3. 能力旁證：{capability_evidence}",
        "4. 執行可行性：雖然目前沒有直接成功案例，但依現有團隊分工與既有能力，仍具備推進本計畫與逐步補齊驗證的可行性。",
    ])


def build_customer_validation_candidate(context: dict[str, Any] | None) -> str:
    ctx = context or {}
    clues: list[str] = []
    if normalize_text(str(ctx.get("problem_description", ""))):
        clues.append("已明確辨識目標客戶的痛點與問題情境")
    if normalize_text(str(ctx.get("solution_description", ""))):
        clues.append("已初步定義解法與應用場景")
    if normalize_text(str(ctx.get("target_market", ""))):
        clues.append("已可描述目標客群與切入市場")
    clue_text = "；".join(clues) if clues else "目前已有初步需求假設，但尚未形成正式訪談紀錄。"
    return "\n".join([
        "1. 訪談現況：目前尚未正式訪談潛在客戶，已訪談家數可先記為 0。",
        f"2. 目前線索：{clue_text}",
        "3. 下一步驗證：建議優先安排 3 至 5 家潛在客戶訪談，確認痛點優先順序、導入條件與付費意願。",
    ])


def estimate_budget_total(context: dict[str, Any] | None) -> str:
    ctx = context or {}
    team_text = normalize_text(str(ctx.get("team_composition", "")))
    solution_text = normalize_text(str(ctx.get("solution_description", "")))
    company_size = extract_number(str(ctx.get("company_size", ""))) or 1
    customer_validation = extract_number(str(ctx.get("customer_validation", ""))) or 0
    business_model = normalize_text(str(ctx.get("business_model", "")))

    budget = 85.0
    if team_text:
        budget += min(max(team_text.count("\n") + 1, 1), 4) * 5
    else:
        budget += min(max(company_size, 1), 4) * 4
    if solution_text and any(token in solution_text for token in ["AI", "平台", "系統", "整合", "資料"]):
        budget += 10
    if customer_validation > 0:
        budget += 5
    if "訂閱" in business_model or "SaaS" in business_model:
        budget += 5

    budget = max(10, min(round(budget / 5) * 5, 150))
    return "\n".join([
        str(int(budget)),
        "估算基礎：依目前已知的團隊規模、解法內容與驗證需求，先抓一版保守的 Phase 1 預估總經費。",
        "主要組成：以人事費、外部協作/顧問、驗證測試與必要工具成本為主。",
    ])


def estimate_revenue(question_id: str, context: dict[str, Any] | None) -> str:
    ctx = context or {}
    budget_total = extract_number(str(ctx.get("budget_total", "")))
    industry = infer_industry_bucket(str(ctx.get("industry", "")))
    if budget_total is None:
        return "目前缺少總經費資料，請先補上 budget_total，才能依保守 ROAS 基準試算營收。"

    subsidy_amount = min(budget_total * 0.5, 75)
    roi = calculate_roi(subsidy_amount=subsidy_amount, phase="phase1", industry=industry)
    year_index_map = {
        "expected_revenue_year1": 0,
        "expected_revenue_year2": 1,
        "expected_revenue_year3": 2,
    }
    year_idx = year_index_map[question_id]
    yearly = roi["yearly_breakdown"][year_idx]
    return "\n".join([
        str(int(round(yearly["recommended"]))),
        f"估算基礎：先以補助款約 {subsidy_amount:.0f} 萬元，套用 {industry} 的保守 ROAS 基準，整理第 {yearly['year']} 年營收目標。",
        f"三年建議總產值：約 {roi['targets']['recommended']['total_revenue']:.0f} 萬元。",
    ])


def build_number_help_hint(question_id: str, context: dict[str, Any] | None) -> dict[str, Any]:
    if question_id == "budget_total":
        return {
            "sufficient": False,
            "issue": "目前尚未提供可直接寫入的總經費數字。",
            "suggestion": ENRICHABLE_QUESTIONS[question_id]["criteria"],
            "enriched_hint": "我已先依目前資料整理一版保守總經費候選值，您可直接採用或再微調。",
            "draft_answer": estimate_budget_total(context),
        }

    if question_id in {"expected_revenue_year1", "expected_revenue_year2", "expected_revenue_year3"}:
        return {
            "sufficient": False,
            "issue": "目前尚未提供可直接寫入的預期營收數字。",
            "suggestion": ENRICHABLE_QUESTIONS[question_id]["criteria"],
            "enriched_hint": "我已先依總經費與產業基準整理一版保守營收候選值，您可直接採用或再微調。",
            "draft_answer": estimate_revenue(question_id, context),
        }

    return {
        "sufficient": False,
        "issue": "目前尚未提供可直接寫入的數字。",
        "suggestion": ENRICHABLE_QUESTIONS[question_id]["criteria"],
        "enriched_hint": "請直接補數字；如果目前不確定，可說明您不知道怎麼估，系統會先提供保守框架。",
    }


def check_answer_quality(question_id: str, user_answer: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    if question_id not in QUESTIONS:
        return {"sufficient": False, "issue": f"未知題目 ID：{question_id}"}

    question = QUESTIONS[question_id]
    criteria_def = ENRICHABLE_QUESTIONS.get(question_id)
    answer = normalize_text(user_answer)

    if not answer:
        return {
            "sufficient": False,
            "issue": "尚未提供回答內容",
            "suggestion": (criteria_def or {}).get("criteria", "請直接提供這題的核心答案。"),
            "enriched_hint": (criteria_def or {}).get("criteria", "請直接提供這題的核心答案。"),
        }

    if question["type"] == "choice":
        normalized_option = infer_choice_option(question_id, answer)
        if normalized_option:
            note = None
            if normalized_option != answer:
                note = f"系統會將您的回答整理為正式選項：{normalized_option}"
            return {"sufficient": True, "normalized_answer": normalized_option, "note": note}
        return {
            "sufficient": False,
            "issue": "回答不在可用選項內",
            "suggestion": "請改成最接近的正式選項。",
            "enriched_hint": "若您是用自然語言描述，請直接補充公司屬性或收費方式，我會協助對應到正式分類。",
        }

    if question["type"] in {"number", "scale"}:
        if question_id == "customer_validation" and ZERO_EQUIVALENT_PATTERN.match(answer):
            return {"sufficient": True, "normalized_answer": "0", "note": "未正式訪談可直接記為 0。"}

        numeric_value = extract_number(answer)
        if numeric_value is not None:
            min_value = question.get("validation", {}).get("min", question.get("scale", {}).get("min"))
            max_value = question.get("validation", {}).get("max", question.get("scale", {}).get("max"))
            if min_value is not None and numeric_value < min_value:
                return {"sufficient": False, "issue": f"數值過小，需至少 {min_value}"}
            if max_value is not None and numeric_value > max_value:
                return {"sufficient": False, "issue": f"數值過大，需不超過 {max_value}"}
            normalized_number = str(int(numeric_value)) if float(numeric_value).is_integer() else str(numeric_value)
            return {"sufficient": True, "normalized_answer": normalized_number}

        if is_help_request(answer) and question_id in ENRICHABLE_QUESTIONS:
            return build_number_help_hint(question_id, context)

        return {
            "sufficient": False,
            "issue": "這題需要數字格式",
            "suggestion": (criteria_def or {}).get("criteria", "請直接提供數字。"),
            "enriched_hint": "若目前不確定，請直接說不知道怎麼估，我會先提供保守框架。",
        }

    if question_id == "team_experience" and is_negative_team_experience(answer):
        draft = build_team_experience_candidate(context)
        return {
            "sufficient": True,
            "normalized_answer": "目前沒有相關產業或技術的成功經驗",
            "note": "這是第一次申請 SBIR 常見且可接受的回答。我已根據現有資料整理出一版較正式的描述。",
            "draft_answer": draft,
        }

    if question_id == "customer_validation" and ZERO_EQUIVALENT_PATTERN.match(answer):
        draft = build_customer_validation_candidate(context)
        return {
            "sufficient": True,
            "normalized_answer": "0",
            "note": "尚未正式訪談可直接記為 0。",
            "draft_answer": draft,
        }

    if question_id == "market_size" and is_help_request(answer):
        return {
            "sufficient": False,
            "issue": "目前尚未有可直接寫入的市場規模估算。",
            "suggestion": criteria_def["criteria"],
            "enriched_hint": "請先用 TAM / SAM / SOM / 估算依據 四段式整理；沒有數字也可以先交代目前掌握到哪一步與打算引用哪些來源。",
        }

    if not criteria_def:
        return {"sufficient": True}

    if len(answer) < criteria_def["min_chars"]:
        return {
            "sufficient": False,
            "issue": f"回答內容較短（目前 {len(answer)} 字，建議至少 {criteria_def['min_chars']} 字）",
            "suggestion": criteria_def["criteria"],
            "enriched_hint": criteria_def.get("expand_hint", "請嘗試補上具體細節、對比、量化數字或估算依據。"),
        }

    if question_id == "market_size" and not re.search(r"\d", answer):
        return {
            "sufficient": False,
            "issue": "市場規模回答缺少數字或估算依據。",
            "suggestion": criteria_def["criteria"],
            "enriched_hint": "請至少補上目前已掌握的市場數據、引用來源或估算公式；若尚未取得數字，也請交代您現在掌握的市場邊界。",
        }

    return {"sufficient": True}


async def MCP_enrich_answer(
    question_id: str,
    user_answer: str,
    question_text: str = "",
    context: dict[str, Any] | None = None,
) -> str:
    if not question_id:
        return "❌ 請提供 question_id 參數"

    if not user_answer or not user_answer.strip():
        return "❌ 請提供 user_answer（使用者的回答內容）"

    result = check_answer_quality(question_id, user_answer, context)

    if result.get("sufficient"):
        message_parts = [
            "✅ **回答可接受**",
            "",
            f"**問題 ID**：{question_id}",
        ]
        if question_text:
            message_parts.append(f"**問題**：{question_text}")
        if result.get("normalized_answer"):
            message_parts.append(f"**正式答案**：{result['normalized_answer']}")
        if result.get("note"):
            message_parts.extend(["", f"**說明**：{result['note']}"])
        if result.get("draft_answer"):
            message_parts.extend(["", "**可直接採用的整理版本**：", str(result["draft_answer"])])
        return "\n".join(message_parts)

    message_parts = [
        "⚠️ **回答需要補強**",
        "",
        f"**問題 ID**：{question_id}",
    ]
    if question_text:
        message_parts.append(f"**問題**：{question_text}")
    message_parts.append(f"**您的回答**：{user_answer[:120]}{'...' if len(user_answer) > 120 else ''}")

    if result.get("issue"):
        message_parts.extend(["", f"**問題所在**：{result['issue']}"])
    if result.get("suggestion"):
        message_parts.extend(["", "**建議補強標準**：", str(result["suggestion"])])
    if result.get("enriched_hint"):
        message_parts.extend(["", "**建議補充方向**：", str(result["enriched_hint"])])
    if result.get("draft_answer"):
        message_parts.extend(["", "**可先採用的候選版本**：", str(result["draft_answer"])])

    return "\n".join(message_parts)
