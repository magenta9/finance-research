# Quant Data CLI Is Implemented In Go

Status: accepted

`quant-data` will be implemented in Go rather than reusing the existing Python sidecar implementation. The TypeScript app integrates with the CLI only through the JSON command contract, so the app-side runner and adapter remain language-agnostic. This favors a standalone user-installed executable and simpler runtime deployment over reusing Python provider adapter code directly.