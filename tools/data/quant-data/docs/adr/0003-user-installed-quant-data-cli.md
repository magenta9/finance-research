# Quant Data CLI Is User Installed

Status: accepted

finance-research treats `quant-data` as a user-installed tool dependency rather than bundling the data CLI inside a host application. Tooling documents installation and configuration steps, and compatibility can be checked through `quant-data help --json`. This favors an independent CLI lifecycle over a zero-install bundled data runtime.