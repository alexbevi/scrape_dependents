# Agent Instructions

These instructions apply to the whole repository.

## Repo Map

- `src/scrape_dependents.mjs` is the main scraper. It fetches GitHub dependents HTML, extracts dependent repos, filters by star count, and writes one Markdown report per tracked source repo.
- `src/generate_readme.mjs` rebuilds `output/README.md` from the per-repo Markdown files in `output/reports/`.
- `repos.json` is the source of truth for the repositories tracked by scheduled and manual scrape runs.
- `.github/workflows/scrape_dependents.yml` builds the matrix from `repos.json`, exposes a manual `repo_choice` dropdown, and calls the reusable scraper workflow.
- `.github/workflows/dependents.yml` runs a single scrape and commits report changes.
- `.github/workflows/finalize_readme.yml` regenerates and commits the aggregate README after report updates.

## Shell And Search

- Prefix noisy shell commands with `rtk`, including `git`, `rg`, `npm`, `node`, `curl`, and test/build commands.
- Use `rg` or `rg --files` before slower alternatives when searching the checkout.
- Keep command output focused. Prefer targeted reads such as `rtk read README.md`, `rtk proxy rg -n "pattern" path`, or `rtk proxy sed -n '1,160p' file`.

## Tracking Repositories

When adding or changing a tracked repository:

- Update `repos.json` with `repo`, `language`, `type`, and `package_id` if the GitHub dependents page needs one.
- Also update the `repo_choice.options` list in `.github/workflows/scrape_dependents.yml`. The workflow filters by the final path segment of `repo`, so `owner/name` must have a matching `name` option for manual single-repo dispatch.
- Verify the GitHub slug resolves before committing when network access is available:

```bash
rtk curl -I https://github.com/OWNER/NAME
```

- Validate JSON and dropdown consistency:

```bash
rtk proxy node -e 'JSON.parse(require("fs").readFileSync("repos.json", "utf8")); console.log("repos.json ok")'
rtk proxy python3 - <<'PY'
import json, re
from pathlib import Path
repos = json.loads(Path("repos.json").read_text())
yml = Path(".github/workflows/scrape_dependents.yml").read_text()
options = set(re.findall(r"^\s+-\s+([^\s#]+)\s*$", yml, flags=re.M))
missing = [r["repo"].split("/")[-1] for r in repos if r["repo"].split("/")[-1] not in options]
if missing:
    raise SystemExit(f"missing workflow options: {missing}")
print("workflow options ok")
PY
```

## Generated Output

- `output/reports/*.md` and `output/README.md` are generated artifacts. Do not hand-edit generated reports unless the user explicitly asks for a report correction.
- If a task changes scraper output format, update `src/generate_readme.mjs` in the same change so the aggregate README can still parse report metadata.
- Regenerate the aggregate README after intentional report changes:

```bash
rtk proxy node src/generate_readme.mjs output
```

- For scraper smoke tests, avoid churn in tracked output unless the task is specifically to update reports. Use a temporary output directory:

```bash
rtk proxy node src/scrape_dependents.mjs --repo OWNER/NAME --max-pages 1 --min-stars 0 --output-dir /tmp/dependents-smoke --language JavaScript --type Framework
```

## Scraper Cautions

- GitHub dependents pages are HTML, not a stable API. Treat selector changes in `parseDependents`, `extractTotals`, and next-page cursor handling as high risk; verify with a small live scrape when changing them.
- Full scrapes can be slow and can hit rate limits. Prefer `--max-pages 1` for validation unless the user asks for a real/full run.
- `package_id` is appended to the dependents URL. Preserve existing encoded values exactly.
- The workflow uses `min-stars: 25` for scheduled/manual matrix runs; local defaults differ unless you pass `--min-stars`.

## Validation

- There is no dedicated test suite today. For code changes, run the narrowest useful checks:

```bash
rtk proxy node --check src/scrape_dependents.mjs
rtk proxy node --check src/generate_readme.mjs
rtk proxy node src/generate_readme.mjs output
```

- For dependency or runtime changes, also run `rtk npm install` or `rtk npm ci` as appropriate, then a one-page smoke scrape into `/tmp`.

## Git Hygiene

- Check status before staging: `rtk git status --short --branch`.
- Stage only files relevant to the requested change. Generated output should be included only when the user requested regenerated reports or README updates.
- Do not rewrite or discard user changes. If unrelated files are dirty, leave them alone.
