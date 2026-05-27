from __future__ import annotations

import os
from typing import Any

from .candidates import TuShareCandidate
from .catalog import CatalogMixin
from .constants import TUSHARE_DEFAULT_API_URL
from .prices import PriceMixin
from .runtime import _get_tushare_runtime


class TuShareAdapter(CatalogMixin, PriceMixin):
    def __init__(self, token: str | None = None) -> None:
        self._token = (token or os.environ.get("TUSHARE_TOKEN") or "").strip()
        self._catalog_cache: dict[str, tuple[float, list[TuShareCandidate]]] = {}
        self._client: Any | None = None

    def _configure_https_transport(self) -> None:
        runtime = _get_tushare_runtime()
        if runtime.DataApi is not None:
            setattr(runtime.DataApi, "_DataApi__http_url", TUSHARE_DEFAULT_API_URL)

    def _get_client(self) -> Any:
        runtime = _get_tushare_runtime()
        if runtime.ts is None:
            raise RuntimeError("tushare package is not available.")
        if not self._token:
            raise RuntimeError("TUSHARE_TOKEN is not configured.")
        if self._client is None:
            self._configure_https_transport()
            self._client = runtime.ts.pro_api(self._token)
        return self._client
