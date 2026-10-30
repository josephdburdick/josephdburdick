/**
 * Builds the "Lately" section from facts.json and the drafted bullets, and
 * writes it between the README's LATELY markers.
 *
 * Only the bullets are drafted; everything else here is deterministic.
 * The bullets are checked before anything is written: this README is public
 * and the facts came partly from private repos, so a bullet that names an
 * internal project, cites a PR, or links anywhere unexpected fails the run
 * rather than reaching a pull request.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import config from './config.json'

const START = '<!-- LATELY:START -->'
const END = '<!-- LATELY:END -->'

type Facts = {
  weekOf: string
  generatedAt: string
  packages: {
    name: string
    url: string
    version: string | null
    weeklyDownloads: number | null
  }[]
  bluesky: { text: string; date: string; url: string } | null
  listening: {
    profile: string
    lastTrack: { title: string; artist: string; url: string } | null
    topArtists: { name: string; url: string }[]
  } | null
}

/**
 * Words a bullet must never contain, as regex sources: `i` is matched
 * case-insensitively, `cs` exactly.
 *
 * The real list names private projects, so it lives in the
 * LATELY_NEVER_MENTION secret, not in this public repo. A list kept here to
 * stop leaks would itself be the leak.
 */
export type DenyList = { i: string[]; cs: string[] }

/** Rules that name nothing private, so they can live in the open. */
const PUBLIC_DENY: DenyList = {
  i: [
    '#\\d+',
    '\\b(pricing|revenue|quota|billing|invoice|incident|outage|credential|password|secret)s?\\b',
  ],
  cs: [],
}

export function denyListFromEnv(raw = process.env.LATELY_NEVER_MENTION): DenyList | null {
  if (!raw?.trim()) return null
  const parsed = JSON.parse(raw) as Partial<DenyList>
  return { i: parsed.i ?? [], cs: parsed.cs ?? [] }
}

export function checkBullets(text: string, deny: DenyList): string[] {
  const problems: string[] = []
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 1 || lines.length > 5) problems.push(`expected 1–5 bullets, got ${lines.length}`)
  const allowedUrls = new Set(config.products.map((p) => p.url))
  const seenProducts = new Map<string, number>()
  const rules = [
    ...[...PUBLIC_DENY.i, ...deny.i].map((source) => new RegExp(source, 'i')),
    ...[...PUBLIC_DENY.cs, ...deny.cs].map((source) => new RegExp(source)),
  ]

  // Problems say which line and which rule number, never the text or the
  // pattern: the log is public, and the patterns are the private list.
  lines.forEach((line, index) => {
    const n = `line ${index + 1}`
    if (!line.startsWith('- ')) problems.push(`${n}: not a bullet`)
    if (line.length > 220) problems.push(`${n}: too long (${line.length})`)
    // Raw HTML can carry links and images the URL checks below never see.
    if (line.includes('<')) problems.push(`${n}: contains HTML`)
    for (const [, url] of line.matchAll(/\]\(([^)]+)\)/g)) {
      if (!allowedUrls.has(url)) problems.push(`${n}: link outside the product URLs`)
    }
    // One bullet per product: a second one for the same product reads as a
    // changelog, not a summary.
    const product = line.match(/\]\(([^)]+)\)/)?.[1]
    if (product && allowedUrls.has(product)) {
      const first = seenProducts.get(product)
      if (first !== undefined) problems.push(`${n}: same product as line ${first}`)
      else seenProducts.set(product, index + 1)
    }
    // GitHub autolinks bare URLs, so every URL in the line counts, not only
    // Markdown link targets.
    for (const [url] of line.matchAll(/https?:\/\/[^\s)\]>]+/g)) {
      if (!allowedUrls.has(url)) problems.push(`${n}: URL outside the product URLs`)
    }
    rules.forEach((rule, r) => {
      if (rule.test(line)) problems.push(`${n}: matches deny rule ${r + 1}`)
    })
  })
  return problems
}

/** Markdown-safe single line, cut at a word boundary. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').replace(/([[\]*_`<>|])/g, '\\$1').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max).replace(/\s+\S*$/, '')}…`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function renderSection(facts: Facts, bullets: string): string {
  const parts: string[] = [
    START,
    `### 🛠️ Lately <sub>week of ${formatDate(facts.weekOf)}</sub>`,
    '',
    bullets.trim(),
    '',
    '<p><img src="assets/activity.svg" alt="Merged pull requests per week across my projects, last 12 weeks" /><br /><sub>Merged pull requests per week, last 12 weeks</sub></p>',
  ]

  const pkgs = facts.packages
    .filter((p) => p.version)
    .sort((a, b) => (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0))
  if (pkgs.length) {
    parts.push(
      '',
      `**📦 On npm:** ${pkgs
        .map(
          (p) =>
            `[\`${p.name.replace('@present-day/', '')}\`](${p.url}) ${p.version}` +
            (p.weeklyDownloads != null ? ` · ${p.weeklyDownloads.toLocaleString('en-US')}/wk` : ''),
        )
        .join(' &nbsp;·&nbsp; ')}`,
    )
  }

  if (facts.bluesky) {
    parts.push(
      '',
      `**🦋 Latest post** <sub>[${formatDate(facts.bluesky.date)}](${facts.bluesky.url})</sub>`,
      `> ${clip(facts.bluesky.text, 200)}`,
    )
  }

  const listening = facts.listening
  if (listening && (listening.lastTrack || listening.topArtists.length)) {
    const bits: string[] = []
    if (listening.lastTrack) {
      bits.push(
        `[${clip(listening.lastTrack.title, 60)}](${listening.lastTrack.url}) by ${clip(listening.lastTrack.artist, 40)}`,
      )
    }
    if (listening.topArtists.length) {
      bits.push(
        `this week: ${listening.topArtists.map((a) => `[${clip(a.name, 40)}](${a.url})`).join(', ')}`,
      )
    }
    parts.push('', `**🎧 [On repeat](${listening.profile}):** ${bits.join(' · ')}`)
  }

  parts.push(
    '',
    '<sub>Updated weekly by a GitHub Actions automation.</sub>',
    END,
  )
  return parts.join('\n')
}

export function replaceSection(readme: string, section: string): string {
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1 || end < start) throw new Error('README is missing the LATELY markers')
  return readme.slice(0, start) + section + readme.slice(end + END.length)
}

if (import.meta.main) {
  const bulletsPath = 'lately/out/bullets.md'
  if (!existsSync(bulletsPath)) {
    console.error('The writer step did not produce lately/out/bullets.md')
    process.exit(1)
  }
  const deny = denyListFromEnv()
  if (!deny) {
    // Without the private list the check is too weak to trust; stop rather
    // than publish something it should have caught.
    console.error('LATELY_NEVER_MENTION is not set')
    process.exit(1)
  }
  const bullets = readFileSync(bulletsPath, 'utf8')
  const problems = checkBullets(bullets, deny)
  if (problems.length) {
    console.error(`Bullets failed the public-README check:\n${problems.map((p) => `- ${p}`).join('\n')}`)
    process.exit(1)
  }
  const facts = JSON.parse(readFileSync('lately/out/facts.json', 'utf8')) as Facts
  writeFileSync('README.md', replaceSection(readFileSync('README.md', 'utf8'), renderSection(facts, bullets)))
  console.log('README.md updated')
}
