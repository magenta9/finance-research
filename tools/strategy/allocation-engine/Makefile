SHELL := /bin/bash
.DEFAULT_GOAL := help

QUANTDESK_MAIN_NODE_MODULES := $(abspath ../../desktop/quantdesk/packages/main/node_modules)
VITEST := $(abspath ../../desktop/quantdesk/node_modules/.bin/vitest)

.PHONY: help setup test

setup: ## Symlink QuantDesk main node_modules deps required by allocation-engine
	mkdir -p node_modules
	ln -sfn $(QUANTDESK_MAIN_NODE_MODULES)/ml-matrix node_modules/ml-matrix

test: setup ## Run allocation-engine unit tests
	$(VITEST) run --config vitest.config.ts --root .

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[[:alnum:]_.-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
