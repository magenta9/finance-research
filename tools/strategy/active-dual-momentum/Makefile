SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: eval.dry-run eval.test eval.baseline help

eval.dry-run: ## Validate ADM eval inputs and generate one case
	python3 eval/run_eval.py --dry-run --limit 1

eval.test: ## Run ADM eval unit tests
	python3 -m unittest discover -s eval -p '*_test.py'

eval.baseline: ## Run the default ADM baseline eval
	python3 eval/run_eval.py --sizes 5,10,20 --windows 1,2,3,5 --samples-per-size 50 --seed 20260528

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[[:alnum:]_.-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)