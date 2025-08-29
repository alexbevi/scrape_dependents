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

## License

See [LICENSE](./LICENSE)