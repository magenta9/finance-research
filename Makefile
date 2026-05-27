# finance-research tool targets

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: data.build data.install data.test data.aliases strategy.test jobs.smoke desktop.install desktop.dev desktop.test desktop.build desktop.package fmt test clean help

##@ Data

data.build: ## Build the Go quant-data CLI
	cd tools/data/quant-data && go build -o quant-data ./cmd/quant-data

data.install: ## Install the Go quant-data CLI into GOPATH/bin
	cd tools/data/quant-data && go install ./cmd/quant-data

data.test: ## Run Go quant-data tests
	cd tools/data/quant-data && go test ./...

data.aliases: ## Verify and print quant-data index aliases
	cd tools/data/quant-data && python3 scripts/refresh_index_aliases.py

##@ Strategy

strategy.test: ## Run Python strategy tests
	python3 -m unittest discover -s tools/strategy/futures-trend-observation -p '*_test.py'

##@ Jobs

jobs.smoke: ## Dry-run the futures trend observation batch job
	python3 tools/jobs/futures-trend-observation-report.py --dry-run --limit 1

##@ Desktop

desktop.install: ## Install QuantDesk desktop dependencies
	$(MAKE) -C tools/desktop/quantdesk install

desktop.dev: ## Start QuantDesk desktop dev environment
	$(MAKE) -C tools/desktop/quantdesk dev

desktop.test: ## Run QuantDesk desktop tests
	$(MAKE) -C tools/desktop/quantdesk test

desktop.build: ## Build QuantDesk desktop workspace packages
	$(MAKE) -C tools/desktop/quantdesk build

desktop.package: ## Build QuantDesk macOS package
	$(MAKE) -C tools/desktop/quantdesk package

##@ Repository

fmt: ## Format Go and Python code
	cd tools/data/quant-data && go fmt ./...
	ruff format .agents tools

test: data.test strategy.test jobs.smoke ## Run retained-stack checks

clean: ## Remove local build and Python cache artifacts
	rm -f tools/data/quant-data/quant-data
	find tools .agents -type d -name __pycache__ -prune -exec rm -rf {} +

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; current = ""} /^##@ / {current = substr($$0, 5); print "\n" current ":"} /^[[:alnum:]_.-]+:.*## / {if (current == "") {current = "Other"; print "\n" current ":"} printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
