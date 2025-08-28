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
  .option("max-pages", { type: "number", default: 50, desc: "Max dependents pages to crawl" })
  .option("include-forks", { type: "boolean", default: false, desc: "Include forks" })
  .option("sleep-ms", { type: "number", default: 150, desc: "Delay between HTML fetches (ms)" })
  .option("output-dir", { type: "string", default: "output", desc: "Directory for results" })
  .argv;

const GH_TOKEN = process.env.DEPENDENTS_TOKEN || process.env.GITHUB_TOKEN || "";
if (!GH_TOKEN) {
  console.warn("WARNING: No token in DEPENDENTS_TOKEN/GITHUB_TOKEN; rate limit will be low and GraphQL will fail.");
}

const UA = "dependents-scraper-node/1.0";

// ---------- HTML scraping ----------
function dependentsUrl(repo, page) {
  const [owner, name] = repo.split("/");
  return `https://github.com/${owner}/${name}/network/dependents?dependent_type=REPOSITORY&p=${page}`;
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
  const out = new Set();

  // Robust selectors—GitHub occasionally tweaks markup
  let links = $('a[href^="/"][data-hovercard-type="repository"]');
  if (links.length === 0) links = $('a[href^="/"][data-repository-hovercards-enabled]');
  if (links.length === 0) links = $('a[href^="/"]');

  links.each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const parts = href.split("/").filter(Boolean);
    if (parts.length < 2) return;
    const full = `${parts[0]}/${parts[1]}`;
    if (full.toLowerCase() === sourceRepo.toLowerCase()) return;
    // Avoid obvious non-repo links (issues, pulls, explore, etc.)
    if (["issues", "pulls", "marketplace", "explore", "topics"].includes(parts[0])) return;
    out.add(full);
  });

  return [...out];
}

async function crawlDependents(repo, maxPages, sleepMs) {
  const seen = new Set();
  const results = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = dependentsUrl(repo, page);
    const html = await getHtml(url);
    const repos = parseDependents(html, repo);
    const newOnes = repos.filter(r => !seen.has(r));
    newOnes.forEach(r => seen.add(r));
    if (newOnes.length === 0) break; // likely end
    results.push(...newOnes);
    await sleep(sleepMs);
  }
  return results;
}

// ---------- GraphQL batching ----------
async function gql(query, variables = {}) {
  if (!GH_TOKEN) throw new Error("GitHub token required for GraphQL.");
  const res = await httpRequest("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "user-agent": UA,
      authorization: `Bearer ${GH_TOKEN}`,
      accept: "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.body.json();
  if (body.errors) {
    const msg = body.errors.map(e => e.message).join("; ");
    throw new Error(`GraphQL error: ${msg}`);
  }
  return body.data;
}

// Build a single GraphQL query with many repository() fields via aliases
function buildRepoBatchQuery(pairs) {
  const fields = pairs.map(
    ([owner, name], i) => `
      r${i}: repository(owner: "${owner}", name: "${name}") {
        nameWithOwner
        stargazerCount
        isFork
        url
        description
        pushedAt
      }`
  ).join("\n");

  return `query RepoBatch { ${fields} }`;
}

async function fetchRepoMetaBatch(fullNames, chunkSize = 50) {
  const chunks = [];
  for (let i = 0; i < fullNames.length; i += chunkSize) {
    chunks.push(fullNames.slice(i, i + chunkSize));
  }

  const limit = pLimit(4); // parallel GraphQL batches
  const results = [];

  await Promise.all(chunks.map((list) => limit(async () => {
    const pairs = list.map(fn => fn.split("/"));
    const q = buildRepoBatchQuery(pairs);
    const data = await gql(q);
    Object.values(data).forEach(node => {
      if (node && node.nameWithOwner) {
        results.push({
          full_name: node.nameWithOwner,
          stars: node.stargazerCount ?? 0,
          fork: !!node.isFork,
          html_url: node.url,
          description: node.description ?? "",
          pushed_at: node.pushedAt
        });
      }
    });
  })));

  return results;
}

// ---------- CSV ----------
function toCSV(rows) {
  const header = ["full_name", "stars", "fork", "html_url", "description", "pushed_at"];
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    header.join(","),
    ...rows.map(r => header.map(k => esc(r[k])).join(","))
  ].join("\n");
}

// ---------- Main ----------
(async () => {
  const { repo, maxPages, sleepMs, outputDir, minStars, includeForks } = {
    repo: argv.repo,
    maxPages: argv["max-pages"],
    sleepMs: argv["sleep-ms"],
    outputDir: argv["output-dir"],
    minStars: argv["min-stars"],
    includeForks: argv["include-forks"]
  };

  if (!repo.includes("/")) {
    throw new Error("Invalid --repo. Use owner/name form.");
  }

  console.log(`Crawling dependents for ${repo} …`);
  const dependents = await crawlDependents(repo, maxPages, sleepMs);
  console.log(`Found ${dependents.length} candidate repos`);

  let enriched;
  if (dependents.length === 0) {
    enriched = [];
  } else {
    if (!GH_TOKEN) {
      console.warn("No token; cannot enrich star counts. Outputting raw list.");
      enriched = dependents.map(full => ({
        full_name: full,
        stars: null, fork: null,
        html_url: `https://github.com/${full}`,
        description: "", pushed_at: null
      }));
    } else {
      enriched = await fetchRepoMetaBatch(dependents, 50);
    }
  }

  let filtered = enriched;
  if (GH_TOKEN) {
    filtered = enriched
      .filter(r => (includeForks || !r.fork))
      .filter(r => (r.stars ?? 0) >= minStars)
      .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  }

  mkdirSync(outputDir, { recursive: true });
  const [owner, name] = repo.split("/");
  const stem = `${owner}-${name}-dependents-min${minStars}`;
  const jsonPath = `${outputDir}/${stem}.json`;
  const csvPath = `${outputDir}/${stem}.csv`;

  writeFileSync(jsonPath, JSON.stringify({
    source_repo: repo,
    min_stars: minStars,
    include_forks: includeForks,
    generated_at: new Date().toISOString(),
    count: filtered.length,
    items: filtered
  }, null, 2));

  writeFileSync(csvPath, toCSV(filtered));

  console.log("Wrote:");
  console.log("  " + jsonPath);
  console.log("  " + csvPath);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
