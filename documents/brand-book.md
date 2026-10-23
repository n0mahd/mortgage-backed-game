# Mortgage Backed Monopoly — Brand Book

## Brand Identity & Philosophy

### Game Name
**Mortgage Backed Monopoly**

### Tagline
*"If they did it in 2008, it's fair game."*

### Positioning
A satirical financial board game that lets players recreate — and profit from — the mechanics of the 2008 housing crisis. Securitization, overleveraging, collateral fraud, and regulatory capture are not bugs; they're features.

### The "Green = Money" Thematic Rationale

Green was the obvious choice in retrospect. Dollar bills are green. Monopoly houses are green. "Greenbacks" is what they called American currency. The 2008 crisis was, at its core, about the relentless pursuit of green — and the catastrophic consequences when the music stopped.

The color palette leans into this symbolism hard:
- **Deep forest greens** signal authority and old money — the kind that writes the rules
- **Bright emerald and jade** are the interactive, clickable world — money in motion
- **Gold accents** are Wall Street excess — bonuses, fees, and premium moments
- **White** is the clean surface everything pretends to be
- **Red** is reserved for bankruptcy and ruin — the only honest color in the room

The old purple/blue gradient read as "generic fintech SaaS." This palette reads as *money*.

### Brand Personality
- **Irreverent** — never earnest about finance, always slightly winking
- **Satirical** — the mechanics are a joke about real events that weren't funny
- **Sharp** — clear, direct, no filler; like a well-structured CDO pitch deck (that's actually a ticking bomb)
- **Confident** — doesn't explain the joke, trusts the player to get it

---

## Color

Green is money: forest green carries authority, emerald marks the next move, mint marks alternatives. Gold
appears sparingly for costs and premium moments. Red appears only for money at risk (bankruptcy, rent due).
Never use the old purple tones.

The colors themselves are tokens in `src/css/tokens.css`, described in `documents/design-system.md`.

---

## Typography

Superseded on 2026-10-21 by the "Term Sheet" design system. Full rules: `documents/design-system.md`.

- **Besley** (self-hosted, OFL) for money, room codes, and screen titles: a Clarendon slab like the
  numerals on a bond certificate. Proportional lining figures only; its tabular zero is broken.
- **System UI** (SF Pro on iOS, Roboto on Android) for all other text, so the app feels native.
- Sentence case. No all-caps labels. Gradient text is retired.

---

## Component Rules

Superseded by `documents/design-system.md`, which defines buttons, the turn ticket, the action dock,
sheets, deed rows, and badges against the tokens in `src/css/tokens.css`. The gradient buttons
described in earlier versions of this book are retired; buttons are flat fills, and color carries
meaning: emerald for the next move, mint for alternatives, gold for costs and premium moments, red
for money at risk.

---

## Voice & Tone

### Core Voice
The game voice is a financial professional who knows the whole thing is a joke but maintains a straight face just long enough to make you uncomfortable.

### Principles
- **Jargon as punchline** — use finance terms correctly, but in absurd contexts
- **Understatement** — "a minor liquidity event" for bankruptcy
- **No hand-holding** — trust that players understand what they've signed up for
- **Never earnest** — sincerity would ruin it

### Examples

| Situation | Bad | Good |
|---|---|---|
| Player goes bankrupt | "You lost!" | "Liquidity event. Positions unwound." |
| Rent collection | "Pay $200 rent" | "Market rate. Non-negotiable." |
| Chance card | "Draw a chance card" | "The market has spoken." |
| Game over | "Congratulations, you won!" | "Last one standing. Probably fraud involved." |

---

## Icons & Imagery

### App icon
The project mark is a house "backed" by a stack of banknotes: gold roof, note-white house, mint notes on
a forest-green field. It is the Home Screen icon, the favicon, the install-manifest icon and the turn-alert
icon, under the name "Mortgage Backed".

- Masters: `src/assets/icon.svg` (full detail, full-bleed square; platforms round the corners) and
  `src/assets/favicon.svg` (simplified for 16–32px tabs).
- The PNGs in `src/assets/` are generated from those SVGs with `node scripts/renderIcons.js`; edit the SVG,
  re-run it, and bump the `?v=` on the icon links in every page, `manifest.webmanifest` and `sw.js`.

### Icons
Interface icons (tab bar, back, device transfer) are inline SVG line icons at a 1.8px stroke. Emoji are
no longer used in buttons or labels, because they render differently on every phone. The list below
survives only for marketing copy.

Key emoji usage:
- 🏠 — standard property / house
- 🏦 — bank / financial institution
- 💰 — cash / payment
- 📈 — market / IPO
- 💀 — bankruptcy
- 🎲 — dice / chance
- 🚂 — railroad / utility

### Board Square Colors
Board color bands preserve game clarity over brand purity — the Monopoly color system (brown, light blue, pink, orange, red, yellow, green, dark blue) remains intact. Brand greens do not replace board property colors.

---

## Do's and Don'ts

### DO
- ✅ Use dark greens (`#1B4332`, `#2D6A4F`) for authority and structure
- ✅ Use mid greens (`#40916C`, `#52B788`) for interactive elements
- ✅ Use light greens (`#D8F3DC`, `#F0FBF4`) for backgrounds and surfaces
- ✅ Use gold sparingly for premium / warning moments
- ✅ Keep red (`#DC2626`, `#e74c3c`) for all danger / bankruptcy states
- ✅ Use `#0D1F2D` (ink) instead of pure `#000000` for primary text
- ✅ Maintain sufficient contrast (WCAG AA minimum)

### DON'T
- ❌ Use purple (`#667eea`, `#764ba2`) anywhere — it's gone
- ❌ Use green for danger states — red is always danger
- ❌ Use pure black (`#000000`) for body text — use `--color-ink`
- ❌ Use gold as a primary color — it's an accent
- ❌ Stack multiple green gradients in the same visual region
- ❌ Use light greens for text — contrast will fail
- ❌ Introduce new brand colors without updating this document

---

## Rationale: Why Green Beats Purple

The previous purple/blue gradient (`#667eea → #764ba2`) is the default palette for approximately 40% of fintech dashboards. It communicates "SaaS product" not "satirical financial game."

Green communicates:
1. **Money** — culturally universal in American context ("the green," "greenbacks")
2. **Greed** — the thematic engine of the 2008 crisis
3. **Go** — Monopoly's most important square
4. **Growth** — what everyone was pretending was happening in 2006-2007
5. **Monopoly itself** — the game's houses and park squares have always been green

The satirical edge comes from using the color of prosperity to represent a game about its collapse.
