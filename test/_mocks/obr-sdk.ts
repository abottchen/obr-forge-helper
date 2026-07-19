import { vi } from "vitest";

export interface MockItem {
  id: string;
  name: string;
  createdUserId: string;
  layer: string;
  metadata: Record<string, unknown>;
  text?: { plainText?: string };
}

export interface MockPlayer {
  id: string;
  name: string;
  role: "PLAYER" | "GM";
}

const store = new Map<string, unknown>();
const items = new Map<string, MockItem>();
const broadcasts: Array<{ channel: string; data: unknown; destination?: string }> = [];
const broadcastListeners: Record<string, Array<(ev: { data: unknown; connectionId: string }) => void>> = {};
const metadataListeners: Array<(m: Record<string, unknown>) => void> = [];
const itemsListeners: Array<(i: MockItem[]) => void> = [];
const partyListeners: Array<(p: MockPlayer[]) => void> = [];

let role: "PLAYER" | "GM" = "PLAYER";
let selfId = "player-self";
let selfName = "Self";
let connectionId = "conn-self";
let players: MockPlayer[] = [];
export const notifications: Array<{ message: string; level: string }> = [];

function emitItems(): void {
  const snapshot = [...items.values()];
  itemsListeners.forEach((l) => l(snapshot));
}

export const OBR = {
  isAvailable: true,
  onReady: vi.fn((cb: () => void) => {
    void cb();
  }),
  room: {
    getMetadata: vi.fn(async () => Object.fromEntries(store)),
    setMetadata: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) store.delete(k);
        else store.set(k, v);
      }
      const snapshot = Object.fromEntries(store);
      metadataListeners.forEach((l) => l(snapshot));
    }),
    onMetadataChange: vi.fn((cb: (m: Record<string, unknown>) => void) => {
      metadataListeners.push(cb);
      return () => {
        const i = metadataListeners.indexOf(cb);
        if (i >= 0) metadataListeners.splice(i, 1);
      };
    }),
  },
  scene: {
    items: {
      getItems: vi.fn(async () => [...items.values()]),
      updateItems: vi.fn(
        async (ids: string[], mutator: (drafts: MockItem[]) => void) => {
          const drafts = ids
            .map((id) => items.get(id))
            .filter((x): x is MockItem => x !== undefined);
          mutator(drafts);
          emitItems();
        },
      ),
      onChange: vi.fn((cb: (i: MockItem[]) => void) => {
        itemsListeners.push(cb);
        return () => {
          const i = itemsListeners.indexOf(cb);
          if (i >= 0) itemsListeners.splice(i, 1);
        };
      }),
    },
  },
  player: {
    getRole: vi.fn(async () => role),
    getName: vi.fn(async () => selfName),
    get id() {
      return selfId;
    },
  },
  party: {
    getPlayers: vi.fn(async () => players),
    onChange: vi.fn((cb: (p: MockPlayer[]) => void) => {
      partyListeners.push(cb);
      return () => {
        const i = partyListeners.indexOf(cb);
        if (i >= 0) partyListeners.splice(i, 1);
      };
    }),
  },
  broadcast: {
    sendMessage: vi.fn(
      async (channel: string, data: unknown, opts?: { destination?: string }) => {
        broadcasts.push({ channel, data, destination: opts?.destination });
        for (const l of [...(broadcastListeners[channel] ?? [])]) l({ data, connectionId });
      },
    ),
    onMessage: vi.fn((channel: string, cb: (ev: { data: unknown; connectionId: string }) => void) => {
      if (!broadcastListeners[channel]) broadcastListeners[channel] = [];
      broadcastListeners[channel].push(cb);
      return () => {
        const arr = broadcastListeners[channel] ?? [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    }),
  },
  notification: {
    show: vi.fn(async (message: string, level: string) => {
      notifications.push({ message, level });
    }),
  },
};

export const __testHooks = {
  reset() {
    store.clear();
    items.clear();
    broadcasts.length = 0;
    notifications.length = 0;
    for (const k of Object.keys(broadcastListeners)) delete broadcastListeners[k];
    metadataListeners.length = 0;
    itemsListeners.length = 0;
    partyListeners.length = 0;
    role = "PLAYER";
    selfId = "player-self";
    selfName = "Self";
    connectionId = "conn-self";
    players = [];
  },
  setRole(r: "PLAYER" | "GM") {
    role = r;
  },
  setSelf(id: string, name = "Self") {
    selfId = id;
    selfName = name;
  },
  setConnectionId(id: string) {
    connectionId = id;
  },
  setParty(p: MockPlayer[]) {
    players = p;
    partyListeners.forEach((l) => l(p));
  },
  setItems(list: MockItem[]) {
    items.clear();
    for (const i of list) items.set(i.id, i);
    emitItems();
  },
  getItem(id: string) {
    return items.get(id);
  },
  broadcasts,
  store,
};

vi.mock("@owlbear-rodeo/sdk", () => ({ default: OBR, OBR }));

export type DicexBehaviour =
  | { mode: "reply"; total: number }
  | { mode: "error"; message: string }
  | { mode: "silent" }
  | { mode: "foreignId" };

/**
 * Stand-in for dicex. Mirrors the parts of the contract that matter:
 * it replies on `{source}/roll-result`, echoes the rollId, and honours
 * the playerId gate by ignoring requests addressed elsewhere.
 */
export function fakeDicex(behaviour: DicexBehaviour): () => void {
  return OBR.broadcast.onMessage("dice-plus/roll-request", (ev) => {
    const req = ev.data as {
      rollId: string;
      playerId: string;
      source: string;
      diceNotation: string;
    };
    if (req.playerId !== selfId) return;
    if (behaviour.mode === "silent") return;
    if (behaviour.mode === "error") {
      void OBR.broadcast.sendMessage(
        `${req.source}/roll-error`,
        { rollId: req.rollId, error: behaviour.message, notation: req.diceNotation },
        { destination: "LOCAL" },
      );
      return;
    }
    const rollId = behaviour.mode === "foreignId" ? "some-other-roll" : req.rollId;
    const total = behaviour.mode === "reply" ? behaviour.total : 0;
    void OBR.broadcast.sendMessage(
      `${req.source}/roll-result`,
      {
        rollId,
        playerId: req.playerId,
        playerName: selfName,
        rollTarget: "everyone",
        result: {
          totalValue: total,
          rollSummary: `${total}`,
          groups: [
            {
              description: req.diceNotation,
              diceType: "d20",
              dice: [{ value: total, kept: true }],
              total,
              isNegative: false,
            },
          ],
        },
      },
      { destination: "LOCAL" },
    );
  });
}
