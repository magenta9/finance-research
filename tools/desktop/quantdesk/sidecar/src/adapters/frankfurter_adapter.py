from __future__ import annotations

import json
import logging
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen


logger = logging.getLogger(__name__)


def _sort_by_date(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: str(row["date"]))


class FrankfurterAdapter:
    api_base = "https://api.frankfurter.dev/v2/rates"

    def _request(
        self, *, base: str, quote: str, start: str, end: str
    ) -> list[dict[str, Any]]:
        url = f"{self.api_base}?{urlencode({'base': base, 'quotes': quote, 'from': start, 'to': end})}"
        with urlopen(url, timeout=10) as response:
            payload = response.read().decode("utf-8")
        data = json.loads(payload)
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def fetch_fx_rates(self, pair: str, start: str, end: str) -> dict[str, object]:
        warnings: list[str] = []

        if "/" not in pair:
            return {
                "pair": pair,
                "rates": [],
                "warnings": [f"Frankfurter does not recognize FX pair {pair}."],
            }

        base, quote = pair.split("/", 1)

        try:
            direct = self._request(base=base, quote=quote, start=start, end=end)
        except HTTPError as error:
            warnings.append(
                f"Frankfurter direct request failed for {pair}: HTTP {error.code}"
            )
            direct = []
        except URLError as error:
            warnings.append(
                f"Frankfurter direct request failed for {pair}: {error.reason}"
            )
            direct = []
        except Exception as error:
            warnings.append(f"Frankfurter direct request failed for {pair}: {error}")
            direct = []

        if direct:
            return {
                "pair": pair,
                "rates": _sort_by_date(
                    [
                        {
                            "date": str(item["date"]),
                            "rate": float(item["rate"]),
                            "source": "frankfurter",
                        }
                        for item in direct
                        if item.get("rate") is not None
                    ]
                ),
                "warnings": warnings,
            }

        try:
            inverse = self._request(base=quote, quote=base, start=start, end=end)
        except HTTPError as error:
            warnings.append(
                f"Frankfurter inverse request failed for {pair}: HTTP {error.code}"
            )
            inverse = []
        except URLError as error:
            warnings.append(
                f"Frankfurter inverse request failed for {pair}: {error.reason}"
            )
            inverse = []
        except Exception as error:
            warnings.append(f"Frankfurter inverse request failed for {pair}: {error}")
            inverse = []

        if inverse:
            warnings.append(
                f"Derived {pair} from Frankfurter inverse pair {quote}/{base}."
            )
            return {
                "pair": pair,
                "rates": _sort_by_date(
                    [
                        {
                            "date": str(item["date"]),
                            "rate": round(1 / float(item["rate"]), 8),
                            "source": "frankfurter-derived",
                        }
                        for item in inverse
                        if item.get("rate") not in (None, 0)
                    ]
                ),
                "warnings": warnings,
            }

        if not warnings:
            warnings.append(f"Frankfurter returned no FX rows for {pair}.")

        logger.warning(
            "frankfurter_fx_empty", extra={"pair": pair, "warnings": warnings}
        )
        return {"pair": pair, "rates": [], "warnings": warnings}
