# CLAUDE.md

## Commands

```bash
npm run dev       # vite dev server on :5173
npm test          # vitest run
npm run test:watch
npm run build     # tsc && vite build
```

## Local OBR testing

`npm run dev`, then add `http://localhost:5173/manifest.dev.json` as a custom
extension in Owlbear Rodeo. The dev manifest declares both the popover and the
background page.

## Architecture

Two entry points:

| Entry | File | Role |
|---|---|---|
| `index.html` | `src/main.ts` | Action popover. Renders the roster, sends roll requests. |
| `background.html` | `src/background.ts` | Always running. Owns the dicex round-trip and the `init` write. |

The split is not optional. dicex calls `OBR.action.open()` before every roll,
and OBR allows one action popover per extension, so our panel is unmounted
mid-roll. A pipeline in the popover would die before the result arrived.

Popover and background talk over `OBR.broadcast` with `destination: "LOCAL"`:
`internal-roll` carries `{ rolls: [{ itemId, bonus, mode }] }` (a single click
sends a one-element array, so bulk is not a special case), and `internal-status`
carries per-combatant progress that the popover renders only if it happens to
be open.

### Modules

| File | Responsibility |
|---|---|
| `constants.ts` | Extension id, channels, Forge keys |
| `types.ts` | Combatant, roll specs, Dice+ payload types |
| `session.ts` | Who am I, who is the GM |
| `roster.ts` | Sorting, PC/GM split, roll permission (pure) |
| `forge.ts` | Read roster from scene items, write `init` |
| `bonus.ts` | DEX modifier, override read/write/prune |
| `notation.ts` | Mode + bonus to dicex notation (pure) |
| `dicePlus.ts` | dicex client: correlate, time out, serialize |
| `background.ts` | Roll iteration, visibility, write-back |
| `main.ts` | Popover boot, subscriptions, event wiring |
| `ui-list.ts` | Roster rendering |
| `styles.ts`, `escape.ts` | CSS-in-JS, HTML escaping |

## Gotchas

- **`EXTENSION_ID` is load-bearing across repos.** dicex's
  `TRUSTED_ROLL_TARGET_SOURCES` matches it as a literal string. Rename it and
  every PC roll silently becomes hidden — the request still succeeds, the
  result still arrives, only visibility is wrong. `test/constants.test.ts`
  pins it.
- **Ownership is `createdUserId`.** OBR rewrites it on reassignment, so it
  means "current owner". Classify GM-controlled as
  `createdUserId === GM id`, never as "owner is a party member" —
  `getPlayers()` returns only *connected* players, so the latter hides PCs
  whose owner is offline.
- **`pruneOverrides` must receive every scene item id, not the roster.**
  `readRoster` filters to Forge's `on-list === true`, so passing the roster
  into `pruneOverrides` deletes saved bonuses for tokens that are merely off
  the initiative list but still in the scene — the normal state between
  encounters. `main.ts` prunes against `OBR.scene.items.getItems()` directly;
  do not swap in `readRoster`'s output, even though it looks like the more
  natural "current roster" to hand in. This was found and fixed once already
  (commit `52a2c53`) and is easy to reintroduce.
- **Escape everything.** Combatant names come from Forge metadata and go
  through `innerHTML`. Use `escapeHtml()`.
- **Never write a Forge key other than `init`.** Always a number, always via
  `updateItems` so the rest of the stat block merges through.
- **`Math.max(1, total)` on write is deliberate.** Forge reads `0` as
  unrolled; without the clamp a natural 1 with a negative modifier writes `0`
  and gets re-rolled by the next bulk roll.
- **One dicex roll at a time per client.** dicex keeps a single pending
  request in a module global. `dicePlus.ts` serializes. Cross-player
  concurrency needs nothing — requests are LOCAL and dicex ignores requests
  addressed to another player.
- **`Number("")` is `0`.** `dexModifier` guards the empty string explicitly,
  or a token with no DEX gets a `-5` modifier.
- **`refresh()` in `main.ts` is re-entrant.** It is triggered by several
  subscriptions, including one fired by our own `writeOverride`, so
  overlapping calls can resolve out of order. A monotonic sequence guard
  discards any call superseded by a newer one before it applies its result,
  and `combatants` / `model.view` are assigned together, after every await,
  so a click handler landing mid-refresh never sees them disagree.

## Deploy

Push to `main`. `.github/workflows/deploy.yml` runs `npm ci && npm test &&
npm run build` and publishes `dist/` to GitHub Pages.
