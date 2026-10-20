// Web addresses written in a node's notes, to open them from the notes panel.

/** The http and https addresses in `text`, each once, in the order they come. */
export function webAddresses(text: string): string[] {
  const found = text.match(/\bhttps?:\/\/[^\s<>"'`]+/gi) ?? [];
  return [...new Set(found.map(trimUrl))];
}

/**
 * An address without the punctuation after it, which belongs to the
 * sentence: "see https://example.com." A closing bracket stays if it has its
 * opening one in the address, as in Wikipedia's addresses.
 */
export function trimUrl(url: string): string {
  let out = url.replace(/[.,;:!?]+$/, "");
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) {
    out = out.slice(0, -1).replace(/[.,;:!?]+$/, "");
  }
  return out;
}
