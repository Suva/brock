// Types of changelog.mjs, for its tests: the script itself stays JavaScript,
// run by `npm version`, the release workflow and the site's build.

export const UNRELEASED: string;
export const PAGE: string;
export function releases(text: string): { version: string; date: string; body: string }[];
export function waiting(text: string): boolean;
export function dateRelease(text: string, version: string, date: string): string;
export function notes(text: string, version: string): string;
export function newer(a: string, b: string): boolean;
export function changesHtml(text: string, upTo?: string): string;
