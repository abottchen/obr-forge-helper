export function injectStyles(css: string, id: string): void {
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

export const BASE_CSS = `
:root {
  --fh-bg: #1e1e24;
  --fh-panel: #26262e;
  --fh-line: #3a3a45;
  --fh-text: #e8e8ee;
  --fh-dim: #9a9aa8;
  --fh-accent: #c8a04a;
  --fh-danger: #d06060;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fh-bg);
  color: var(--fh-text);
  font-family: system-ui, sans-serif;
  font-size: 13px;
}
.fh-root { padding: 10px 12px 16px; }
.fh-header {
  color: var(--fh-dim);
  font-size: 12px;
  padding-bottom: 8px;
}
.fh-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--fh-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  margin: 14px 0 8px;
}
.fh-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--fh-line);
}
.fh-row {
  background: var(--fh-panel);
  border: 1px solid var(--fh-line);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.fh-row[data-state="rolling"] { border-color: var(--fh-accent); }
.fh-row[data-state="error"] { border-color: var(--fh-danger); }
.fh-name { font-weight: 600; }
.fh-owner { color: var(--fh-dim); font-weight: 400; font-size: 11px; }
.fh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.fh-bonus {
  width: 46px;
  background: var(--fh-bg);
  color: var(--fh-text);
  border: 1px solid var(--fh-line);
  border-radius: 4px;
  padding: 3px 4px;
  text-align: center;
  font: inherit;
}
.fh-modes { display: flex; }
.fh-mode {
  background: var(--fh-bg);
  color: var(--fh-dim);
  border: 1px solid var(--fh-line);
  padding: 3px 7px;
  cursor: pointer;
  font: inherit;
}
.fh-mode:first-child { border-radius: 4px 0 0 4px; }
.fh-mode:last-child { border-radius: 0 4px 4px 0; }
.fh-mode + .fh-mode { border-left: none; }
.fh-mode[aria-pressed="true"] {
  background: var(--fh-accent);
  border-color: var(--fh-accent);
  color: #1e1e24;
}
.fh-init {
  margin-left: auto;
  min-width: 26px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 15px;
}
.fh-init[data-unrolled="true"] { color: var(--fh-dim); }
.fh-roll, .fh-bulk {
  background: var(--fh-accent);
  color: #1e1e24;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.fh-roll:disabled, .fh-bulk:disabled {
  background: var(--fh-line);
  color: var(--fh-dim);
  cursor: default;
}
.fh-bulk { width: 100%; padding: 7px; margin-top: 4px; }
.fh-empty { color: var(--fh-dim); padding: 24px 4px; text-align: center; }
.fh-error { color: var(--fh-danger); font-size: 11px; margin-top: 4px; }
`;
