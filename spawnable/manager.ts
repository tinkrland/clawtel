// spawnable manager: the lanes the server exposes. the tenki lane is
// wired and live-verified; other lanes land here as they are wired.
// a lane without its key reports closed and every call through it
// says so, nothing fakes a spawnable.

import { TenkiProvider } from "./tenki.ts";
import type { SpawnableSpec } from "./types.ts";

const tenki = new TenkiProvider();
/** the shared provider instance: lanes and routes use one client. */
export const tenkiProvider = tenki;

export interface LaneStatus {
  lane: string;
  available: boolean;
}

export function spawnableStatus(): LaneStatus[] {
  return [
    { lane: "tenki", available: tenki.isAvailable() },
  ];
}

export async function spawnableList() {
  if (!tenki.isAvailable()) throw new Error("tenki lane is closed: TENKI_API_KEY is unset");
  const sessions = await tenki.client.list();
  return sessions.map((s) => ({ name: s.name, state: s.state }));
}

export async function spawnableCreate(spec: SpawnableSpec) {
  if (!tenki.isAvailable()) throw new Error("tenki lane is closed: TENKI_API_KEY is unset");
  const spawnable = await tenki.create(spec);
  return { name: spawnable.name, status: spawnable.status, form: spec.form };
}

export async function spawnableDestroy(name: string) {
  if (!tenki.isAvailable()) throw new Error("tenki lane is closed: TENKI_API_KEY is unset");
  await tenki.destroy(name);
}
