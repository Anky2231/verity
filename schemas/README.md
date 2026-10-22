# Shared contracts
Single source of truth for data crossing service boundaries.
- `finding.schema.json` — output of every agent (api stores it, web renders it, ai produces it).
- `big.schema.json` — Brand Intelligence Graph.
Change these via PR reviewed by Swastik (integration owner). Mirror changes in `ai/app/models.py` and `web` types.
