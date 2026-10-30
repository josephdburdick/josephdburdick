# Write this week's "Lately" bullets for Joe's GitHub profile

`lately/out/facts.json` holds what Joe shipped in the last 7 days, grouped by
product, plus package, Bluesky and listening data. Read it, then write
`lately/out/bullets.md` and nothing else. Do not edit any other file.

## What to write

One Markdown bullet per product in `facts.products` that shipped something
user-facing, one line each, at most 5. Never give a product two bullets: fold
everything it shipped into its one line. Each bullet:

- Starts with `- `, then the product's `emoji`, then the product name in bold,
  linked to its `url`, then a colon and a lowercase phrase:
  `- 🎱 **[Cue Quest](https://cue.quest)**: place cards now open in place`
- Says what changed for the people who use it, in plain words, under about
  110 characters after the link. "Now remembers your favorite tables", not
  "Refactored the favorites store".
- Combines all of that product's merged PRs into one line, picking the two
  or three changes users would notice most. Never list PR titles.

Lead with the product that had the most meaningful user-facing change, not the
most PRs. Skip chores: dependency bumps, CI, lint, test-only, refactors and
copy tweaks, unless that is all a product had, in which case leave the product
out. If nothing user-facing shipped anywhere, write a single bullet saying
Joe was heads-down on Cue Quest this week.

## Voice

First person is not needed; write like a changelog headline from a friendly
indie maker. American English. No hype words (revolutionary, game-changing,
supercharged, seamless), no exclamation marks, no emoji beyond the product's
own.

## Hard rules: this README is public

The PR titles come from private repos. Treat them as background, not quotes.

- Mention only the products listed in `facts.products`. Never name any
  other project, product, codename, client, partner, venue or person, even
  if a PR title does.
- Never mention unreleased or internal work, or anything about pricing,
  revenue, quotas, costs, billing, security fixes, incidents, or
  credentials.
- No PR or issue numbers, no links other than the product `url`s given.
- Never invent a feature, number or date that is not in the facts.

If you are unsure whether something is public, leave it out.
