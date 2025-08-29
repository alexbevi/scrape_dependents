#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
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
  .option("package_id", { type: "string", default: null, desc: "Optional package_id for dependents scraping" })
  .argv;

const UA = "dependents-scraper-node/1.0";

// ---------- HTML scraping ----------
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

function extractTotals(html) {
  const $ = loadHTML(html);
  // Find the Repositories count in the Box header
  const repoAnchor = $('.Box-header .table-list-filters .table-list-header-toggle a:contains("Repositories")').first();
  if (!repoAnchor.length) return { totalRepositories: null };
  const text = repoAnchor.text();
  const match = text.match(/([0-9,]+)/);
  if (!match) return { totalRepositories: null };
  const total = parseInt(match[1].replace(/,/g, ''), 10);
  return { totalRepositories: isNaN(total) ? null : total };
}

async function crawlDependents(repo, maxPages, sleepMs) {
  const seen = new Set();
  const results = [];
  let totalPossibleRepos = null;
  let cursor = null;
  const [owner, name] = repo.split("/");
  const stem = `${owner}-${name}-dependents`;
  let page = 1;

  while (true) {
    if (maxPages > 0 && page > maxPages) break;
    const url = dependentsUrl(repo, cursor, argv.package_id);
    let html;
    let attempt = 1;
    while (true) {
      try {
        html = await getHtml(url);
        if (page === 1) {
          const totals = extractTotals(html);
          totalPossibleRepos = totals.totalRepositories;
        }
        break;
      } catch (err) {
        if (err.message.includes('429')) {
          // Rate limit: batch markdown write only on error
          console.warn(`Rate limit hit on page ${page}, attempt ${attempt}. Flushing Markdown and sleeping...`);
          // Only filter/sort here for partial output
          const minStars = argv["min-stars"];
          const filtered = results.filter(r => (r.stars ?? 0) >= minStars);
          const sorted = filtered.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
          flushMarkdown(sorted, {
            repo,
            outputDir: argv["output-dir"],
            pagesScraped: page,
            reposFound: results.length,
            reposFiltered: results.length - sorted.length,
            totalPossibleRepos,
            language: argv.language || '',
            type: argv.type || ''
          });
          await sleep(1000);
          attempt++;
          if (attempt > 5) {
            console.error('Too many rate limit retries, exiting.');
            return { results, totalPossibleRepos };
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
  return { results, totalPossibleRepos };
}
// ---------- HTML scraping ----------
function dependentsUrl(repo, cursor = null, package_id = null) {
  const [owner, name] = repo.split("/");
  let url = `https://github.com/${owner}/${name}/network/dependents`;
  const params = [];
  if (cursor) params.push(`dependents_after=${cursor}`);
  if (package_id) params.push(`package_id=${package_id}`);
  if (params.length) url += `?${params.join("&")}`;
  return url;
}

async function getHtml(url, attempt = 1) {
  try {
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
  } catch (err) {
    // Retry on UND_ERR_SOCKET (SocketError: other side closed)
    if (err.code === 'UND_ERR_SOCKET' && attempt < 4) {
      const backoff = Math.min(2 ** attempt, 10) * 1000;
      await sleep(backoff);
      return getHtml(url, attempt + 1);
    }
    throw err;
  }
}

// ---------- Markdown flush helper ----------
function flushMarkdown(rows, meta) {
  const {
    repo,
    minStars = 0,
    pagesScraped,
    reposFound,
    reposFiltered,
    totalPossibleRepos = null,
    language = '',
    type = ''
  } = meta;
  const outputDir = meta.outputDir || 'output';
  const reportsDir = `${outputDir}/reports`;
  mkdirSync(reportsDir, { recursive: true });
  const [owner, name] = repo.split("/");
  const stem = `${owner}-${name}-dependents`;
  const mdPath = `${reportsDir}/${stem}.md`;

  // Markdown title
  let md = `# Scraped repository: ${repo}\n`;
  md += `* **Language:** ${language}\n`;
  md += `* **Type:** ${type}\n\n`;

  // Table header
  md += `| Owner | Name | Stars | Forks | URL |\n|---|---|---|---|---|\n`;
  // Table rows
  for (const r of rows) {
    md += `| ${r.owner} | ${r.name} | ${r.stars ?? ''} | ${r.forks ?? ''} | [link](${r.html_url}) |\n`;
  }

  // Summary
  md += `\n---\n`;
  md += `* **Last scrape:** ${new Date().toISOString()}\n`;
  md += `* **Total pages scraped:** ${pagesScraped}\n`;
  md += `* **Repos found:** ${reposFound}\n`;
  md += `* **Repos filtered out (< ${minStars} stars):** ${reposFiltered}\n`;
  md += `* **Total possible repositories:** ${totalPossibleRepos ?? 'unknown'}\n`;
  // Percentage processed when totalPossibleRepos is available
  if (totalPossibleRepos && Number(totalPossibleRepos) > 0) {
    const pct = ((Number(reposFound) / Number(totalPossibleRepos)) * 100).toFixed(1);
    md += `* **Percent processed:** ${pct}%\n`;
  } else {
    md += `* **Percent processed:** unknown\n`;
  }

  writeFileSync(mdPath, md);
  // Force file system sync to ensure the Markdown report is present before updating README
  try { require('fs').fsyncSync(require('fs').openSync(mdPath, 'r')); } catch (e) {}

  // Update results/README.md with grouped tables by type
  const readmePath = `${outputDir}/README.md`;
  let reports = [];
  try {
    const files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(`${reportsDir}/${file}`, 'utf8');
      const repoMatch = content.match(/# Scraped repository: ([^\n]+)/);
      const langMatch = content.match(/\* \*\*Language:\*\*\* ([^\n]+)/) || content.match(/\* \*Language:\*\* ([^\n]+)/) || content.match(/\* \*Language:\*\*([^\n]+)/);
      const typeMatch = content.match(/\* \*\*Type:\*\*\* ([^\n]+)/) || content.match(/\* \*Type:\*\* ([^\n]+)/) || content.match(/\* \*Type:\*\*([^\n]+)/);
      const lastScrapeMatch = content.match(/\* \*\*Last scrape:\*\*\* ([^\n]+)/) || content.match(/\* \*Last scrape:\*\* ([^\n]+)/) || content.match(/\* \*Last scrape:\*\*([^\n]+)/);
      const pagesMatch = content.match(/\* \*\*Total pages scraped:\*\*\* ([^\n]+)/) || content.match(/\* \*Total pages scraped:\*\* ([^\n]+)/) || content.match(/\* \*Total pages scraped:\*\*([^\n]+)/);
      const foundMatch = content.match(/\* \*\*Repos found:\*\*\* ([^\n]+)/) || content.match(/\* \*Repos found:\*\* ([^\n]+)/) || content.match(/\* \*Repos found:\*\*([^\n]+)/);
      const filteredMatch = content.match(/\* \*\*Repos filtered out \(< ([^ ]+) stars\):\*\* ([^\n]+)/) || content.match(/\* \*Repos filtered out \(< ([^ ]+) stars\):\*\* ([^\n]+)/) || content.match(/\* \*Repos filtered out \(< ([^ ]+) stars\):\*\*([^\n]+)/);
      reports.push({
        file,
        repo: repoMatch ? repoMatch[1] : '',
        language: langMatch ? langMatch[1].trim() : '',
        type: typeMatch ? typeMatch[1].trim() : '',
        lastScrape: lastScrapeMatch ? lastScrapeMatch[1].trim() : '',
        pages: pagesMatch ? pagesMatch[1].trim() : '',
        found: foundMatch ? foundMatch[1].trim() : '',
        filtered: filteredMatch ? filteredMatch[2].trim() : ''
      });
    }
  } catch (e) {
    // ignore
  }

  // Group by type
  const groups = {};
  for (const r of reports) {
    const t = r.type || 'Unknown';
    if (!groups[t]) groups[t] = [];
    groups[t].push(r);
  }

  const types = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  let readme = "# Scrape Reports\n\n";
  for (const t of types) {
    const list = groups[t].slice().sort((a, b) => (a.repo || '').localeCompare(b.repo || ''));
    readme += `## ${t}\n\n`;
    readme += "| Organization | Repository | Language | Last Scrape | Pages | Found | Filtered |\n";
    readme += "|---|---|---|---|---|---|---|\n";
    for (const item of list) {
      const parts = (item.repo || '').split('/');
      const org = parts[0] || '';
      const repoName = parts[1] || '';
      readme += `| ${org} | ${repoName} | ${item.language} | ${item.lastScrape} | ${item.pages} | ${item.found} | ${item.filtered} |\n`;
    }
    readme += "\n";
  }
  writeFileSync(readmePath, readme);
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
  const crawlRes = await crawlDependents(repo, maxPages, sleepMs);
  console.log = origConsoleLog;
  if (!crawlRes || !Array.isArray(crawlRes.results)) {
    console.warn('crawlDependents returned unexpected result, treating as zero results');
    dependents = [];
    totalPossible = null;
  } else {
    dependents = crawlRes.results;
    var totalPossible = crawlRes.totalPossibleRepos;
  }
  allRepos = dependents;
  console.log(`Found ${dependents.length} candidate repos (possible: ${totalPossible ?? 'unknown'})`);

  // Filter and sort only once at the end
  const filtered = dependents.filter(r => (r.stars ?? 0) >= minStars);
  const sorted = filtered.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));

  // Batch markdown write only at the end
  flushMarkdown(sorted, {
    repo,
    minStars,
    pagesScraped,
    reposFound: allRepos.length,
    reposFiltered: allRepos.length - sorted.length,
    totalPossibleRepos: totalPossible,
    language: argv.language || '',
    type: argv.type || '',
    outputDir
  });

  console.log("Wrote:");
  const [owner, name] = repo.split("/");
  const stem = `${owner}-${name}-dependents`;
  const mdPath = `${outputDir}/reports/${stem}.md`;
  console.log("  " + mdPath);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
