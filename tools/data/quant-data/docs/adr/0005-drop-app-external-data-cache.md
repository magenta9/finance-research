# Drop Legacy External Data Cache Tables

Status: accepted

When finance-research switches to the data CLI, tools stop relying on legacy SQLite external-data caches and drop the old price and FX cache tables instead of migrating or retaining them. The CLI becomes the only external-data store and repopulates data through provider refreshes. This favors a clean ownership boundary over preserving previously cached provider data for rollback or offline continuity.