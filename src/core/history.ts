// Where you have been: the maps visited, for going back and forward as a
// browser does. Going somewhere new forgets what was ahead.

export interface Place {
  /** The map that was open. */
  map: string;
  /** The node selected in it. */
  node: string | null;
}

const LIMIT = 100;

export class History {
  #back: Place[] = [];
  #forward: Place[] = [];

  get canGoBack(): boolean {
    return this.#back.length > 0;
  }

  get canGoForward(): boolean {
    return this.#forward.length > 0;
  }

  /** Leaving `from` for another map: it is where back goes. */
  leave(from: Place): void {
    if (this.#back.at(-1)?.map === from.map) this.#back.pop();
    this.#back.push(from);
    if (this.#back.length > LIMIT) this.#back.shift();
    this.#forward = [];
  }

  /**
   * The place before `here`, which becomes the place forward goes to; null
   * if there is none. Places for which `exists` is false, maps deleted since,
   * are passed over.
   */
  back(here: Place, exists: (p: Place) => boolean): Place | null {
    return this.#step(this.#back, this.#forward, here, exists);
  }

  forward(here: Place, exists: (p: Place) => boolean): Place | null {
    return this.#step(this.#forward, this.#back, here, exists);
  }

  #step(from: Place[], to: Place[], here: Place, exists: (p: Place) => boolean): Place | null {
    while (from.length) {
      const place = from.pop()!;
      if (!exists(place) || place.map === here.map) continue;
      to.push(here);
      return place;
    }
    return null;
  }
}
