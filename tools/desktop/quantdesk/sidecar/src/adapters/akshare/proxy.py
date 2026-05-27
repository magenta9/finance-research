from __future__ import annotations

from contextlib import contextmanager
import os
import threading


_DOMESTIC_DOMAINS = (
    ".10jqka.com.cn",
    ".eastmoney.com",
    ".sina.com.cn",
    "boc.cn",
    "pbc.gov.cn",
    "sse.com.cn",
    "szse.cn",
    "cninfo.com.cn",
)

_PROXY_BYPASS_STATE_LOCK = threading.Lock()
_PROXY_BYPASS_DEPTH = 0
_PROXY_BYPASS_SAVED_ENV: tuple[str | None, str | None] | None = None


def _merge_no_proxy_entries(*values: str) -> str:
    merged: list[str] = []
    seen: set[str] = set()

    for value in values:
        for raw_entry in value.split(","):
            entry = raw_entry.strip()
            if not entry or entry in seen:
                continue
            seen.add(entry)
            merged.append(entry)

    return ",".join(merged)


@contextmanager
def _bypass_proxy_for_domestic():
    global _PROXY_BYPASS_DEPTH, _PROXY_BYPASS_SAVED_ENV

    with _PROXY_BYPASS_STATE_LOCK:
        if _PROXY_BYPASS_DEPTH == 0:
            _PROXY_BYPASS_SAVED_ENV = (
                os.environ.get("no_proxy"),
                os.environ.get("NO_PROXY"),
            )
            merged = _merge_no_proxy_entries(
                _PROXY_BYPASS_SAVED_ENV[0] or "",
                _PROXY_BYPASS_SAVED_ENV[1] or "",
                *_DOMESTIC_DOMAINS,
            )
            os.environ["no_proxy"] = merged
            os.environ["NO_PROXY"] = merged
        _PROXY_BYPASS_DEPTH += 1

    try:
        yield
    finally:
        with _PROXY_BYPASS_STATE_LOCK:
            _PROXY_BYPASS_DEPTH -= 1
            if _PROXY_BYPASS_DEPTH == 0:
                lower_saved, upper_saved = _PROXY_BYPASS_SAVED_ENV or (None, None)

                if lower_saved is None:
                    os.environ.pop("no_proxy", None)
                else:
                    os.environ["no_proxy"] = lower_saved

                if upper_saved is None:
                    os.environ.pop("NO_PROXY", None)
                else:
                    os.environ["NO_PROXY"] = upper_saved

                _PROXY_BYPASS_SAVED_ENV = None