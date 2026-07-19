export function injectStyles(css: string, id: string): void {
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * Palette and control grammar are lifted from Forge's own combat tracker so the
 * two panels read as one tool. Every colour here was sampled from a Forge
 * screenshot rather than picked — if Forge reskins, resample, do not guess.
 *
 * The grammar is: fields sink to `--fh-sunken`, anything chosen or active
 * rises into an indigo chip (`--fh-chip` / `--fh-badge`) outlined in
 * periwinkle. The initiative badge is the largest instance of that chip, which
 * is deliberate — it is the same object Forge shows in its leftmost column,
 * and filling it is the whole point of this panel.
 */
export const BASE_CSS = `
:root {
  --fh-bg: #1a1d29;
  --fh-surface: #1c1f2d;
  --fh-sunken: #101219;
  --fh-chip: #363656;
  --fh-badge: #404268;
  --fh-line: #2a2e42;
  --fh-stroke: #8b87e1;
  --fh-accent: #9d99ff;
  --fh-text: #ffffff;
  --fh-dim: #8b90b0;
  /* Border of an unfilled badge, and the em-dash inside it. The glyph runs
     brighter than the stroke so the placeholder stays legible (4.6:1) while
     the outline stays quiet. */
  --fh-ghost: #4a4c72;
  --fh-ghost-text: #8186b4;
  --fh-danger: #ee7189;

  /* Column widths, shared by the header labels and the row controls so the two
     cannot drift out of alignment. Change a width here, not at either use. */
  --fh-w-init: 38px;
  --fh-w-mod: 36px;
  --fh-w-mode: 98px;
  --fh-w-roll: 32px;
  --fh-gap: 6px;
  /* Row border + horizontal padding: how far a row's content sits in from its
     own edge. The header pads by this much more than the page so its labels
     land over their columns. */
  --fh-inset: 8px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fh-bg);
  color: var(--fh-text);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
.fh-root { padding: 0 12px 16px; }

/* Forge labels its columns in letterspaced periwinkle caps. Reused here for
   the column header and the GM divider — the two structural labels. */
.fh-cols,
.fh-divider {
  color: var(--fh-accent);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .1em;
}
/* Sticky so the columns stay named through a long encounter. Bleeds to the
   panel edge, then pads back in by the page gutter plus the row inset. */
.fh-cols {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--fh-gap);
  margin: 0 -12px 8px;
  padding: 10px calc(12px + var(--fh-inset)) 8px;
  background: var(--fh-surface);
  border-bottom: 1px solid var(--fh-line);
}
.fh-cols > * { flex: none; text-align: center; }
.fh-cols .fh-col-name { flex: 1; text-align: left; }
.fh-cols .fh-col-init { width: var(--fh-w-init); }
.fh-cols .fh-col-mod { width: var(--fh-w-mod); }
.fh-cols .fh-col-mode { width: var(--fh-w-mode); }
.fh-cols .fh-col-roll { width: var(--fh-w-roll); }
.fh-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 6px;
}
.fh-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--fh-line);
}

/* Forge's tracker is a dense table and encounters get long, so a combatant is
   one line: badge, name, bonus, mode, roll. Everything but the name is a fixed
   width, which keeps the controls in columns down the panel. The error message
   is the only thing allowed to wrap to a second line. */
.fh-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--fh-gap);
  background: var(--fh-surface);
  border: 1px solid var(--fh-line);
  border-radius: 8px;
  padding: 5px 7px;
  margin-bottom: 4px;
  transition: background-color .12s ease, border-color .12s ease;
}
.fh-row:hover {
  /* Forge's own active-row fill, reused for hover. */
  background: #25273b;
  border-color: #3a3f5c;
}
.fh-row[data-state="error"] { border-color: var(--fh-danger); }

.fh-ident {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.fh-name {
  font-weight: 600;
  letter-spacing: -.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Owner rides inline with the name rather than on its own line — it is a
   qualifier, not a second field, and the panel is only 400px tall-ish. */
.fh-owner {
  flex: none;
  color: var(--fh-dim);
  font-size: 11px;
  white-space: nowrap;
}
.fh-owner::before { content: "· "; }

/* The signature element: Forge's initiative badge, shown empty until we fill
   it. Dashed ghost while unrolled, Forge's solid indigo chip once the number
   lands. */
.fh-init {
  flex: none;
  display: grid;
  place-items: center;
  /* Wider than tall, as Forge draws it. */
  width: var(--fh-w-init);
  height: 26px;
  border: 1.5px solid var(--fh-stroke);
  border-radius: 6px;
  background: var(--fh-badge);
  color: var(--fh-text);
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.02em;
}
.fh-init[data-unrolled="true"] {
  background: transparent;
  border-style: dashed;
  border-color: var(--fh-ghost);
  color: var(--fh-ghost-text);
  font-weight: 500;
}
.fh-row[data-state="rolling"] .fh-init {
  border-style: solid;
  border-color: var(--fh-stroke);
  color: var(--fh-accent);
}

/* Only badges the viewer can act on advertise themselves. The rest are
   readouts and should not invite a click that does nothing. */
.fh-init[data-editable="true"] { cursor: pointer; }
.fh-init[data-editable="true"]:hover { border-color: var(--fh-accent); }

/* Same box as the badge it replaces, so the row does not reflow on entering
   edit mode. Sunken and centred like the bonus box, because it is one — but
   it keeps the badge's weight and size so the number does not jump. */
.fh-init-edit {
  flex: none;
  width: var(--fh-w-init);
  height: 26px;
  background: var(--fh-sunken);
  color: var(--fh-text);
  border: 1.5px solid var(--fh-accent);
  border-radius: 6px;
  padding: 0 2px;
  text-align: center;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* The global :focus-visible rule draws its ring with outline, which bleeds
   outward from the border edge — fine for isolated controls, but this badge
   sits --fh-gap (6px) from the bonus box next to it, so an outline would
   overlap its neighbour. An inset box-shadow gets the same 2px/accent weight
   without leaving the box, so the row's metrics do not move. */
.fh-init-edit:focus {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--fh-accent);
}

.fh-bonus {
  flex: none;
  width: var(--fh-w-mod);
  height: 26px;
  background: var(--fh-sunken);
  color: var(--fh-text);
  border: 1px solid #23263a;
  border-radius: 6px;
  padding: 0 2px;
  text-align: center;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.fh-bonus:focus { border-color: var(--fh-stroke); outline: none; }
/* Rows the viewer may not roll recede rather than reading as live controls. */
.fh-bonus:disabled, .fh-mode:disabled { opacity: .5; }

/* Unselected modes sit in the sunken well; the selected one rises into the
   same indigo chip the badge uses. */
.fh-modes {
  flex: none;
  width: var(--fh-w-mode);
  display: flex;
  gap: 1px;
  background: var(--fh-sunken);
  border: 1px solid #23263a;
  border-radius: 6px;
  padding: 2px;
}
.fh-mode {
  /* Equal thirds of the fixed column, so the labels cannot widen it. */
  flex: 1;
  background: none;
  color: var(--fh-dim);
  border: none;
  border-radius: 4px;
  padding: 2px 2px;
  font: inherit;
  font-size: 10.5px;
  line-height: 16px;
  cursor: pointer;
}
.fh-mode:hover:not(:disabled) { color: var(--fh-text); }
/* Only advantage and disadvantage light up. Normal is the default on every
   row, so giving it the chip too put a column of indigo down the panel that
   out-shouted the initiative badges — and told you nothing, since it is what
   every row reads by default. Now a lit chip means exactly one thing: this
   row is not rolling straight. */
.fh-mode[aria-pressed="true"] {
  color: var(--fh-text);
  font-weight: 600;
}
.fh-mode[aria-pressed="true"]:not([data-mode="normal"]) {
  background: var(--fh-badge);
}

.fh-roll, .fh-bulk {
  background: var(--fh-chip);
  color: #cdcaff;
  border: 1px solid var(--fh-stroke);
  border-radius: 7px;
  padding: 5px 13px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.fh-roll {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--fh-w-roll);
  height: 26px;
  padding: 0;
}
.fh-d20 {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linejoin: round;
  stroke-linecap: round;
}
/* The panel's only animation, on the one element that depicts dice and only
   while dice are genuinely in the air. A re-render mid-roll just picks the
   tumble back up. */
.fh-row[data-state="rolling"] .fh-d20 {
  animation: fh-tumble 1.4s cubic-bezier(.6, 0, .4, 1) infinite;
}
@keyframes fh-tumble {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.fh-roll:hover:not(:disabled), .fh-bulk:hover:not(:disabled) {
  background: var(--fh-badge);
  color: var(--fh-text);
}
/* The one filled control in the panel — bulk rolling is the panel's headline
   action, so it gets the badge fill rather than the chip fill. */
.fh-bulk {
  width: 100%;
  background: var(--fh-badge);
  border-color: var(--fh-accent);
  color: var(--fh-text);
  padding: 9px;
  margin-top: 10px;
}
/* Keeps its fill when disabled — dropping to transparent left a hole in the
   row rather than a quiet control. */
.fh-roll:disabled, .fh-bulk:disabled {
  background: #202436;
  border-color: var(--fh-line);
  color: #767b9c;
  cursor: default;
}

.fh-empty {
  padding: 64px 20px;
  text-align: center;
}
.fh-empty-slot {
  width: 54px;
  height: 38px;
  margin: 0 auto 18px;
  display: grid;
  place-items: center;
  border: 1.5px dashed var(--fh-ghost);
  border-radius: 8px;
  color: var(--fh-ghost-text);
  font-size: 17px;
}
.fh-empty-lead {
  margin: 0;
  color: var(--fh-text);
  font-weight: 600;
}
.fh-empty-hint {
  margin: 6px 0 0;
  color: var(--fh-dim);
  font-size: 12px;
  line-height: 1.5;
}
.fh-error {
  flex-basis: 100%;
  color: var(--fh-danger);
  font-size: 11px;
  padding-bottom: 1px;
}

:focus-visible {
  outline: 2px solid var(--fh-accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .fh-row { transition: none; }
  .fh-row[data-state="rolling"] .fh-d20 { animation: none; }
}
`;
