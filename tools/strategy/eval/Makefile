SHELL := /bin/bash
.DEFAULT_GOAL := help

REPO_ROOT := $(abspath ../..)
STRATEGY_DIR := $(abspath ..)
QUANTDESK_DIR := $(REPO_ROOT)/tools/desktop/quantdesk

.PHONY: eval.dry-run eval.test help

eval.dry-run: ## Validate unified eval inputs and generate one case
	python3 run_strategy_eval.py --dry-run --limit 1 --strategy erc

eval.test: ## Run Strategy Eval unit tests
	cd $(STRATEGY_DIR) && python3 -m unittest discover -s eval_core -p '*_test.py'
	cd $(CURDIR) && ../../desktop/quantdesk/node_modules/.bin/vitest run --config vitest.config.ts --root .

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[[:alnum:]_.-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
