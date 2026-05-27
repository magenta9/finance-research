# QuantDesk - Unified build targets
# Run all commands from projects/quantdesk/

SHELL := /bin/bash
.DEFAULT_GOAL := help

# -----------------------------------------------------------------------------
# Environment
# -----------------------------------------------------------------------------

.PHONY: install install-mirror sidecar-setup

install: ## Install pnpm dependencies
	pnpm install --frozen-lockfile

install-mirror: ## Install with China Electron mirror
	ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm install

sidecar-setup: ## Set up Python sidecar via uv
	cd sidecar && \
		if [ -f .venv/pyvenv.cfg ]; then \
			python_home="$$(awk -F ' = ' '$$1 == "home" { print $$2 }' .venv/pyvenv.cfg)" && \
			if [ -n "$$python_home" ] && [ -f "$${python_home%/bin}/lib/libpython3.11.dylib" ]; then \
				mkdir -p .venv/lib && \
				cp "$${python_home%/bin}/lib/libpython3.11.dylib" .venv/lib/libpython3.11.dylib; \
			fi; \
		fi && \
		UV_LINK_MODE=copy uv sync --group dev && \
		python_home="$$(awk -F ' = ' '$$1 == "home" { print $$2 }' .venv/pyvenv.cfg)" && \
		python_target="$$(readlink .venv/bin/python || printf '%s/python\n' "$$python_home")" && \
		mkdir -p .venv/lib && \
		cp "$${python_home%/bin}/lib/libpython3.11.dylib" .venv/lib/libpython3.11.dylib && \
		rm -f .venv/bin/python && \
		cp "$$python_target" .venv/bin/python && \
		chmod +x .venv/bin/python && \
		ln -sf python .venv/bin/python3 && \
		ln -sf python .venv/bin/python3.11

# -----------------------------------------------------------------------------
# Development
# -----------------------------------------------------------------------------

.PHONY: dev dev-browser dev-renderer

dev: ## Start full dev environment (all watchers + Electron)
	pnpm dev

dev-browser: ## Start browser-debuggable dev environment with WS bridge on :9876
	QUANTDESK_RENDERER_PORT=$${QUANTDESK_RENDERER_PORT:-5173} QUANTDESK_WS_BRIDGE_PORT=$${QUANTDESK_WS_BRIDGE_PORT:-9876} pnpm dev

dev-renderer: ## Start only renderer dev server (Vite)
	pnpm --filter @quantdesk/renderer dev

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------

.PHONY: build build-shared build-main build-preload build-renderer

build: ## Build all workspace packages
	pnpm build

build-shared: ## Build shared package only
	pnpm --filter @quantdesk/shared build

build-main: ## Build main package only
	pnpm --filter @quantdesk/main build

build-preload: ## Build preload package only
	pnpm --filter @quantdesk/preload build

build-renderer: ## Build renderer package only
	pnpm --filter @quantdesk/renderer build

# -----------------------------------------------------------------------------
# Native module rebuild
# -----------------------------------------------------------------------------

.PHONY: rebuild-native rebuild-native-node rebuild-native-electron

rebuild-native: rebuild-native-electron ## Rebuild native modules (default: electron)

rebuild-native-node: ## Rebuild native modules for Node ABI
	node scripts/rebuild-native.mjs --target node

rebuild-native-electron: ## Rebuild native modules for Electron ABI
	node scripts/rebuild-native.mjs --target electron

# -----------------------------------------------------------------------------
# Quality
# -----------------------------------------------------------------------------

.PHONY: typecheck lint

typecheck: ## Type-check all workspace packages
	pnpm typecheck

lint: ## Lint all TypeScript packages
	pnpm lint

# -----------------------------------------------------------------------------
# Test
# -----------------------------------------------------------------------------

# Test suite taxonomy:
# - contract: shared surface and fixture compatibility checks
# - smoke: thin end-to-end path through a real boundary
# - behavior: module-specific logic and rules
# - integration: targeted cross-module coordination tests
# - e2e: real Electron shell probes

.PHONY: test test-unit test-e2e test-sidecar test-sidecar-server test-sidecar-contracts test-sidecar-merge test-all

test: test-unit ## Run unit tests (alias)

test-unit: ## Run Vitest unit tests
	pnpm test

test-e2e: ## Run Electron E2E tests (builds first)
	pnpm test:e2e

test-sidecar: ## Run full Python sidecar pytest suite
	pnpm test:sidecar

test-sidecar-server: ## Run sidecar server smoke tests
	pnpm test:sidecar:server

test-sidecar-contracts: ## Run sidecar contract tests
	pnpm test:sidecar:contracts

test-sidecar-merge: ## Run sidecar merge behavior tests
	pnpm test:sidecar:merge

test-all: test-unit test-e2e test-sidecar ## Run all test suites

# -----------------------------------------------------------------------------
# Package / Deploy
# -----------------------------------------------------------------------------

.PHONY: package

package: ## Build macOS DMG package
	ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" pnpm package:spike

# -----------------------------------------------------------------------------
# Clean
# -----------------------------------------------------------------------------

.PHONY: clean clean-all

clean: ## Remove build artifacts (dist/ dirs + release/)
	rm -rf packages/shared/dist packages/main/dist packages/preload/dist packages/renderer/dist
	rm -rf release/

clean-all: clean ## Remove artifacts + node_modules + sidecar .venv
	rm -rf node_modules
	rm -rf sidecar/.venv

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------

.PHONY: help

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[[:alnum:]_.-]+:.*## / {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)