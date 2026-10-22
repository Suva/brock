// What search learns from use (`core/usage.ts`), kept in the window's storage
// as the session is: habits belong to this computer, not the vault.

import { Usage } from "../core/usage.ts";

const KEY = "brock-usage";

function load(): Usage {
  try {
    return new Usage(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return new Usage();
  }
}

export const usage = load();

/** Writes it back; called after each change, which is at most a few times a minute. */
export function saveUsage(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    // Without storage search forgets what was chosen, and ranks by the words alone.
  }
}
