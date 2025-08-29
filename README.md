## Introduction

Identifying popular dependents (repositories that depend on a project and have many stars) helps prioritize compatibility, discover high-impact users, and surface integration opportunities. This tool extracts dependents and ranks them by stars so you can focus on the most influential dependents first.

## Quick summary

- Script: `src/scrape_dependents.mjs`
- Per-repo output: `output/reports/*.md`
- Aggregated index: `output/README.md` (generated separately)

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

## Aggregated README generator (`src/generate_readme.mjs`)

The `generate_readme` script builds `output/README.md` from the per-repo Markdown files in `output/reports/`.

Behavior:
- It scans `output/reports/*.md` for per-repo metadata (Language, Type, Last scrape timestamp, pages scraped, repos found, filtered count, total possible, percent processed).
- Groups reports by `type` (value from each report) and sorts repositories within each group.
- Produces a table per `type` with these columns: Organization, Repository (links to the per-repo report), Language, Last Scrape, Pages, Found, Filtered, Total Possible, Percent.
- Writes `output/README.md` and prints the path.

Legend (columns in the aggregated README):
- Organization: GitHub organization or user owning the repository.
- Repository: Repository name linked to the report in `output/reports/`.
- Language: Optional language metadata included when the report is generated.
- Last Scrape: ISO timestamp from the per-repo report.
- Pages: Number of dependents pages scraped.
- Found: Total dependents discovered by the scraper for that repo.
- Filtered: Number of dependents excluded by the `--min-stars` filter.
- Total Possible: Number shown by GitHub's dependents UI (when parseable).
- Percent: Fraction of total possible dependents processed (when available), formatted as a percentage.

How the workflows use the generator:
- Matrix jobs (`.github/workflows/dependents.yml`) write per-repo report files to `output/reports/` and attempt to commit them.
- After the matrix completes, the dispatcher calls the reusable `finalize_readme.yml`, which runs `src/generate_readme.mjs` and commits `output/README.md` (or opens a PR if pushing is not possible due to branch protection or race conditions).

Manual regeneration:
- Run locally:

```bash
node src/generate_readme.mjs output
```

- Or trigger the `Finalize README` workflow in the GitHub UI to regenerate from reports already present in the repository.

Troubleshooting the generator
- If `output/reports` is empty the script prints an error and produces no README.
- If columns look empty, check a per-repo report to ensure the metadata lines (Last scrape, Total pages scraped, Repos found, etc.) exist and their formatting matches what the generator expects.

## License

See [LICENSE](./LICENSE)
