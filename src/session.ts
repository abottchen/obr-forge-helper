import OBR from "@owlbear-rodeo/sdk";

export interface Session {
  selfId: string;
  isGm: boolean;
  /** null when we are a player and the GM is not connected. */
  gmId: string | null;
}

/**
 * Resolve who we are and who the GM is.
 *
 * getPlayers() returns only *connected* players, which is why ownership is
 * classified by "is the GM" rather than "is a party member": a PC whose owner
 * is offline must still appear for everyone.
 */
export async function resolveSession(): Promise<Session> {
  const role = await OBR.player.getRole();
  const selfId = OBR.player.id;
  if (role === "GM") return { selfId, isGm: true, gmId: selfId };
  const players = await OBR.party.getPlayers();
  const gm = players.find((p) => p.role === "GM");
  return { selfId, isGm: false, gmId: gm ? gm.id : null };
}
