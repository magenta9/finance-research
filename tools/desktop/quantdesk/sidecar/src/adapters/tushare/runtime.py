from __future__ import annotations

import sys
from typing import Any

try:
    import tushare as ts  # type: ignore
    from tushare.pro.client import DataApi  # type: ignore
except Exception:
    ts = None
    DataApi = None


def _get_tushare_runtime() -> Any:
    return sys.modules[__name__]


__all__ = ["DataApi", "_get_tushare_runtime", "ts"]
