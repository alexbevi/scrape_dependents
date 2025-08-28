# dependents-scraper

A small Node.js tool that crawls GitHub repository dependents pages and emits per-repo Markdown reports.

- Script: `src/scrape_dependents.mjs`
- Output: `output/reports/*.md` and `output/README.md`

## Requirements

- Node.js (modern runtime; Node 18+ recommended)
- Internet access to GitHub

## Install

```bash
# from project root
npm install
```

## Quick usage

Run the scraper for a single repository (owner/name):

```bash
npm run scrape -- --repo=OWNER/NAME
```

Common options:

- `--repo` (string, required) — source repository in `owner/name` form
- `--min-stars` (number, default 0) — drop dependents with fewer stars than this
- `--max-pages` (number, default 0) — max dependents pages to crawl (0 = unlimited)
- `--include-forks` (boolean) — include forked repos
- `--sleep-ms` (number, default 150) — delay between page fetches (ms)
- `--output-dir` (string, default `output`) — where reports and README are written
- `--package_id` (string, optional) — if set, appended to dependents query (used for language-specific package views)

Example with package_id:

```bash
npm run scrape -- --repo=mongodb/mongo-ruby-driver --package_id=UGFja2FnZS0xMDQwOQ%3D%3D
```

Notes:
- You can also pass optional metadata flags (e.g. `--language` and `--type`) — these values are included in the generated per-repo Markdown and top-level `output/README.md`.

## Output

- Per-repo report: `output/reports/OWNER-NAME-dependents.md`
  - Contains a table of dependents and a summary block with: pages scraped, repos found, repos filtered, total possible repositories (if detected), and percent processed.
- Aggregate index: `output/README.md` — lists all report files and the extracted summary columns.

## GitHub Actions

This project includes workflows to run the scraper in CI:

- `.github/workflows/scrape_dependents.yml` — top-level dispatcher; builds a matrix from `repos.json` and can be triggered manually. It supports picking a single repo to rescrape (dispatch input) or running all repos.
- `.github/workflows/dependents.yml` — reusable workflow invoked per-repo. It forwards `--package_id` to the scraper and uploads the `output` directory as a per-run artifact (artifact names include the repo slug and run id to avoid collisions).

If you change the workflows, make sure the `output` path and artifact names stay consistent with the script (`--output-dir` flag).

## Contributing

Open issues or PRs for bugs and improvements. Keep edits small and include a short smoke-test demonstrating the change.ß
