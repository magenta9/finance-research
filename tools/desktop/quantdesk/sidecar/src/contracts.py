from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

from jsonschema import Draft7Validator
from jsonschema.exceptions import ValidationError


class MarketDataPolicy(TypedDict):
    searchProviderOrder: dict[str, list[str]]
    priceProviderOrder: dict[str, list[str]]
    fxProviderOrder: list[str]
    sourcePriorityWeights: dict[str, dict[str, Any]]
    derivedSourcePenalty: int | float


class NewsCatalystPolicy(TypedDict):
    announcementProviderOrder: dict[str, list[str]]
    catalystCategories: list[str]
    providerStatus: dict[str, str]
    schemaVersion: int
    sourcePriorityWeights: dict[str, int | float]
    symbolMarketRules: dict[str, Any]
    windowDefaults: dict[str, int]


class ResearchProviderPolicy(TypedDict):
    fieldCaveats: dict[str, str]
    flowSentimentProviderOrder: dict[str, list[str]]
    freshness: dict[str, int]
    fundamentalsProviderOrder: dict[str, list[str]]
    providerStatus: dict[str, str]
    schemaVersion: int


REQUIRED_PROPERTY_PATTERN = re.compile(r"'(?P<property>.+)' is a required property")
UNEXPECTED_PROPERTY_PATTERN = re.compile(
    r"Additional properties are not allowed \('(?P<property>.+)' was unexpected\)"
)


def _resolve_contracts_root() -> Path:
    configured = (
        Path(value) if (value := os.environ.get("QUANTDESK_CONTRACTS_ROOT")) else None
    )
    current_file = Path(__file__).resolve()
    candidates = [
        configured,
        current_file.parents[2] / "contracts",
        current_file.parents[2] / "app.asar.unpacked" / "contracts",
    ]

    for candidate in candidates:
        if candidate is not None and candidate.exists():
            return candidate

    return configured or (current_file.parents[2] / "contracts")


@lru_cache(maxsize=1)
def get_contracts_root() -> Path:
    return _resolve_contracts_root()


def _read_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _format_validation_path(error: ValidationError) -> str:
    pointer = "$"

    for segment in error.absolute_path:
        if isinstance(segment, int):
            pointer += f"[{segment}]"
        else:
            pointer += f".{segment}"

    return pointer


def _format_validation_error(error: ValidationError) -> str:
    pointer = _format_validation_path(error)

    if error.validator == "required":
        match = REQUIRED_PROPERTY_PATTERN.fullmatch(error.message)
        if match is not None:
            return f"{pointer}.{match.group('property')} is required."

    if error.validator == "additionalProperties":
        match = UNEXPECTED_PROPERTY_PATTERN.fullmatch(error.message)
        if match is not None:
            return f"{pointer}.{match.group('property')} is not allowed."

    if error.validator == "minItems":
        return f"{pointer} must contain at least {int(error.validator_value)} items."

    if error.validator == "enum":
        return (
            f"{pointer} must be one of "
            f"{', '.join(str(item) for item in error.validator_value)}."
        )

    if error.validator == "type":
        expected_type = str(error.validator_value)
        expected_label = (
            "an array"
            if expected_type == "array"
            else "an object"
            if expected_type == "object"
            else f"a {expected_type}"
        )
        return f"{pointer} must be {expected_label}."

    return f"{pointer}: {error.message}"


def _validation_error_sort_key(
    error: ValidationError,
) -> tuple[tuple[str, ...], str, tuple[str, ...]]:
    return (
        tuple(str(segment) for segment in error.absolute_path),
        error.validator,
        tuple(str(segment) for segment in error.absolute_schema_path),
    )


@lru_cache(maxsize=1)
def _load_market_data_policy_validator(schema_path: str) -> Draft7Validator:
    schema = _read_json_file(Path(schema_path))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def reset_contracts_cache_for_tests() -> None:
    get_contracts_root.cache_clear()
    load_market_data_policy.cache_clear()
    load_news_catalyst_policy.cache_clear()
    load_research_provider_policy.cache_clear()
    _load_market_data_policy_validator.cache_clear()
    _load_news_catalyst_policy_validator.cache_clear()
    _load_research_provider_policy_validator.cache_clear()


@lru_cache(maxsize=1)
def load_market_data_policy() -> MarketDataPolicy:
    contracts_root = get_contracts_root()
    schema_path = contracts_root / "market-data-policy.schema.json"
    policy_path = contracts_root / "market-data-policy.json"
    policy = _read_json_file(policy_path)
    validator = _load_market_data_policy_validator(str(schema_path))
    errors = [
        _format_validation_error(error)
        for error in sorted(
            validator.iter_errors(policy),
            key=_validation_error_sort_key,
        )
    ]

    if errors:
        raise RuntimeError(
            "market-data-policy.json failed schema validation:\n" + "\n".join(errors)
        )

    return policy


@lru_cache(maxsize=1)
def _load_news_catalyst_policy_validator(schema_path: str) -> Draft7Validator:
    schema = _read_json_file(Path(schema_path))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


@lru_cache(maxsize=1)
def load_news_catalyst_policy() -> NewsCatalystPolicy:
    contracts_root = get_contracts_root()
    schema_path = contracts_root / "news-catalyst-policy.schema.json"
    policy_path = contracts_root / "news-catalyst-policy.json"
    policy = _read_json_file(policy_path)
    validator = _load_news_catalyst_policy_validator(str(schema_path))
    errors = [
        _format_validation_error(error)
        for error in sorted(
            validator.iter_errors(policy),
            key=_validation_error_sort_key,
        )
    ]

    if errors:
        raise RuntimeError(
            "news-catalyst-policy.json failed schema validation:\n" + "\n".join(errors)
        )

    return policy


@lru_cache(maxsize=1)
def _load_research_provider_policy_validator(schema_path: str) -> Draft7Validator:
    schema = _read_json_file(Path(schema_path))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


@lru_cache(maxsize=1)
def load_research_provider_policy() -> ResearchProviderPolicy:
    contracts_root = get_contracts_root()
    schema_path = contracts_root / "research-provider-policy.schema.json"
    policy_path = contracts_root / "research-provider-policy.json"
    policy = _read_json_file(policy_path)
    validator = _load_research_provider_policy_validator(str(schema_path))
    errors = [
        _format_validation_error(error)
        for error in sorted(
            validator.iter_errors(policy),
            key=_validation_error_sort_key,
        )
    ]

    if errors:
        raise RuntimeError(
            "research-provider-policy.json failed schema validation:\n"
            + "\n".join(errors)
        )

    return policy


def load_market_data_fixture(name: str) -> Any:
    return _read_json_file(get_contracts_root() / "market-data-fixtures" / name)
