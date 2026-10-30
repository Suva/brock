// AI agents and this window: whether they are allowed at all, which maps are
// shared with them and how far, and answering what they ask. Both choices belong to this
// computer, not the vault, so they are kept in the window's own storage and
// do not travel in a backup, an export or, later, a sync: sharing a map with
// an agent here says nothing about another device.
//
// The native side only carries requests in (src-tauri/src/agent.rs); the
// questions are answered here, from the vault in memory, by `core/agent.ts`.

import { invoke } from "@tauri-apps/api/core";
import { respond, type AgentReply } from "../core/agent.ts";
import type { Vault } from "../core/vault.ts";
import { inTauri } from "../store/tauri-store.ts";

const KEY = "brock-agents";

/** How far a map is shared with agents. */
export type Access = "none" | "read" | "write";

interface Saved {
  on: boolean;
  /** Map ids, and whether an agent may only read the map or edit it too. */
  access: Record<string, "read" | "write">;
}

function read(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const access: Saved["access"] = {};
      // Before editing, a list of ids shared to read.
      if (Array.isArray(saved.shared)) for (const id of saved.shared) if (typeof id === "string") access[id] = "read";
      if (saved.access && typeof saved.access === "object") {
        for (const [id, level] of Object.entries(saved.access)) if (level === "read" || level === "write") access[id] = level;
      }
      return { on: saved.on === true, access };
    }
  } catch {
    // Storage that cannot be read gives the safe choice: nothing allowed or shared.
  }
  return { on: false, access: {} };
}

class Agents {
  /** Whether agents may knock at all. Off unless the person turns it on in Settings. */
  on = $state(false);
  /** The maps shared with agents, by id. */
  access = $state<Saved["access"]>({});
  /** Told what an agent changed, to show the person. Set by the window. */
  onChanged: ((what: string) => void) | null = null;

  constructor() {
    const saved = read();
    this.on = saved.on;
    this.access = saved.access;
  }

  /** The ids of every map shared, to read or to edit. */
  get shared(): string[] {
    return Object.keys(this.access);
  }

  /** The ids of the maps agents may edit. */
  get writable(): string[] {
    return this.shared.filter((id) => this.access[id] === "write");
  }

  level(id: string): Access {
    return this.access[id] ?? "none";
  }

  /** Shares a map with agents to the given extent, or stops. */
  share(id: string, level: Access): void {
    const { [id]: _gone, ...rest } = this.access;
    this.access = level === "none" ? rest : { ...rest, [id]: level };
    this.#save();
  }

  /** Allows agents or not. Returns what went wrong if the door could not be opened. */
  async allow(on: boolean): Promise<string | null> {
    if (on) {
      try {
        await open(true);
      } catch (e) {
        return String(e);
      }
    } else {
      await open(false).catch(() => {});
    }
    this.on = on;
    this.#save();
    return null;
  }

  #save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: this.on, access: this.access } satisfies Saved));
    } catch {
      // Without storage the choice lasts until the window closes.
    }
  }
}

export const agents = new Agents();

const open = (enabled: boolean) => (inTauri() ? invoke("agent_enable", { enabled }) : Promise.resolve());

/** Whether this window can be reached by agents at all: only the app can. */
export const canHostAgents = () => inTauri();

/** This app's own executable, which an agent starts with `--mcp`, for the command to give it. */
export const agentExecutable = () => invoke<string | null>("agent_executable");

/**
 * Starts answering agents' requests, and opens the door if they are allowed.
 * Called once, when the window has its vault.
 */
export async function watchAgents(vault: Vault): Promise<void> {
  if (!inTauri()) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ id: number; request: unknown }>("agent-request", ({ payload }) => {
    invoke("agent_reply", { id: payload.id, reply: reply(vault, payload.request) });
  });
  // Tells the native side what this window's storage says, so that what `brock --mcp` reads agrees with it.
  await open(agents.on).catch((e) => console.error(e));
}

function reply(vault: Vault, raw: unknown): AgentReply {
  // Not steps for ⌘Z; the History tab takes them back.
  return respond(vault, raw, { on: agents.on, shared: new Set(agents.shared), writable: new Set(agents.writable) }, (what) => agents.onChanged?.(what));
}
