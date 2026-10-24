/**
 * Gathers one week of facts for the README's "Lately" section.
 *
 * Every outside response is treated as untrusted shape: a field that is
 * missing degrades to null instead of throwing, so one odd payload drops
 * one line from the README rather than failing the whole run.
 *
 * Writes lately/out/facts.json (read by the writer step, never committed: it holds
 * private PR titles) and assets/activity.svg (counts only). This repo is
 * public and so are its Actions logs, so nothing here prints a title, only
 * counts.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import config from './config.json'

type Product = (typeof config.products)[number]
type MergedPr = { repo: string; title: string; mergedAt: string }

const WEEKS = 12
const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const weekAgo = new Date(now.getTime() - 7 * DAY)
const sparkStart = new Date(now.getTime() - WEEKS * 7 * DAY)

/** present-day repos are mostly private; everything else is public. */
function tokenFor(repo: string): string | undefined {
  return repo.startsWith('present-day/')
    ? (process.env.LATELY_ORG_TOKEN ?? process.env.GITHUB_TOKEN)
    : process.env.GITHUB_TOKEN
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'josephdburdick-lately', ...headers } })
    if (!res.ok) {
      console.warn(`${new URL(url).host}: HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (error) {
    console.warn(`${new URL(url).host}: ${(error as Error).message}`)
    return null
  }
}

const BOTS = new Set(['dependabot', 'github-actions', 'renovate'])

type PrPage = {
  data?: {
    repository: {
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string }
        nodes: { title: string; mergedAt: string; updatedAt: string; author: { login: string } | null }[]
      }
    } | null
  }
}

/**
 * Merged PRs in one repo since `since`, newest first, bots left out: their
 * PRs are not what I've been up to.
 *
 * GraphQL rather than issue search: search answers a short burst with a
 * secondary-rate-limit 403, which silently truncated the history. Sorting
 * by UPDATED_AT is the closest order GraphQL offers to merge time, so paging
 * stops once a whole page was last touched before `since`.
 */
async function mergedPrs(repo: string, since: Date): Promise<MergedPr[]> {
  const [owner, name] = repo.split('/')
  const token = tokenFor(repo)
  const prs: MergedPr[] = []
  let after: string | null = null

  for (let page = 0; page < 10; page++) {
    let res: PrPage | null = null
    try {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'user-agent': 'josephdburdick-lately',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: `query($owner: String!, $name: String!, $after: String) {
            repository(owner: $owner, name: $name) {
              pullRequests(states: MERGED, first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
                pageInfo { hasNextPage endCursor }
                nodes { title mergedAt updatedAt author { login } }
              }
            }
          }`,
          variables: { owner, name, after },
        }),
      })
      res = response.ok ? ((await response.json()) as PrPage) : null
      if (!response.ok) console.warn(`graphql: HTTP ${response.status}`)
    } catch (error) {
      console.warn(`graphql: ${(error as Error).message}`)
    }

    const connection = res?.data?.repository?.pullRequests
    if (!connection) {
      // Says which repo, never what is in it; a missing grant shows up here.
      console.warn(`no access to ${repo}`)
      break
    }
    for (const pr of connection.nodes ?? []) {
      if (!pr?.mergedAt) continue
      if (pr.author && BOTS.has(pr.author.login)) continue
      if (new Date(pr.mergedAt) >= since) prs.push({ repo, title: pr.title, mergedAt: pr.mergedAt })
    }
    const oldest = connection.nodes?.at(-1)
    if (!connection.pageInfo?.hasNextPage || !oldest || new Date(oldest.updatedAt) < since) break
    after = connection.pageInfo.endCursor
  }
  return prs
}

function weeklyCounts(prs: MergedPr[]): number[] {
  const counts = Array.from({ length: WEEKS }, () => 0)
  for (const pr of prs) {
    const week = Math.floor((new Date(pr.mergedAt).getTime() - sparkStart.getTime()) / (7 * DAY))
    if (week >= 0 && week < WEEKS) counts[week]++
  }
  return counts
}

function productOf(repo: string): Product | undefined {
  return config.products.find((p) => p.repos.includes(repo))
}

async function packages() {
  return Promise.all(
    config.packages.map(async (name) => {
      const [downloads, meta] = await Promise.all([
        getJson<{ downloads: number }>(`https://api.npmjs.org/downloads/point/last-week/${name}`),
        getJson<{ 'dist-tags': { latest: string }; time: Record<string, string> }>(
          `https://registry.npmjs.org/${name}`,
        ),
      ])
      const version = meta?.['dist-tags']?.latest ?? null
      return {
        name,
        url: `https://www.npmjs.com/package/${name}`,
        version,
        publishedAt: version ? (meta?.time?.[version] ?? null) : null,
        weeklyDownloads: typeof downloads?.downloads === 'number' ? downloads.downloads : null,
      }
    }),
  )
}

async function bluesky() {
  const data = await getJson<{
    feed: { post: { uri: string; indexedAt: string; record: { text?: string } } }[]
  }>(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${config.bluesky}&limit=5&filter=posts_no_replies`,
  )
  const post = data?.feed?.find((f) => f?.post?.record?.text?.trim())?.post
  if (!post) return null
  const id = post.uri.split('/').pop()
  return {
    text: post.record.text!.trim(),
    date: post.indexedAt,
    url: `https://bsky.app/profile/${config.bluesky}/post/${id}`,
  }
}

async function lastfm() {
  const key = process.env.LASTFM_API_KEY
  const user = process.env.LASTFM_USER
  if (!key || !user) return null
  const base = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${key}&user=${encodeURIComponent(user)}`
  const [recent, top] = await Promise.all([
    getJson<{ recenttracks: { track: { name: string; url: string; artist: { '#text': string } }[] } }>(
      `${base}&method=user.getrecenttracks&limit=1`,
    ),
    getJson<{ topartists: { artist: { name: string; url: string; playcount: string }[] } }>(
      `${base}&method=user.gettopartists&period=7day&limit=3`,
    ),
  ])
  const track = recent?.recenttracks?.track?.[0]
  return {
    profile: `https://www.last.fm/user/${encodeURIComponent(user)}`,
    lastTrack:
      track?.name && track.url
        ? { title: track.name, artist: track.artist?.['#text'] ?? '', url: track.url }
        : null,
    topArtists: (top?.topartists?.artist ?? [])
      .filter((a) => a?.name && a.url)
      .map((a) => ({ name: a.name, url: a.url })),
  }
}

/** Merged PRs per week as bars. Counts only, so private work stays private. */
function sparkline(counts: number[]): string {
  const max = Math.max(1, ...counts)
  const [w, h, gap] = [24, 48, 6]
  const bars = counts
    .map((c, i) => {
      const bh = Math.max(2, Math.round((c / max) * h))
      return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="3" fill="#0891b2" opacity="${i === WEEKS - 1 ? 1 : 0.55}"><title>${c} merged</title></rect>`
    })
    .join('')
  const width = WEEKS * (w + gap) - gap
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="Merged pull requests per week, last ${WEEKS} weeks: ${counts.join(', ')}">${bars}</svg>\n`
}

const [history, pkgs, post, listening] = await Promise.all([
  Promise.all(config.products.flatMap((p) => p.repos).map((repo) => mergedPrs(repo, sparkStart))),
  packages(),
  bluesky(),
  lastfm(),
])
const twelveWeeks = history.flat()
const thisWeek = twelveWeeks.filter((pr) => new Date(pr.mergedAt) >= weekAgo)
const counts = weeklyCounts(twelveWeeks)

const facts = {
  weekOf: weekAgo.toISOString().slice(0, 10),
  generatedAt: now.toISOString(),
  products: config.products
    .map((p) => ({
      name: p.name,
      emoji: p.emoji,
      url: p.url,
      mergedThisWeek: thisWeek.filter((pr) => productOf(pr.repo) === p).map((pr) => pr.title),
    }))
    .filter((p) => p.mergedThisWeek.length > 0),
  totalMergedThisWeek: thisWeek.length,
  packages: pkgs,
  bluesky: post,
  listening,
}

mkdirSync('lately/out', { recursive: true })
mkdirSync('assets', { recursive: true })
writeFileSync('lately/out/facts.json', `${JSON.stringify(facts, null, 2)}\n`)
writeFileSync('assets/activity.svg', sparkline(counts))

// Counts only: this log is public.
console.log(
  `merged this week: ${thisWeek.length} across ${facts.products.length} products; ` +
    `weekly: ${counts.join(',')}; packages: ${pkgs.length}; ` +
    `bluesky: ${post ? 'yes' : 'no'}; last.fm: ${listening ? 'yes' : 'no'}`,
)
