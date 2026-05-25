# finance-research

Personal finance research tools organized around reusable data, strategy, and job entrypoints.

## Layout

- `tools/data/quant-data/`: Go CLI for external market data acquisition and provider policy handling.
- `.agents/skills/`: Agent-facing skill adapters. Reusable implementation should live under `tools/`.
- `tools/catalog.yaml`: source of truth for tool category, maturity stage, runtime, entrypoints, inputs, outputs, dependencies, and verification.
- `tools/strategy/futures-trend-observation/`: futures Trend Observation Setup analyzer, agent batch driver, report generator, tests, and contract universe.
- `tools/jobs/`: stable batch entrypoints for scheduled or manual runs.
- `tools/data/quant-data/contracts/`: quant-data-owned CLI schemas, fixtures, and provider policy contracts.
- `docs/quant-data-cli.md` and `tools/data/quant-data/docs/adr/`: retained quant-data documentation and decisions.

## Verification

```bash
make tool-catalog-check
make quant-data-test
make strategy-test
make job-smoke
```

Run everything retained in this cleanup pass:

```bash
make test
```

## Local Agent Configuration

The deterministic tools work without Agent credentials, but the Agent report runner needs a local `pi --mode rpc` configuration before it can call a model.

The default local user-data directory is:

```text
.finance-research/pi-agent/config/
```

Create these files locally:

- `.finance-research/pi-agent/config/settings.json`: default provider/model, for example `defaultProvider` and `defaultModel`.
- `.finance-research/pi-agent/config/auth.json`: provider credentials used by the local Agent runtime.

These files are intentionally ignored by Git via `.gitignore`. Do not commit credentials, session logs, or tool invocation state.

If you already have a working Agent configuration elsewhere, copy its `auth.json` and `settings.json` into `.finance-research/pi-agent/config/`, or pass an alternate location at runtime:

```bash
python3 tools/strategy/futures-trend-observation/pi_agent_futures_trend_observation_report.py --user-data-dir /path/to/user-data
```
