#!/usr/bin/env python3
import json
from pathlib import Path

from enrich_answer import check_answer_quality


ROOT = Path(__file__).resolve().parent.parent.parent
SAAS_QUESTIONS = ROOT / "saas" / "backend" / "src" / "data" / "questions.json"
SKILL_QUESTIONS = ROOT / "sbir-grants" / "proposal_generator" / "questions.json"


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def first_line(value: str) -> str:
    return value.strip().splitlines()[0].strip()


def load_questions(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {question["id"]: question for question in data["questions"]}


def main() -> None:
    saas_questions = load_questions(SAAS_QUESTIONS)
    skill_questions = load_questions(SKILL_QUESTIONS)

    synced_fields = {
        "industry": ["placeholder", "options"],
        "current_solutions": ["placeholder"],
        "customer_validation": ["required"],
        "customer_pain_score": ["required"],
        "market_size": ["required", "placeholder"],
        "budget_total": ["placeholder"],
        "expected_revenue_year1": ["placeholder"],
        "expected_revenue_year2": ["placeholder"],
        "expected_revenue_year3": ["placeholder"],
    }

    for question_id, fields in synced_fields.items():
        for field in fields:
            assert_true(
                saas_questions[question_id].get(field) == skill_questions[question_id].get(field),
                f"{question_id}.{field} must stay aligned with SaaS",
            )

    industry_result = check_answer_quality("industry", "行銷顧問")
    assert_true(industry_result.get("sufficient") is True, "industry natural language answer should be accepted")
    assert_true(
        industry_result.get("normalized_answer") == "M 專業、科學及技術服務業",
        "industry should normalize 行銷顧問 to official major category",
    )

    business_model_result = check_answer_quality("business_model", "要生成完整企劃書的時候要課金兩萬")
    assert_true(business_model_result.get("sufficient") is True, "business_model natural language should be accepted")
    assert_true(
        business_model_result.get("normalized_answer") == "一次性銷售（賣斷）",
        "business_model should normalize one-off project charging phrases",
    )

    customer_validation_result = check_answer_quality("customer_validation", "0")
    assert_true(customer_validation_result.get("sufficient") is True, "customer_validation=0 should be accepted")
    assert_true(customer_validation_result.get("normalized_answer") == "0", "customer_validation zero should normalize to 0")

    team_context = {
        "company_name": "煜言顧問有限公司",
        "project_leader": "邱煜庭 / 創辦人",
        "team_composition": "1. 邱煜庭：產品與商務\n2. 工程顧問：系統開發",
        "solution_description": "AI 協助生成 SBIR 企劃書的平台服務",
        "problem_description": "中小企業老闆不擅長把想法整理成政府補助計畫書",
    }
    team_result = check_answer_quality("team_experience", "目前沒有相關產業或技術的成功經驗", team_context)
    assert_true(team_result.get("sufficient") is True, "negative team_experience answer should be accepted")
    assert_true(team_result.get("draft_answer"), "negative team_experience should provide a drafted formal version")
    assert_true("1. 經驗現況：" in team_result["draft_answer"], "team_experience draft must use 4-part structure")

    budget_context = {
        "company_size": "3",
        "solution_description": "AI 協助生成 SBIR 企劃書的平台與顧問流程工具",
        "business_model": "一次性銷售（賣斷）",
        "customer_validation": "0",
    }
    budget_result = check_answer_quality("budget_total", "我不知道怎麼估", budget_context)
    assert_true(budget_result.get("sufficient") is False, "budget_total help answer should trigger helper flow")
    assert_true(budget_result.get("draft_answer"), "budget_total helper must return a deterministic candidate")
    assert_true(first_line(budget_result["draft_answer"]).isdigit(), "budget_total draft first line must be numeric")

    revenue_context = {
        "budget_total": first_line(budget_result["draft_answer"]),
        "industry": "行銷顧問",
        "business_model": "一次性銷售（賣斷）",
    }
    revenue_result = check_answer_quality("expected_revenue_year1", "我不知道怎麼估", revenue_context)
    assert_true(revenue_result.get("sufficient") is False, "expected_revenue helper should be suggestion mode")
    assert_true(revenue_result.get("draft_answer"), "expected_revenue helper must provide a deterministic candidate")
    assert_true(first_line(revenue_result["draft_answer"]).isdigit(), "expected_revenue draft first line must be numeric")

    market_result = check_answer_quality("market_size", "我不知道怎麼估")
    assert_true(market_result.get("sufficient") is False, "market_size uncertainty should not auto-pass")
    assert_true("TAM / SAM / SOM" in str(market_result.get("enriched_hint", "")), "market_size should guide TAM/SAM/SOM framework")

    print("skill-saas-alignment: PASS")


if __name__ == "__main__":
    main()
