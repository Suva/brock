// A pane of the window: the map open in it, the node selected there and the
// one being edited, whether it shows as a map or an outline, and where it has
// been, for back and forward. The window has one pane for now; split view
// (PLAN.md) gives it two, each with its own, over the one vault.

import { History, type Place } from "../core/history.ts";
import type { MapViewApi } from "./MapView.svelte";
import type { Live } from "./live.svelte.ts";
import type { PanePlace, View } from "./session.ts";
import { saveUsage, usage } from "./usage.ts";

export type { View };

let made = 0;

export class Pane {
  /**
   * Names this pane for as long as the window is open, whatever its place:
   * the map view keeps where each pane looked at each map by it, so a pane
   * that moves to first place when the other closes keeps its own.
   */
  readonly key = made++;
  readonly #live: Live;
  /** The map opened; null for the top of the vault. */
  openedMap = $state<string | null>(null);
  selected = $state<string | null>(null);
  /** The node whose title is being edited on the map. */
  editing = $state<string | null>(null);
  view = $state<View>("map");
  /** The pane's map view while it shows as a map, for pictures and drags from the other pane; set by `bind:this`. */
  mapView = $state.raw<MapViewApi | null>(null);

  // Back and forward go through the maps visited.
  readonly #history = new History();
  /** Goes up with each step through the history, for the buttons to know. */
  #historyVersion = $state(0);

  constructor(live: Live, start: PanePlace) {
    this.#live = live;
    this.openedMap = start.map;
    this.selected = start.node ?? start.map;
    this.view = start.view;
  }

  /** The map on screen: the one opened, or the nearest map above it if an edit took it away. */
  readonly mapId = $derived.by(() => {
    void this.#live.version;
    const vault = this.#live.vault;
    let node = vault.get(this.openedMap ?? vault.rootId);
    while (node) {
      if (node.isMap && vault.isLive(node.id)) return node.id;
      node = node.parentId === null ? undefined : vault.get(node.parentId);
    }
    return vault.rootId;
  });

  /**
   * After a change from anywhere (an agent, an undo, the other pane): a
   * selected node that has gone falls back to the map's centre, and an edit
   * of one ends. A map that has gone needs nothing: `mapId` is then the map
   * above it, and what was selected in it went with it.
   */
  repair(): void {
    const vault = this.#live.vault;
    if (this.editing !== null && !vault.isLive(this.editing)) this.editing = null;
    if (this.selected !== null && !vault.isLive(this.selected)) this.selected = this.mapId;
  }

  get canGoBack(): boolean {
    void this.#historyVersion;
    return this.#history.canGoBack;
  }

  get canGoForward(): boolean {
    void this.#historyVersion;
    return this.#history.canGoForward;
  }

  /** Opens `map` with `node` selected, remembering where this was for going back. */
  moveTo(map: string, node: string): void {
    this.editing = null;
    if (map !== this.mapId) {
      this.#history.leave({ map: this.mapId, node: this.selected });
      this.#historyVersion++;
      // Maps opened often come first in search.
      usage.visit(map);
      saveUsage();
    }
    this.openedMap = map;
    this.selected = node;
  }

  /** Opens a map; coming back out selects the portal that was gone in by. */
  open(id: string): void {
    this.moveTo(id, this.#live.vault.portalToward(id, this.mapId) ?? id);
  }

  step(direction: "back" | "forward"): void {
    const vault = this.#live.vault;
    const here: Place = { map: this.mapId, node: this.selected };
    const exists = (p: Place) => vault.isLive(p.map) && vault.get(p.map)!.isMap;
    const to = direction === "back" ? this.#history.back(here, exists) : this.#history.forward(here, exists);
    this.#historyVersion++;
    if (!to) return;
    this.editing = null;
    this.openedMap = to.map;
    this.selected = to.node && vault.isLive(to.node) ? to.node : to.map;
  }

  /** Back out to the map this one is in. */
  up(): void {
    const parent = this.#live.vault.mapOf(this.mapId);
    if (parent) this.open(parent);
  }

  /**
   * Goes to a node found by searching or listed somewhere: a map opens; any
   * other node is selected in the map it is in, with the branches above it
   * unfolded.
   */
  goTo(id: string): void {
    const vault = this.#live.vault;
    const node = vault.get(id);
    if (!node || !vault.isLive(id)) return;
    if (node.isMap) return this.open(id);
    // A map is counted as it opens, in moveTo.
    usage.visit(id);
    saveUsage();
    const map = vault.mapOf(id)!;
    const above = vault.ancestors(id);
    const foldedAbove = above.slice(above.findIndex((n) => n.id === map) + 1).filter((n) => n.collapsed);
    if (foldedAbove.length) vault.transact(() => foldedAbove.forEach((n) => vault.update(n.id, { collapsed: false })));
    this.moveTo(map, id);
  }
}
