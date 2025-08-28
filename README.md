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

# dependents-scraper

Small Node.js tool to crawl GitHub repository dependents pages and emit per-repo Markdown reports.

Summary
 - Script: `src/scrape_dependents.mjs`
 - Per-repo output: `output/reports/*.md`
 - Aggregated index: `output/README.md` (generated separately)

Requirements
 - Node.js 18+ recommended
 - Internet access to GitHub

Install

```bash
# from project root
npm install
```

Quick usage

Run the scraper for a single repository:

```bash
npm run scrape -- --repo=OWNER/NAME
```

Important CLI options
- `--repo` (required): source repository `owner/name`
- `--min-stars` (default 0): filter dependents with fewer stars
- `--max-pages` (default 0 = unlimited)
- `--sleep-ms` (default 150 ms)
- `--output-dir` (default `output`)
- `--package_id` (optional): appended to dependents query for package-scoped views

Output
- Per-repo report: `output/reports/OWNER-NAME-dependents.md` — table of dependents plus a summary (pages scraped, repos found, filtered, total possible, percent processed when available).
- Aggregate README: `output/README.md` — built from the `output/reports` files.

CI / Workflows

This repo uses GitHub Actions to run the scraper and publish results.

- `.github/workflows/dependents.yml` — reusable workflow run per-repo (matrix). Each per-repo job writes its report to `output/reports` and may push that file to the repo. These jobs do not update `output/README.md`.
- `.github/workflows/scrape_dependents.yml` — top-level dispatcher that builds the matrix from `repos.json` and calls the reusable workflow for each repo.
- `.github/workflows/finalize_readme.yml` — a separate, reusable workflow that generates `output/README.md` from `output/reports` and commits (or opens a PR if pushing to the branch is not possible). It is called once after the matrix completes, and can also be run manually via Actions → Finalize README → Run workflow.

Usage notes
- Per-repo jobs can safely push their individual report files; the aggregate README is generated once by the finalize workflow to avoid race conditions.
- If your repo uses branch protection or requires reviews, the finalize workflow will create a PR instead of pushing directly.

Running the finalize step manually

You can regenerate and publish the aggregated README without rerunning all scrapes:

- In the GitHub UI: Actions → Finalize README → Run workflow
- From the CLI (using gh):

```bash
gh workflow run finalize_readme.yml --repo <owner>/<repo>
```

Troubleshooting
- If pushes are rejected because the branch changed, the finalize workflow will create a PR so you can review and merge.
- If `output` is in `.gitignore`, consider allowing `output/reports/` with a `.gitignore` exception (e.g. add `!output/reports/`) instead of force-adding ignored files in workflows.
- If GitHub page markup changes and reports look empty, update selectors in `parseDependents` (`src/scrape_dependents.mjs`).

Contributing

Open issues or PRs for bugs and improvements. Small, focused PRs with a short smoke test are easiest to review.

Generated on: August 28, 2025
