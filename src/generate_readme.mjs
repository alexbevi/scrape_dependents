#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = process.argv[2] || 'output';
const reportsDir = resolve(outputDir, 'reports');
const readmePath = resolve(outputDir, 'README.md');

function buildReadme() {
  const reports = [];
  let files = [];
  try {
    files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
  } catch (e) {
    console.error('No reports directory found:', reportsDir);
  }

  for (const file of files) {
    const content = readFileSync(`${reportsDir}/${file}`, 'utf8');
    const repoMatch = content.match(/# Scraped repository: ([^\n]+)/);
    const langMatch = content.match(/\* \*Language:\*\* ([^\n]+)/) || content.match(/\*\*Language:\*\* ([^\n]+)/);
    const typeMatch = content.match(/\* \*Type:\*\* ([^\n]+)/) || content.match(/\*\*Type:\*\* ([^\n]+)/);
    const lastScrapeMatch = content.match(/\* \*Last scrape:\* \*([^\n]+)/) || content.match(/\*\*Last scrape:\*\* ([^\n]+)/);
    const pagesMatch = content.match(/\* \*Total pages scraped:\* \*([^\n]+)/) || content.match(/\*\*Total pages scraped:\*\* ([^\n]+)/);
    const foundMatch = content.match(/\* \*Repos found:\* \*([^\n]+)/) || content.match(/\*\*Repos found:\*\* ([^\n]+)/);
    const filteredMatch = content.match(/\* \*Repos filtered out \(< ([^ ]+) stars\):\* \*([^\n]+)/) || content.match(/\*\*Repos filtered out \(< ([^ ]+) stars\):\*\* ([^\n]+)/);
    const totalPossibleMatch = content.match(/\* \*Total possible repositories:\* \*([^\n]+)/) || content.match(/\*\*Total possible repositories:\*\* ([^\n]+)/);
    const percentMatch = content.match(/\* \*Percent processed:\* \*([^\n]+)/) || content.match(/\*\*Percent processed:\*\* ([^\n]+)/);

    reports.push({
      file,
      repo: repoMatch ? repoMatch[1] : file.replace('.md',''),
      language: langMatch ? langMatch[1].trim() : '',
      type: typeMatch ? typeMatch[1].trim() : '',
      lastScrape: lastScrapeMatch ? lastScrapeMatch[1].trim() : '',
      pages: pagesMatch ? pagesMatch[1].trim() : '',
      found: foundMatch ? foundMatch[1].trim() : '',
      filtered: filteredMatch ? filteredMatch[2].trim() : '',
      totalPossible: totalPossibleMatch ? totalPossibleMatch[1].trim() : '',
      percent: percentMatch ? percentMatch[1].trim() : ''
    });
  }

  // Sort by repo
  reports.sort((a,b) => a.repo.localeCompare(b.repo));

  let readme = '# Scrape Reports\n\n';
  readme += '| Repository | Language | Type | Last Scrape | Pages | Found | Filtered | Total Possible | Percent |\n';
  readme += '|---|---|---|---|---|---|---|---:|---:|\n';
  for (const r of reports) {
    readme += `| [${r.repo}](reports/${r.file}) | ${r.language} | ${r.type} | ${r.lastScrape} | ${r.pages} | ${r.found} | ${r.filtered} | ${r.totalPossible || ''} | ${r.percent || ''} |\n`;
  }

  writeFileSync(readmePath, readme);
  console.log('Wrote', readmePath);
}

buildReadme();
