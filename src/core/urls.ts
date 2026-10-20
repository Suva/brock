// Web addresses written in a node's notes, to open them from the notes panel.

/** The http and https addresses in `text`, each once, in the order they come. */
export function webAddresses(text: string): string[] {
  const found = text.match(/\bhttps?:\/\/[^\s<>"'`]+/gi) ?? [];
  const cleaned = found.map((url) => {
    // Punctuation after an address belongs to the sentence, not the address:
    // "see https://example.com." A closing bracket stays if it has its opening
    // one in the address, as in Wikipedia's addresses.
    let out = url.replace(/[.,;:!?]+$/, "");
    while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) {
      out = out.slice(0, -1).replace(/[.,;:!?]+$/, "");
    }
    return out;
  });
  return [...new Set(cleaned)];
}
