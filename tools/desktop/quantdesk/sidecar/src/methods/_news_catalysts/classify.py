from __future__ import annotations

from typing import Any

CATEGORY_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    (
        "earnings_result",
        (
            "earnings",
            "annual report",
            "quarterly",
            "10-q",
            "10-k",
            "20-f",
            "6-k",
            "业绩",
            "年报",
            "季报",
            "中报",
        ),
    ),
    (
        "guidance_forecast",
        (
            "guidance",
            "forecast",
            "profit warning",
            "业绩预告",
            "盈利警告",
            "预盈",
            "预亏",
        ),
    ),
    ("buyback", ("buyback", "repurchase", "回购")),
    ("dividend", ("dividend", "distribution", "分红", "派息", "权益分派")),
    ("shareholder_meeting", ("shareholder meeting", "general meeting", "股东大会")),
    ("suspension_resumption", ("suspension", "resumption", "停牌", "复牌")),
    (
        "major_transaction",
        ("acquisition", "merger", "disposal", "重大资产", "收购", "并购", "重组"),
    ),
    (
        "litigation_regulatory",
        (
            "litigation",
            "investigation",
            "regulatory",
            "lawsuit",
            "诉讼",
            "监管",
            "处罚",
            "问询",
        ),
    ),
    ("issuance_listing", ("issuance", "offering", "listing", "配股", "增发", "上市")),
    ("contract_order", ("contract", "order", "中标", "合同", "订单")),
    ("operation_update", ("operation", "sales", "delivery", "经营", "销量", "产销")),
    (
        "management_change",
        ("director", "ceo", "cfo", "management", "董事", "高管", "辞任", "聘任"),
    ),
]


def classify_catalyst(title: str, filing_type: str | None = None) -> dict[str, Any]:
    text = f"{title} {filing_type or ''}".lower()

    for category, keywords in CATEGORY_KEYWORDS:
        if any(keyword.lower() in text for keyword in keywords):
            return {
                "category": category,
                "confidence": "low" if category == "operation_update" else "high",
            }

    return {"category": "other", "confidence": "medium"}
