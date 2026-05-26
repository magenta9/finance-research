# finance-research tool targets

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: quant-data-build quant-data-install quant-data-test refresh-index-aliases strategy-test job-smoke test clean help

quant-data-build: ## Build the Go quant-data CLI
	cd tools/data/quant-data && go build -o quant-data ./cmd/quant-data

quant-data-install: ## Install the Go quant-data CLI into GOPATH/bin
	cd tools/data/quant-data && go install ./cmd/quant-data

quant-data-test: ## Run Go quant-data tests
	cd tools/data/quant-data && go test ./...

refresh-index-aliases: ## Verify and print quant-data index aliases
	cd tools/data/quant-data && python3 scripts/refresh_index_aliases.py

strategy-test: ## Run Python strategy tests
	python3 -m unittest discover -s tools/strategy/futures-trend-observation -p '*_test.py'

job-smoke: ## Dry-run the futures trend observation batch job
	python3 tools/jobs/futures-trend-observation-report.py --dry-run --limit 1

test: quant-data-test strategy-test job-smoke ## Run retained-stack checks

clean: ## Remove local build and Python cache artifacts
	rm -f tools/data/quant-data/quant-data
	find tools .agents -type d -name __pycache__ -prune -exec rm -rf {} +

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[[:alnum:]_.-]+:.*## / {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
