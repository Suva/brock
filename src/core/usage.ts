// What search learns from use: which nodes are gone to often and lately,
// and which node was chosen for what was typed, so that typing "pro" again
// puts first the node chosen the last times. It belongs to one computer, not
// the vault: visits are not edits, and are never undone, saved or synced.
// Counts fade with time, so old habits give way to new ones.

import { fold } from "./search.ts";

interface Count {
  /** How many times, each faded by the time since, as of `last`. */
  count: number;
  last: number;
}

export interface UsageData {
  visits: Record<string, Count>;
  /** Per query, as folded: the nodes chosen for it. */
  picks: Record<string, Record<string, Count>>;
}

const DAY = 24 * 60 * 60 * 1000;
/** A visit counts half as much after two weeks; a pick after a month. */
const VISIT_HALF_LIFE = 14 * DAY;
const PICK_HALF_LIFE = 30 * DAY;
/** Enough to remember the places in use, small enough to never matter. */
const MOST_VISITS = 300;
const MOST_QUERIES = 300;
const MOST_PICKS_PER_QUERY = 5;

/**
 * The most use can add to a node's score. Visits stay under what a title
 * match is worth over a match in the text; a node chosen for the very same
 * query may pass an exact title, as choosing it again and again says.
 */
export const MOST_VISIT_BOOST = 2;
export const MOST_PICK_BOOST = 8;

function faded(c: Count, now: number, halfLife: number): number {
  return c.count * 0.5 ** (Math.max(0, now - c.last) / halfLife);
}

function bump(c: Count | undefined, now: number, halfLife: number): Count {
  return { count: (c ? faded(c, now, halfLife) : 0) + 1, last: now };
}

/** The query as it is remembered: folded, its spaces made one. */
function key(query: string): string {
  return fold(query).trim().replace(/\s+/g, " ");
}

/** Keeps the `most` entries worth the most now. */
function trim<T>(entries: Record<string, T>, most: number, worth: (t: T) => number): Record<string, T> {
  const all = Object.entries(entries);
  if (all.length <= most) return entries;
  return Object.fromEntries(all.sort((a, b) => worth(b[1]) - worth(a[1])).slice(0, most));
}

export class Usage {
  #data: UsageData;
  #now: () => number;

  constructor(data?: unknown, now: () => number = Date.now) {
    this.#data = checked(data);
    this.#now = now;
  }

  /** A node gone to: a map opened, or a node chosen in search. */
  visit(id: string): void {
    const now = this.#now();
    const { visits } = this.#data;
    visits[id] = bump(visits[id], now, VISIT_HALF_LIFE);
    this.#data.visits = trim(visits, MOST_VISITS, (c) => faded(c, now, VISIT_HALF_LIFE));
  }

  /** A node chosen in search for `query`. Nothing is learnt from an empty one. */
  pick(query: string, id: string): void {
    const q = key(query);
    if (!q) return;
    const now = this.#now();
    const { picks } = this.#data;
    const chosen = picks[q] ?? {};
    chosen[id] = bump(chosen[id], now, PICK_HALF_LIFE);
    picks[q] = trim(chosen, MOST_PICKS_PER_QUERY, (c) => faded(c, now, PICK_HALF_LIFE));
    this.#data.picks = trim(picks, MOST_QUERIES, (p) =>
      Math.max(...Object.values(p).map((c) => faded(c, now, PICK_HALF_LIFE))),
    );
  }

  /**
   * What use adds to a node's score for `query`, as a function of the node:
   * made once per search, as it runs for every node found. Choices made for
   * the same query count fully; for one that starts the other ("pro" and
   * "proj"), half. One choice gives half the most, two or more all of it.
   */
  boostFor(query: string): (id: string) => number {
    const now = this.#now();
    const q = key(query);
    const picks = new Map<string, number>();
    if (q) {
      for (const [k, chosen] of Object.entries(this.#data.picks)) {
        if (!(k.startsWith(q) || q.startsWith(k))) continue;
        const share = k === q ? 1 : 0.5;
        for (const [id, c] of Object.entries(chosen)) {
          const b = MOST_PICK_BOOST * share * Math.min(1, faded(c, now, PICK_HALF_LIFE) / 2);
          picks.set(id, Math.max(picks.get(id) ?? 0, b));
        }
      }
    }
    const { visits } = this.#data;
    return (id) => {
      const visit = visits[id];
      // Two visits lately give a little; it grows slowly after that.
      const v = visit ? Math.min(MOST_VISIT_BOOST, Math.log2(1 + faded(visit, now, VISIT_HALF_LIFE)) / 2) : 0;
      return v + (picks.get(id) ?? 0);
    };
  }

  /** How often lately, for ordering what to go to before anything is typed. */
  frecency(id: string): number {
    const visit = this.#data.visits[id];
    return visit ? faded(visit, this.#now(), VISIT_HALF_LIFE) : 0;
  }

  /** Plain data, for keeping in storage. */
  toJSON(): UsageData {
    return this.#data;
  }
}

/** Usage read back from storage, which can hold anything: what is not a count is dropped. */
function checked(data: unknown): UsageData {
  const out: UsageData = { visits: {}, picks: {} };
  if (!data || typeof data !== "object") return out;
  const { visits, picks } = data as Partial<Record<keyof UsageData, unknown>>;
  const counts = (raw: unknown): Record<string, Count> => {
    const kept: Record<string, Count> = {};
    if (!raw || typeof raw !== "object") return kept;
    for (const [id, c] of Object.entries(raw)) {
      const { count, last } = (c ?? {}) as Partial<Count>;
      if (typeof count === "number" && count > 0 && typeof last === "number") kept[id] = { count, last };
    }
    return kept;
  };
  out.visits = counts(visits);
  if (picks && typeof picks === "object") {
    for (const [q, chosen] of Object.entries(picks)) {
      const kept = counts(chosen);
      if (Object.keys(kept).length) out.picks[q] = kept;
    }
  }
  return out;
}
