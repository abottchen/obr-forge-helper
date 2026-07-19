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
  and `handleChange`) takes the `CloseReason` it was invoked under (below)
  and threads it through every `closeInitEditor` call it makes, so an
  Enter-driven commit (`"keyboard"`) always closes immediately and a
  `change`-driven one (`"blur"`) stays subject to the `pointerDownInFlight`
  gate — this is why the reject paths (bad input, permission lost since the
  editor opened) close on Enter too instead of only self-healing on success.
  `commitInit` also guards itself by checking `model.editingInit` still names
  the row before writing. An ordinary Enter never needs that guard — its own
  immediate close detaches the input before any trailing event can reach a
  handler — but a `change`-driven commit reached while `pointerDownInFlight`
  is true stays gated and leaves the same editor attached and focused, and
  that guard is what stops a second commit-triggering event (another
  `change`, or an Enter reaching it before the mouse button is released)
  from writing a second time.
- **The init badge renders on every row, editable or not.** The permission
  check lives in the click handler in `main.ts`, and `renderRow`
  independently refuses to render an editor for a row whose `allowed` is
  false. Both are needed: without the handler-side check, a row the viewer
  cannot touch would enter edit mode with no editor rendered to close it.
- **A roll discards, not commits, an editor open on the row it rolls.**
  `requestRolls` closes `editingInit` for any row in its own batch — scoped
  to that batch's itemIds, not "any open editor", so a bulk roll never
  touches an editor open on an untouched row. Discard rather than commit:
  the roll is about to overwrite the same `init` key regardless, and
  committing here would race that write. Closes via
  `closeInitEditor("keyboard")`, not `"blur"` — this close is never the tail
  of a mousedown/click pair still in flight, and gating it on
  `pointerDownInFlight` would risk suppressing the render over some
  unrelated pointer interaction elsewhere in the panel, stranding the editor
  on a row Forge is about to overwrite. The `INTERNAL_STATUS_CHANNEL`
  handler needs no matching check: this clear plus `handleClick`'s existing
  refusal to open an editor on an already-`"rolling"` row keep `editingInit`
  and a `"rolling"` status mutually exclusive for any roll this popover
  instance itself started.
- **`pointerDownInFlight` guards `closeInitEditor` specifically — it does not
  make renders in general safe during a pointer interaction.** `renderList`
  rebuilds all of `root` via `innerHTML`. A synchronous re-render triggered
  by a blur-family event (`focusout`, or a modified blur's `change`) can land
  between `mousedown` and `click` and destroy the node the browser captured
  as the pending click's target, silently swallowing that click — clicking
  from one open editor onto another row's badge did nothing but close the
  first. The flag is set on `mousedown` on `root`; while it is true,
  `closeInitEditor("blur")` clears state without rendering, leaving the DOM
  intact so the click still lands. `closeInitEditor("keyboard")` — Escape's
  reason, and the one `commitInit` uses for an Enter-driven commit too (see
  the "Enter commits a manual init edit" gotcha above) — never checks the
  flag. Losing the click that keypress is itself part of is harmless in the
  common case: the mousedown that set the flag is almost always on the very
  editor being closed, whose pending click had nowhere else to go. (A drag
  that leaves the editor before the key lands could in principle still strand
  a click meant for another control — accepted as a rare edge case rather
  than worth gating Escape/Enter on the flag too.) Every early return in
  `handleClick`'s `.fh-init` branch that can observe a stale editor calls
  `repaintStaleEditor()` first, and a click matching no branch at all falls
  into the same repaint at the end of `handleClick`. The flag is cleared on
  both `mouseup` and `dragend` (a
  native drag stops mouse events entirely), both registered on **`window`**,
  not `root`, because the release — or the drag grabbing the pointer — can
  happen outside the panel; an earlier version cleared it only in
  `handleClick` and could wedge true for the rest of the session, after which
  any blur-family close — an ordinary click-away, or a modified edit
  committed via `change` — stopped visibly closing the editor, though Escape
  and Enter kept working since neither ever checked the flag. This reduces
  the click-swallow class, it does not eliminate it:
  `handleChange`'s non-numeric-rejection path and `refresh()` both call
  `renderList` with no flag check at all, so a `mousedown`→`click` window
  landing across either of those can still swallow a click. Fixing that
  would mean not rebuilding the whole panel on every render, a larger change
  than this flag.
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
