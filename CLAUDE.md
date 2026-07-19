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
| `forge.ts` | Read roster from scene items, write `init` (rolled or manual) |
| `bonus.ts` | DEX modifier, override read/write/prune (OBR *room* metadata) |
| `notation.ts` | Mode + bonus to dicex notation (pure) |
| `dicePlus.ts` | dicex client: correlate, time out, serialize |
| `background.ts` | Roll iteration, visibility, write-back |
| `main.ts` | Popover boot, subscriptions, event wiring, including the init-editor state machine |
| `ui-list.ts` | Roster rendering, including the init editor and its focus restoration |
| `styles.ts`, `escape.ts` | CSS-in-JS (palette sampled from Forge), HTML escaping |

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
  and is easy to reintroduce.
- **Escape everything.** Combatant names come from Forge metadata and go
  through `innerHTML`. Use `escapeHtml()`.
- **Never write a Forge key other than `init`.** Always a number, always via
  `updateItems` so the rest of the stat block merges through.
- **`writeInit` clamps, `setInit` does not.** Forge reads `0` as unrolled, so
  the roll path (`writeInit`) floors at 1 — without it a natural 1 with a
  negative modifier writes `0` and gets re-rolled by the next bulk roll.
  Manual entry calls `setInit` directly instead, because clearing a value
  *means* writing `0`. Do not collapse the two back together.
- **Enter commits a manual init edit via a dedicated `keydown` handler, not
  the `change` event alone.** The browser only fires `change` on Enter when
  it considers the value modified, so a commit path that waited on `change`
  would silently write nothing when a reopened badge is retyped with the
  number it already showed. `commitInit` (called from both `handleKeyDown`
  and `handleChange`) guards itself by checking `model.editingInit` still
  names the row before writing. An ordinary Enter never needs that guard —
  its own re-render detaches the input before the trailing `change`/
  `focusout` can reach a handler — but a mousedown that holds
  `pointerDownInFlight` true (below) can leave the same editor attached and
  focused for a second Enter to reach `commitInit` again, and that guard is
  what stops the second write.
- **The init badge renders on every row, editable or not.** The permission
  check lives in the click handler in `main.ts`, and `renderRow`
  independently refuses to render an editor for a row whose `allowed` is
  false. Both are needed: without the handler-side check, a row the viewer
  cannot touch would enter edit mode with no editor rendered to close it.
- **`pointerDownInFlight` — the least guessable trap here.** `renderList`
  rebuilds all of `root` via `innerHTML`. A synchronous re-render triggered
  by a blur-family event (`focusout`, or a modified blur's `change`) can land
  between `mousedown` and `click` and destroy the node the browser captured
  as the pending click's target, silently swallowing that click — clicking
  from one open editor onto another row's badge did nothing but close the
  first. The flag is set on `mousedown` on `root`; while it is true,
  `closeInitEditor` clears state without rendering, leaving the DOM intact so
  the click still lands, and a fallback at the end of `handleClick` repaints
  if the click matched no branch — every branch of `handleClick` must
  `return`, or it falls through into that fallback. The flag is cleared on
  `mouseup` registered on **`window`**, not `root`, because the release can
  happen outside the panel; an earlier version cleared it only in
  `handleClick` and could wedge true for the rest of the session, after which
  Escape stopped visibly closing the editor.
- **The negative-init clamp branches on `parsed`, not the truncated value.**
  `Math.trunc(-0.5)` is `-0`, and `-0 < 0` is `false`, so testing the
  truncated value would let everything in `(-1, 0)` through as `-0` — which
  Forge reads as unrolled, silently clearing the row instead of clamping to
  1. `Math.max(1, truncated)` is not the fix either: it clamps the legitimate
  `0`-means-clear case up to 1 and breaks clearing.
- **One dicex roll at a time per client.** dicex keeps a single pending
  request in a module global. `dicePlus.ts` serializes. Cross-player
  concurrency needs nothing — requests are LOCAL and dicex ignores requests
  addressed to another player.
- **Forge's DEX key is `Z018`.** `F_DEX` is `com.battle-system.forge/Z018` —
  an opaque Forge stat id, not a placeholder. The value is a string on some
  tokens and a number on others, which is why `dexModifier` takes `unknown`.
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
