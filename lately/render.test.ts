import { describe, expect, it } from 'bun:test'

import { type DenyList, checkBullets, denyListFromEnv, renderSection, replaceSection } from './render'

/** Made-up names: the real list is a secret, and tests here are public. */
const deny: DenyList = { i: ['\\bzephyr\\b', 'acme'], cs: ['\\bWidget\\b'] }

const good = [
  '- 🎱 **[Cue Quest](https://cue.quest)**: going native with an iOS and Android shell',
  '- ⏱️ **[Cue Quest Shot Clock](https://shotclock.cue.quest)**: v1 is headed to the App Store',
].join('\n')

const facts = {
  weekOf: '2026-10-17T00:00:00.000Z',
  generatedAt: '2026-10-24T13:00:00.000Z',
  packages: [
    { name: '@present-day/drawer', url: 'https://www.npmjs.com/package/@present-day/drawer', version: '2.4.0', weeklyDownloads: 1550 },
    { name: '@present-day/gone', url: 'https://www.npmjs.com/package/@present-day/gone', version: null, weeklyDownloads: null },
  ],
  bluesky: { text: 'Hello *World* 👋', date: '2026-10-14T12:00:00.000Z', url: 'https://bsky.app/profile/j0e.me/post/abc' },
  listening: null,
}

describe('checkBullets', () => {
  it('passes product bullets that link only to product URLs', () => {
    expect(checkBullets(good, deny)).toEqual([])
  })

  it.each([
    ['a private name', '- 🎱 **[Cue Quest](https://cue.quest)**: wired up the Zephyr demo'],
    ['a case-sensitive name', '- 🎱 **[Cue Quest](https://cue.quest)**: now reads Widget queues'],
    ['a PR number', '- 🎱 **[Cue Quest](https://cue.quest)**: shipped #1980'],
    ['a public-rule topic', '- 🎱 **[Cue Quest](https://cue.quest)**: new pricing page'],
    ['a link outside the products', '- 🎱 **[Cue Quest](https://github.com/present-day/app.cue.quest)**: native'],
    ['a bare URL', '- 🎱 **[Cue Quest](https://cue.quest)**: see https://example.com'],
    ['raw HTML', '- 🎱 **[Cue Quest](https://cue.quest)**: <img src="x">'],
  ])('rejects %s', (_, line) => {
    expect(checkBullets(line, deny).length).toBeGreaterThan(0)
  })

  it('matches case-sensitive rules exactly', () => {
    expect(checkBullets('- ⏱️ **[Cue Quest Shot Clock](https://shotclock.cue.quest)**: a widget for scores', deny)).toEqual([])
  })

  it('names neither the bullet text nor the pattern in its problems', () => {
    const problems = checkBullets('- secret zephyr thing #12', deny).join(' ')
    expect(problems).not.toContain('zephyr')
    expect(problems).toContain('deny rule')
  })

  it('rejects two bullets for the same product', () => {
    const twice = [good.split('\n')[0], '- 🎱 **[Cue Quest](https://cue.quest)**: share cards in more scripts'].join('\n')
    expect(checkBullets(twice, deny)).toEqual(['line 2: same product as line 1'])
  })

  it('rejects an empty or overlong list', () => {
    expect(checkBullets('', deny).length).toBeGreaterThan(0)
    expect(checkBullets(Array(6).fill(good.split('\n')[0]).join('\n'), deny).length).toBeGreaterThan(0)
  })
})

describe('denyListFromEnv', () => {
  it('is null when unset, so the run stops instead of checking weakly', () => {
    expect(denyListFromEnv('')).toBeNull()
    expect(denyListFromEnv(undefined)).toBeNull()
  })

  it('reads both lists from JSON', () => {
    expect(denyListFromEnv('{"i":["a"],"cs":["B"]}')).toEqual({ i: ['a'], cs: ['B'] })
  })
})

describe('renderSection', () => {
  const section = renderSection(facts, good)

  it('wraps everything in the markers', () => {
    expect(section.startsWith('<!-- LATELY:START -->')).toBe(true)
    expect(section.endsWith('<!-- LATELY:END -->')).toBe(true)
  })

  it('lists only published packages, with downloads', () => {
    expect(section).toContain('[`drawer`](https://www.npmjs.com/package/@present-day/drawer) 2.4.0 · 1,550/wk')
    expect(section).not.toContain('gone')
  })

  it('escapes Markdown in the Bluesky post', () => {
    expect(section).toContain('> Hello \\*World\\* 👋')
  })

  it('leaves out the listening line without Last.fm data', () => {
    expect(section).not.toContain('On repeat')
  })
})

describe('replaceSection', () => {
  it('replaces only what sits between the markers', () => {
    const readme = 'intro\n<!-- LATELY:START -->\nold\n<!-- LATELY:END -->\nbadge\n'
    expect(replaceSection(readme, '<!-- LATELY:START -->new<!-- LATELY:END -->')).toBe(
      'intro\n<!-- LATELY:START -->new<!-- LATELY:END -->\nbadge\n',
    )
  })

  it('refuses a README without markers', () => {
    expect(() => replaceSection('no markers', 'x')).toThrow()
  })
})
