# Forge Helper — Initiative Entry for Owlbear Rodeo

**Status:** Approved
**Date:** 2026-07-18
**Author:** abottchen

## Purpose

Forge's built-in initiative entry is hostile enough that most players at the table
refuse to use it. Left-clicking the initiative field rolls immediately, bypassing the
dice system entirely; right-clicking requires navigating a secondary menu to choose
manual entry and only then editing the box.

`obr-forge-helper` replaces that interaction with a flat list of the current Forge
combatants, each row carrying a bonus field, an advantage toggle, and a single Roll
button. Rolls route through dicex via the Dice+ protocol so they run on the real 3D
dice, and results are written back to Forge's own metadata so the existing Forge UI
picks them up with no further action.

This is a sibling of `obr-inv` and `obr-quick-store` and reuses their patterns (Vite +
vanilla TS, CSS-in-JS, namespaced room-metadata keys, role-aware UI, GitHub Pages
deploy via Actions). It is a separate codebase, not a fork.

## Goals

- One click to roll initiative for a combatant, with an editable bonus and
  normal/advantage/disadvantage selection.
- Rolls execute through dicex (3D tray, roll log, Rumble) rather than Forge's silent
  internal roller.
- Results land in `com.battle-system.forge/init` so Forge displays them natively.
- Players see and roll their own tokens; the GM sees and rolls everything.
- Correct behavior when the popover is closed mid-roll, when an owner is offline, and
  when dicex is absent.

## Non-goals

- Adding or removing combatants from Forge's list (`on-list`). Forge owns that.
- Advancing turns or rounds. Forge owns that.
- Editing any Forge field other than `init`.
- Controlling initiative tie-breaking. Forge sorts internally and exposes no
  tiebreak field to write.
- Making Dice+ rolls publicly visible. See "Known limitations".

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Roll controls | Per-row bonus, mode toggle, Roll button | Directness is the entire point; the current UI fails by being indirect |
| Advantage control | Three-way segmented toggle | Two checkboxes admit a both-checked state needing an arbitrary tiebreak rule |
| Bonus source | Prefill from hardcoded DEX modifier, persist user overrides | Matches Forge's math; overrides cover Bless, feats, homebrew, and any non-5e setup |
| Override storage | Room metadata, one key per token, in our namespace | Follows obr-inv; survives devices; visible to GM |
| Ownership signal | Item `createdUserId` | Live and GM-reassignable; `in-party` means party-side, not player-owned |
| Role split | GM-controlled iff `createdUserId === GM's id` | Inverted test keeps offline-owner PCs visible (see "Ownership") |
| Roll scope | Own tokens only; GM rolls anything | Never hits `CHARACTER_OWNER_ONLY`; GM covers absent players |
| Roll pipeline location | Background page | dicex's `OBR.action.open()` unmounts our popover mid-roll |
| Bulk roll | GM-only button, unrolled GM tokens, serialized | Ports `roll_init.py`'s filter; one sidebar round trip instead of one per monster |
| Roll visibility | PC tokens `"everyone"`, GM tokens `"gm_only"` | Hides the monster's modifier, not its result; keyed per token so absent-player rolls stay public |

## Architecture

Two contexts, both declared in the manifest.

**`background.html` → `src/background.ts`** — always running in every connected
client. Owns the dicex round-trip and the `init` write.

**`index.html` → `src/main.ts`** — the action popover. Renders the roster and, on Roll,
fires a request at its own background page.

The split is forced by dicex: `relayRollRequest()` calls `await OBR.action.open()`
before every roll, and `OBR.action` is a single popover per extension. Hitting Roll
therefore hands the sidebar to the dice tray and unmounts our popover iframe. A
listener living in the popover would die before the result arrived and `init` would
never be written. dicex declares `background_url` for exactly this reason.

Popover to background is `OBR.broadcast` with `destination: "LOCAL"` on
`com.abottchen.obr-forge-helper/internal-roll`, mirroring dicex's own
`rodeo.owlbear.dice/internal-*` handshake. The popover is disposable: close it, let the
tray replace it, reopen later — the roll still completes. On reopen the UI re-derives
state from `init`, which is the source of truth regardless.

`internal-roll` carries `{ rolls: [{ itemId, bonus, mode }] }`. A single Roll click sends
a one-element array and a bulk roll sends many, so the background has one code path and
the batch is not a special case — it is just a longer queue.

The background reports back on `internal-status` with
`{ itemId, state: "rolling" | "ok" | "error", message? }`. The popover renders this to
disable the button while a roll is in flight and to show a retry affordance on failure —
*if it is open*. Because it often will not be, the background is the authority on error
reporting and always calls `OBR.notification.show(..., "ERROR")` itself. Status broadcast
is a UI nicety; the notification is the guarantee. Nothing in the pipeline depends on a
listener in the popover.

```
main.ts (popover)                 background.ts (always on)          dicex
  Roll click
    ──internal-roll──────────────────▶
    { itemId, bonus, mode }
                                    build notation
                                    ──dice-plus/roll-request─────────▶
                                                                    3D roll
                                    ◀─{source}/roll-result───────────
                                    updateItems → forge/init
  onChange re-render ◀── (Forge and our UI both observe the item)
```

## Data model

The extension owns almost no state; it is a view over Forge plus one preference store.

| Data | Location | Access |
|---|---|---|
| Roster | scene items where `com.battle-system.forge/on-list === true` | read |
| Name | `…forge/name` → item `text.plainText` → item `name` | read |
| Initiative | `…forge/init` (number; `0` = unrolled) | **write** |
| DEX | `…forge/Z018` (string or number — coerce) | read |
| Owner | item `createdUserId`; names via `OBR.party.getPlayers()` | read |
| Bonus overrides | room meta `com.abottchen.obr-forge-helper/v1/bonus/<itemId>` | read/write |

`init` is the only Forge key ever written, always as a number, via
`OBR.scene.items.updateItems` spreading existing metadata so the stat block is
untouched. Overrides are written only when the typed value differs from the computed
prefill, so key count stays near zero for a typical party. The GM's client prunes
overrides for tokens no longer in the scene on load, following obr-inv's `heal.ts`.

### Constants

```ts
export const EXTENSION_ID = "com.abottchen.obr-forge-helper";
export const OVERRIDE_KEY_PREFIX = `${EXTENSION_ID}/v1/bonus/`;
export const INTERNAL_ROLL_CHANNEL = `${EXTENSION_ID}/internal-roll`;
export const INTERNAL_STATUS_CHANNEL = `${EXTENSION_ID}/internal-status`;
export const ROLL_RESULT_CHANNEL = `${EXTENSION_ID}/roll-result`;
export const ROLL_ERROR_CHANNEL = `${EXTENSION_ID}/roll-error`;
export const DICE_PLUS_ROLL_REQUEST_CHANNEL = "dice-plus/roll-request";

export const FORGE = "com.battle-system.forge/";
export const F_ON_LIST = `${FORGE}on-list`;
export const F_INIT = `${FORGE}init`;
export const F_NAME = `${FORGE}name`;
export const F_DEX = `${FORGE}Z018`;

export const ROLL_TIMEOUT_MS = 20000;
```

## Bonus resolution

```
override ?? Math.floor((dex - 10) / 2) ?? 0
```

`Z018` is a string on some tokens and a number on others (`ForgeCollection.json` exports
strings; live tokens carry numbers). Coerce through `Number(String(v).trim())` and treat
`NaN` as absent, yielding a `0` prefill.

Note that `Math.floor` is correct for negative modifiers: DEX 7 gives `-2`, not `-1`.

## Ownership and role split

A row is **GM-controlled** iff `createdUserId === the GM's player id`. Everything else
is PC-controlled.

The GM's id is `OBR.player.id` when the local player is the GM, otherwise the
`role === "GM"` entry of `OBR.party.getPlayers()`.

The test is deliberately inverted rather than "owner is a non-GM party member", because
`getPlayers()` returns only *connected* players. A PC whose owner is offline resolves to
no party member and would be hidden from every player — the exact wrong failure, since a
token owned by an absent player is one the GM most needs visible. Unknown and offline
owners therefore land in the PC block by default: a stray monster in the shared list is
cosmetic, a PC vanishing from it is a broken workflow.

Ownership is live. OBR's assign-owner action rewrites `createdUserId`, so reassigning a
token in OBR immediately moves it between blocks with no extension-specific concept of
ownership to maintain. This is also the supported way to cover an absent player.

Consequences:

- If the GM is disconnected, a player's client cannot identify the GM id — and therefore
  cannot tell a PC token from a GM token *at all*. There is no safe roster to render, so
  the panel shows a "Waiting for the GM to connect" state and lists nothing.

  An earlier draft of this spec said "show PC rows only" here. That is unimplementable for
  exactly the reason above, and the implementation written against it took the other
  branch — treating every unknown owner as PC-controlled — which exposed the entire GM
  roster to any player whose GM had dropped. The instruction, not the code, was the bug.
  The GM's own client is unaffected: its `gmId` is always its own id.
- A GM-owned PC token lands in the GM-only block. Fix by assigning it to the player.

### Visibility and roll permission

| Viewer | Sees | Can roll |
|---|---|---|
| Player | All PC-controlled rows (nothing at all if the GM is disconnected) | Rows where `createdUserId === OBR.player.id` |
| GM | All rows, PC block then `── GM only ──` divider | All |

Non-rollable rows render read-only rather than being hidden, so players can see who has
already rolled. Restricting players to their own tokens means writes never violate
`CHARACTER_OWNER_ONLY`, so no GM-relay fallback is needed.

## Roll pipeline

Notation by mode, where `N` is the resolved bonus:

| Mode | Notation |
|---|---|
| Normal | `1d20+N` |
| Advantage | `2d20kh1+N` |
| Disadvantage | `2d20kl1+N` |

A zero bonus emits bare `1d20`; a negative bonus emits `1d20-N`.

Request payload on `dice-plus/roll-request`, `{ destination: "LOCAL" }`:

```ts
{
  rollId: crypto.randomUUID(),
  playerId: OBR.player.id,        // dicex drops the request if this doesn't match
  playerName: await OBR.player.getName(),
  rollTarget: isGmControlled(item) ? "gm_only" : "everyone",
  diceNotation: notation,
  showResults: true,
  timestamp: Date.now(),
  source: EXTENSION_ID,           // response channel prefix AND visibility gate
}
```

### Visibility is per token, not per roller

PC-controlled tokens roll `"everyone"` (visible to the table); GM-controlled tokens roll
`"gm_only"` (hidden). The predicate is `createdUserId === GM id` — the same one that
sorts rows into the PC and GM blocks, so there is a single definition of "GM-controlled"
rather than two rules to drift apart.

The point is not concealing the result — Forge publishes that to everyone regardless.
It is concealing the *modifier*. A visible roll posts its full breakdown to Rumble via
`formatRumbleMessage` (`1d20 → [14] +3 = 17`) and `getRumbleRecipients` sends it to
`Everyone`, so a public monster roll hands the table its DEX. A PC has no such secret,
which is why the rule keys off the token: when the GM rolls for an absent player, the
roll stays public and the table sees it happen normally.

The background recomputes this from live item data at roll time rather than trusting a
value passed in the `internal-roll` message. The popover already knows the answer, but
deriving it at the point of use means a stale popover — one rendered before a token was
reassigned — cannot make a monster's roll public.

### The `source` allowlist — a cross-repo contract

As of dicex `68e1254`, roll visibility is source-gated. `resolveHidden(source, target)`
in `dicePlusProtocol.ts` returns visible only when `rollTarget === "everyone"` *and*
`source` appears in `TRUSTED_ROLL_TARGET_SOURCES`, which currently contains exactly one
entry: `"com.abottchen.obr-forge-helper"`.

So our PC-token rolls are publicly visible to the whole table — but only because our
extension id is on that list, matched by exact string comparison. GM-token rolls send
`"gm_only"` and are hidden by the first clause regardless of the allowlist.

**This fails silently.** An unlisted source still gets a successful roll and a normal
result; it is merely hidden, with no error and no warning. Renaming `EXTENSION_ID`,
typoing it, or changing its case would quietly downgrade every initiative roll to
GM-only, and the symptom — "players stopped seeing the dice" — points nowhere near the
cause.

Nothing else catches this. `source` is echoed back verbatim as the response channel
prefix, so a renamed id still round-trips correctly against our own listener — the
request succeeds, the result arrives, `init` is written, and only the visibility is
wrong. Every other part of the system stays self-consistent under a rename, which is
precisely why the allowlist mismatch goes unnoticed.

The mitigation is therefore a unit test asserting `EXTENSION_ID` equals the literal
`"com.abottchen.obr-forge-helper"`, commented with the fact that dicex's
`TRUSTED_ROLL_TARGET_SOURCES` mirrors it. A rename then breaks a test rather than a
session.

Four constraints from dicex's implementation, each of which fails silently if missed:

- **Serialize rolls within a client.** dicex tracks one pending request in a module
  global (`dicePlusPendingRequest.ts`); a second roll overwrites the first's routing and
  that requester never hears back. Promise-chain mutex, as in obr-mcp-proxy's
  `dicePlus.ts`. Scope is per client — see "Concurrency" below.
- **Always match on `rollId`.** dicex clears its pending slot only on success, so a
  stale pending request can attach to the user's next *manual* tray roll and deliver
  that result to our channel. Drop unsolicited results.
- **20s timeout.** A request failing `isRollRequest()`, or carrying a mismatched
  `playerId`, is dropped with no reply at all. Timeout is the only backstop.
- **`playerId` must be the local player.** Combined with `destination: "LOCAL"`, this
  means each client rolls its own dice — which is why the design needs no cross-client
  coordination.

### Concurrency

Simultaneous rolls by different players require no coordination. Three properties stack
to isolate them:

1. Requests go `{ destination: "LOCAL" }`, reaching only the dicex in the same client.
2. dicex additionally drops any request whose `playerId` isn't the local player.
3. `pending` in `dicePlusPendingRequest.ts` is a module-level variable, so it exists once
   per browser tab.

Two players rolling at the same instant therefore mutate different variables in different
browsers. The mutex exists solely for **same-client** concurrency, which is a real case:
the GM rolling several monsters in a row, or a player who owns more than one token
(Simon owns both Grieg and Urida).

Shared state, and why none of it needs locking:

| Resource | Concurrent access | Why it's safe |
|---|---|---|
| dicex `pending` | Per tab | Never shared between clients |
| `forge/init` | Different items per roller | `updateItems` targets one id |
| Bonus overrides | Room metadata, one key per token | `setMetadata` merges the patch, so writes to distinct keys don't collide |

The override layout is what lets us skip obr-inv's `atomic.ts` entirely. That module's
nonce/echo protocol exists for contention on a *shared* key plus a storage cap; here every
writer touches its own token's key and the values are single integers.

The one genuine race is the GM and a player rolling the **same** token simultaneously —
possible when a player reconnects mid-initiative. Both writes succeed and the later one
wins. Both are valid initiative rolls for that combatant, so the outcome is correct
either way; it is not worth a locking scheme.

### Write-back

```ts
await OBR.scene.items.updateItems([itemId], (drafts) => {
  for (const d of drafts) d.metadata[F_INIT] = total;
});
```

`total` is `Math.max(1, result.totalValue)`.

Forge sets `init` to `0` when a token joins the list, so `0` is the only available
"unrolled" signal. A roll can legitimately total `0` or less — a natural 1 with a
negative DEX modifier — which would otherwise read as "hasn't rolled yet" and be swept
into the next bulk roll, overwriting itself. Only GM-controlled creatures reach this in
practice; PCs rarely have a negative modifier.

**The clamp is a write-time floor only.** dicex composes its Rumble message and audit-log
entry from its own roll result before reporting back to us, so the record keeps the true
value: the log reads `1d20 → [💀1] -1 = 0` while Forge shows `1`. Nothing downstream can
alter what dicex logged.

The residue is that a true `0` sorts as if it were `1`, tying with a creature that
genuinely rolled `1`. Initiative is an ordering, not a quantity, so this costs at most one
arbitrary tie in a case that needs a natural 1 *and* a negative modifier to occur. The
alternative — tracking which zero-valued combatants had actually been rolled — needs a new
key space, a prune routine, and a display branch to buy back a distinction with no
consequence at the table.

Result rendering may use `groups[].dice[].kept === false` to show the discarded d20 on
advantage/disadvantage rolls.

## UI

One list, sorted by `init` descending with unrolled rows last. Sorting applies *within*
each block; the PC block always precedes the GM block rather than interleaving by
initiative, so the divider stays meaningful. Each row: name and owning player, bonus box,
three-way mode toggle, current initiative, Roll button.

The mode toggle defaults to normal and resets to normal after every roll — advantage is
situational, and a sticky toggle would silently apply last round's condition to this
round. Only the bonus persists.

```
┌─ Forge Helper ───────────────────┐
│ 6 combatants                     │
│                                  │
│ Chumble Crudluck                 │
│  bonus [ +2 ]  [~][adv][dis]  17 │
│                        [ Roll ]  │
│                                  │
│ Vex                              │
│  bonus [ +4 ]  [~][adv][dis]  —  │
│                        [ Roll ]  │
│                                  │
│ ── GM only ───────────────────── │
│ Goblin A                         │
│  bonus [ +2 ]  [~][adv][dis]  —  │
│                        [ Roll ]  │
│                                  │
│ [ Roll all unrolled (5) ]        │
└──────────────────────────────────┘
```

### Bulk roll (GM only)

A single button at the foot of the GM block rolls every GM-controlled combatant that is
`on-list` and still has `init === 0`, one at a time. It never touches PC tokens, so the
GM covering for an absent player rolls that one individually — which is correct, since
those rolls are public and the batch's are not.

This is `roll_init.py` from the `roll-initiative` skill in `dnd-toa`, moved into the
extension: the same three-part filter (`on-list`, `init == 0`, not a PC) and the same
`1d20 + DEX mod` per combatant. The improvement is the third clause. The skill carries a
hardcoded `EXCLUDED_PCS` name set that must be edited whenever the party changes;
ownership derives it. Both treat Musharib the same way — the skill deliberately omits him
from the exclusion list, and he is GM-owned.

Mechanics:

- **The loop lives in the background page.** In the popover it would die after the first
  roll, when dicex's `OBR.action.open()` takes the sidebar.
- **Staggering is inherent, not added.** dicex holds one pending request, so roll N+1
  cannot start until N reports back. The 3D animation is the pacing; no artificial delay.
- **The tray opens once.** `OBR.action.open()` is a no-op when already open, so the batch
  plays out as a sequence in one tray. This is the case where losing the sidebar stops
  being a cost: one round trip instead of one per monster.
- **Per-row mode is honored.** If a row's toggle reads advantage, the batch rolls it with
  advantage. The button should do what the visible controls say.
- **The roster is snapshotted at click time.** A token added mid-batch is not swept in.
- **A failure doesn't abort the batch.** Errors are collected per combatant and reported
  at the end; one timed-out goblin must not strand the other seven.
- **No cancel.** A batch of eight runs perhaps 30–40 seconds, and the popover is usually
  closed during it, so a cancel button would be somewhere the user isn't. A mistaken
  batch is recoverable by rolling individual rows again.

The `Math.max(1, total)` clamp on write is load-bearing here. Without it, a combatant
rolling a natural 1 with a negative modifier would be written as `0`, still read as
unrolled, and be picked up again by the next batch.

`init === 0` renders as `—`. The header is just the combatant count. The roster is shown
whenever `on-list` tokens exist, and the extension never reads Forge's turn or round
state: initiative does not depend on it, and the whole point is entering initiative
*before* combat starts. With no `on-list` tokens: "No combatants on Forge's initiative
list."

Re-render on `OBR.scene.items.onChange` (roster and `init`),
`OBR.room.onMetadataChange` (bonus overrides), and `OBR.party.onChange` (player
names and GM id). All `innerHTML` interpolation goes through `escapeHtml()`.

## Error handling

| Failure | Handling |
|---|---|
| dicex absent or inactive | 20s timeout → notification naming dicex; row shows retry if open |
| Bad notation | dicex `roll-error` → surface its message verbatim |
| Write rejected by permissions | catch → notification "ask your GM to enable character updates" |
| Popover closed mid-roll | Roll still completes; errors surface as notifications |
| Owner offline | Row stays in PC block, labelled with the token name |
| GM disconnected | Player clients show PC rows only |
| Stale/unsolicited result | Dropped on `rollId` mismatch |
| Missing or unparseable `Z018` | Prefill falls back to `0`; manual entry still works |

## Module layout

```
index.html            → src/main.ts        action popover UI
background.html       → src/background.ts  always-running roll pipeline
public/manifest.json
public/manifest.dev.json
public/icon.svg
src/constants.ts      IDs, channels, Forge keys
src/types.ts          Forge + Dice+ types, error classes
src/forge.ts          roster read, init write, name/DEX coercion
src/bonus.ts          DEX modifier prefill, override read/write
src/roster.ts         ownership resolution, role split, sorting
src/dicePlus.ts       dicex client: request, correlate, timeout, serialize
src/notation.ts       mode + bonus → notation string
src/ui-list.ts        list and empty states
src/ui-row.ts         one combatant row
src/styles*.ts        CSS-in-JS
src/escape.ts         escapeHtml
test/_mocks/obr-sdk.ts
test/*.test.ts
```

`bonus`, `notation`, `roster`, and the coercion helpers in `forge` are pure functions
with no OBR dependency. That is where the logic risk concentrates and where the tests
go.

## Testing

Vitest + jsdom. Extend obr-inv's `test/_mocks/obr-sdk.ts` with `scene.items` and a
scriptable fake dicex that can reply, error, stay silent, or reply with a foreign
`rollId`.

Cases:

- Bonus precedence: override beats DEX modifier beats `0`; `Z018` as string and as
  number; missing, empty, and non-numeric `Z018`; odd and negative DEX scores.
- Notation for all three modes, plus zero and negative bonuses.
- Roster split: GM-owned to GM block, offline owner to PC block, GM disconnected yields
  PC-only, PC block precedes GM block, sorting with unrolled rows last.
- Mode toggle resets to normal after a roll while the bonus override persists.
- Every failure path emits a notification, including with no status listener attached.
- `EXTENSION_ID` equals `"com.abottchen.obr-forge-helper"`, guarding dicex's
  `TRUSTED_ROLL_TARGET_SOURCES` allowlist against a silent rename.
- `rollTarget` is `"gm_only"` for a GM-owned token and `"everyone"` for a PC-owned one,
  including when the GM rolls a PC, and is derived from the item rather than the
  request message.
- Bulk roll selects GM-owned `on-list` tokens with `init === 0` only: it skips PCs,
  already-rolled tokens, and tokens off the list.
- Bulk roll continues past a failing combatant and reports the failures at the end.
- A combatant rolling a clamped `1` is not re-selected by a subsequent bulk roll.
- A roll totalling `0` or negative writes `1`, and a roll totalling `1` or more writes
  its true value.
- dicex client: correlation, foreign `rollId` ignored, timeout, `roll-error`
  propagation, two concurrent rolls serialize.
- Write: `init` is a number, clamped to ≥1, and sibling metadata survives the merge.

## Deployment

`vite.config.ts` with `base: "./"`, `server.cors.origin: "https://www.owlbear.rodeo"`,
and two rollup inputs (`main`, `background`). `manifest.json` points at
`https://abottchen.github.io/obr-forge-helper/`, `manifest.dev.json` at
`http://localhost:5173/`; both declare `action.popover` and `background_url`.

GitHub Actions: obr-inv's `deploy.yml` (push to `main`, `npm ci && npm test && npm run
build`, Pages) and `test.yml` (PRs and non-main pushes) verbatim.

## Known limitations

- **Requires dicex `68e1254` or later for visible PC rolls.** Earlier builds force-hide
  every Dice+ roll. A player on an older dicex still gets working initiative — the
  number reaches Forge either way — but their roll is hidden from the table, silently
  and with no error. GM-token rolls are unaffected, being hidden by design.
- **The dice tray steals the sidebar.** dicex calls `OBR.action.open()` on every roll,
  so the forge-helper panel is replaced mid-roll. The background page makes this
  harmless, but the user must click back to forge-helper to roll again.
- **A concurrent manual roll can be mistaken for ours.** dicex stamps the *pending slot's*
  `rollId` onto whatever dice finish (`dicePlusResultReporter.ts`), so if the user rolls
  manually in the tray while one of our requests is outstanding, we receive our own
  `rollId` carrying their values — and write that total as initiative. Our `rollId` check
  cannot catch this, because the id is ours; the fault is that dicex associates a result
  with a pending request by recency rather than by identity. Not fixable from this side.
  Rare in practice: it needs a manual roll inside the ~3-5s window of an initiative roll.
- **No tie-breaking control.** Forge exposes no sortable tiebreak field; only the `init`
  integer can be written.
- **Only one Dice+ consumer at a time.** If Dice+ proper and dicex are both installed
  they will both answer, and dicex's single pending slot makes concurrent consumers
  unreliable.
