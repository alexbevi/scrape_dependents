#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { load as loadHTML } from "cheerio";
import { request as httpRequest } from "undici";
import pLimit from "p-limit";

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = yargs.default(hideBin(process.argv))
  .option("repo", { type: "string", demandOption: true, desc: "Source repo: owner/name" })
  .option("min-stars", { type: "number", default: 0, desc: "Minimum stargazers to include" })
  .option("max-pages", { type: "number", default: 0, desc: "Max dependents pages to crawl" })
  .option("include-forks", { type: "boolean", default: false, desc: "Include forks" })
  .option("sleep-ms", { type: "number", default: 150, desc: "Delay between HTML fetches (ms)" })
  .option("output-dir", { type: "string", default: "output", desc: "Directory for results" })
  .argv;

const UA = "dependents-scraper-node/1.0";

// ---------- HTML scraping ----------
function dependentsUrl(repo, cursor = null) {
  const [owner, name] = repo.split("/");
  let url = `https://github.com/${owner}/${name}/network/dependents?dependent_type=REPOSITORY`;
  if (cursor) url += `&dependents_after=${cursor}`;
  return url;
}

async function getHtml(url, attempt = 1) {
  const res = await httpRequest(url, {
    method: "GET",
    headers: {
      "user-agent": UA,
      accept: "text/html"
    }
  });
  if (res.statusCode >= 500 || res.statusCode === 429) {
    if (attempt >= 4) throw new Error(`GET ${url} failed (${res.statusCode})`);
    const backoff = Math.min(2 ** attempt, 10) * 1000;
    await sleep(backoff);
    return getHtml(url, attempt + 1);
  }
  if (res.statusCode !== 200) throw new Error(`GET ${url} failed (${res.statusCode})`);
  return res.body.text();
}

function parseDependents(html, sourceRepo) {
  const $ = loadHTML(html);
  const out = [];

  // Each dependent repo is in a .Box-row (GitHub markup as of 2025)
  $('.Box-row').each((_, el) => {
    const repoLink = $(el).find('a[data-hovercard-type="repository"]');
    const href = repoLink.attr('href');
    if (!href) return;
    const parts = href.split('/').filter(Boolean);
    if (parts.length < 2) return;
    const full = `${parts[0]}/${parts[1]}`;
    if (full.toLowerCase() === sourceRepo.toLowerCase()) return;
    if (["issues", "pulls", "marketplace", "explore", "topics"].includes(parts[0])) return;

    // Extract star and fork counts using SVG class selectors
    let stars = null, forks = null;
    $(el).find('.d-flex.flex-auto.flex-justify-end > span').each((_, span) => {
      const starSvg = $(span).find('svg.octicon-star');
      const forkSvg = $(span).find('svg.octicon-repo-forked');
      const text = $(span).text().replace(/,/g, '').trim();
      if (starSvg.length) {
        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) stars = num;
      }
      if (forkSvg.length) {
        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) forks = num;
      }
    });

    out.push({
      owner: parts[0],
      name: parts[1],
      full_name: full,
      html_url: `https://github.com/${full}`,
      stars,
      forks
    });
  });

  return out;
}

async function crawlDependents(repo, maxPages, sleepMs) {
  const seen = new Set();
  const results = [];
  let cursor = null;
  let page = 1;

  while (true) {
    if (maxPages > 0 && page > maxPages) break;
    const url = dependentsUrl(repo, cursor);
    let html;
    let attempt = 1;
    while (true) {
      try {
        html = await getHtml(url);
        break;
      } catch (err) {
        if (err.message.includes('429')) {
          // Rate limit: flush Markdown, sleep, and retry
          console.warn(`Rate limit hit on page ${page}, attempt ${attempt}. Flushing Markdown and sleeping...`);
          flushMarkdown(results, {
            repo,
            outputDir: argv["output-dir"],
            minStars: argv["min-stars"],
            pagesScraped: page,
            reposFound: results.length,
            reposFiltered: 0 // can't filter mid-scrape
          });
          await sleep(1000);
          attempt++;
          if (attempt > 5) {
            console.error('Too many rate limit retries, exiting.');
            return results;
          }
        } else {
          throw err;
        }
      }
    }

    const repos = parseDependents(html, repo);
    const newOnes = repos.filter(r => !seen.has(r.full_name));
    newOnes.forEach(r => seen.add(r.full_name));
    if (newOnes.length === 0) break; // likely end
    results.push(...newOnes);

    // Output progress
    console.log(`Page ${page}: ${newOnes.length} new repos, total ${results.length}`);

    // Find the next cursor from the Next button
    const $ = loadHTML(html);
    const nextBtn = $('a.btn.BtnGroup-item:contains("Next")');
    if (nextBtn.length) {
      const nextHref = nextBtn.attr('href');
      const match = nextHref.match(/dependents_after=([^&]+)/);
      cursor = match ? match[1] : null;
      if (!cursor) break;
    } else {
      break;
    }

    page++;
    await sleep(sleepMs);
  }
  return results;
}

// ---------- Markdown flush helper ----------
function flushMarkdown(rows, meta) {
  const { repo, outputDir, minStars } = meta;
  mkdirSync(outputDir, { recursive: true });
  const [owner, name] = repo.split("/");
  const stem = `${owner}-${name}-dependents`;
  const mdPath = `${outputDir}/${stem}.md`;

  // Markdown title
  let md = `# Scraped repository: ${repo}\n\n`;

  // Table header
  md += `| Owner | Name | Stars | Forks | URL |\n|---|---|---|---|---|\n`;
  // Table rows
  for (const r of rows) {
    md += `| ${r.owner} | ${r.name} | ${r.stars ?? ''} | ${r.forks ?? ''} | [link](${r.html_url}) |\n`;
  }

  // Summary
  md += `\n---\n`;
  md += `**Last scrape:** ${new Date().toISOString()}\n`;
  md += `**Total pages scraped:** ${meta.pagesScraped}\n`;
  md += `**Repos found:** ${meta.reposFound}\n`;
  md += `**Repos filtered out (< ${minStars} stars):** ${meta.reposFiltered}\n`;

  writeFileSync(mdPath, md);
}

// ---------- Main ----------
(async () => {
  const { repo, maxPages, sleepMs, outputDir, minStars } = {
    repo: argv.repo,
    maxPages: argv["max-pages"],
    sleepMs: argv["sleep-ms"],
    outputDir: argv["output-dir"],
    minStars: argv["min-stars"]
  };

  if (!repo.includes("/")) {
    throw new Error("Invalid --repo. Use owner/name form.");
  }

  console.log(`Crawling dependents for ${repo} …`);
  let pagesScraped = 0;
  let allRepos = [];
  let dependents = [];
  // Wrap crawlDependents to count pages
  const origConsoleLog = console.log;
  console.log = (msg) => {
    if (/^Page /.test(msg)) pagesScraped++;
    origConsoleLog(msg);
  };
  dependents = await crawlDependents(repo, maxPages, sleepMs);
  console.log = origConsoleLog;
  allRepos = dependents;
  console.log(`Found ${dependents.length} candidate repos`);

  // Filter by minStars
  const filtered = dependents.filter(r => (r.stars ?? 0) >= minStars);
  // Sort by star count (descending)
  const sorted = filtered.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));

  // Markdown output
  flushMarkdown(sorted, {
    repo,
    outputDir,
    minStars,
    pagesScraped,
    reposFound: allRepos.length,
    reposFiltered: allRepos.length - sorted.length
  });

  console.log("Wrote:");
  const [owner, name] = repo.split("/");
  const stem = `${owner}-${name}-dependents`;
  const mdPath = `${outputDir}/${stem}.md`;
  console.log("  " + mdPath);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
