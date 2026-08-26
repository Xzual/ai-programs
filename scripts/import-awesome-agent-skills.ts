import fs from 'node:fs';
import path from 'node:path';

interface ImportedSkill {
  id: string;
  name: string;
  sourceUrl: string;
  description: string;
  category: string;
  riskLevel: number;
  permissions: string[];
  status: 'downloaded' | 'adapter-ready' | 'configuration-required' | 'deferred-high-risk';
}

const root = process.cwd();
const sourcePath = path.join(root, 'data', 'external-skills', 'awesome-agent-skills.README.md');
const outputPath = path.join(root, 'data', 'external-skills', 'awesome-agent-skills.catalog.json');

const categoryRules: Array<{
  category: string;
  patterns: RegExp[];
  permissions: string[];
  riskLevel: number;
  status: ImportedSkill['status'];
}> = [
  {
    category: 'finance',
    patterns: [/binance/i, /coinbase/i, /stripe/i, /finance/i, /financial/i, /accountant/i, /tax/i, /trading/i, /broker/i, /payment/i, /checkout/i],
    permissions: ['network:read'],
    riskLevel: 2,
    status: 'configuration-required',
  },
  {
    category: 'news-search',
    patterns: [/brave/i, /search/i, /news/i, /research/i, /reddit/i, /youtube/i, /hacker news/i, /crawl/i, /scrap/i, /firecrawl/i],
    permissions: ['network:read'],
    riskLevel: 1,
    status: 'configuration-required',
  },
  {
    category: 'messaging',
    patterns: [/whatsapp/i, /slack/i, /email/i, /mail/i, /courier/i, /resend/i, /notification/i, /webhook/i],
    permissions: ['network:read', 'network:write'],
    riskLevel: 3,
    status: 'configuration-required',
  },
  {
    category: 'browser-computer',
    patterns: [/browser/i, /playwright/i, /puppeteer/i, /selenium/i, /computer/i, /desktop/i, /open interpreter/i, /mcp-builder/i],
    permissions: ['network:read', 'browser:control'],
    riskLevel: 3,
    status: 'deferred-high-risk',
  },
  {
    category: 'documents',
    patterns: [/docx/i, /xlsx/i, /pptx/i, /pdf/i, /document/i, /spreadsheet/i, /slides/i, /ocr/i, /forms/i],
    permissions: ['file:read', 'file:write'],
    riskLevel: 2,
    status: 'configuration-required',
  },
  {
    category: 'coding-devops',
    patterns: [/github/i, /vercel/i, /cloudflare/i, /netlify/i, /expo/i, /react/i, /angular/i, /terraform/i, /supabase/i, /postgres/i, /neon/i, /firebase/i, /redis/i, /mongodb/i, /sentry/i, /datadog/i, /testing/i, /cypress/i, /jest/i, /vitest/i, /pytest/i],
    permissions: ['file:read', 'file:write', 'network:read'],
    riskLevel: 2,
    status: 'configuration-required',
  },
  {
    category: 'ai-media',
    patterns: [/figma/i, /image/i, /video/i, /audio/i, /runway/i, /replicate/i, /fal\.ai/i, /minimax/i, /hugging face/i, /remotion/i, /gsap/i],
    permissions: ['network:read', 'file:write'],
    riskLevel: 2,
    status: 'configuration-required',
  },
  {
    category: 'productivity-memory',
    patterns: [/notion/i, /memory/i, /linear/i, /task/i, /calendar/i, /meeting/i, /notebooklm/i, /obsidian/i, /product manager/i],
    permissions: ['memory:read', 'memory:write', 'network:read'],
    riskLevel: 2,
    status: 'configuration-required',
  },
  {
    category: 'security',
    patterns: [/security/i, /trail of bits/i, /audit/i, /auth/i, /oauth/i, /secret/i, /vulnerab/i, /compliance/i],
    permissions: ['file:read', 'network:read'],
    riskLevel: 2,
    status: 'configuration-required',
  },
];

const ignorePatterns = [
  /sponsor/i,
  /badge/i,
  /discord/i,
  /contributing/i,
  /license/i,
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function classify(name: string, description: string): Omit<ImportedSkill, 'id' | 'name' | 'sourceUrl' | 'description'> | null {
  const haystack = `${name} ${description}`;
  if (ignorePatterns.some((pattern) => pattern.test(haystack))) return null;
  const rule = categoryRules.find((candidate) => candidate.patterns.some((pattern) => pattern.test(haystack)));
  if (!rule) return null;
  return {
    category: rule.category,
    riskLevel: rule.riskLevel,
    permissions: rule.permissions,
    status: rule.status,
  };
}

function parseSkills(markdown: string): ImportedSkill[] {
  const skills: ImportedSkill[] = [];
  const seen = new Set<string>();
  const linkLine = /^-\s+\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s+-\s+(.+)$/;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = linkLine.exec(line);
    if (!match) continue;
    const [, name, sourceUrl, description] = match;
    const classification = classify(name, description);
    if (!classification) continue;
    const id = `awesome_${slugify(name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    skills.push({
      id,
      name,
      sourceUrl,
      description: description.replace(/<[^>]+>/g, '').slice(0, 500),
      ...classification,
    });
  }

  return skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Source README not found: ${sourcePath}`);
}

const importedAt = new Date().toISOString();
const skills = parseSkills(fs.readFileSync(sourcePath, 'utf8'));
const byCategory = skills.reduce<Record<string, number>>((acc, skill) => {
  acc[skill.category] = (acc[skill.category] ?? 0) + 1;
  return acc;
}, {});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({
  source: 'https://github.com/VoltAgent/awesome-agent-skills',
  importedAt,
  total: skills.length,
  byCategory,
  skills,
}, null, 2), 'utf8');

console.log(JSON.stringify({ importedAt, total: skills.length, byCategory, outputPath }, null, 2));
