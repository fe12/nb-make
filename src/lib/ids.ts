import { customAlphabet } from 'nanoid';

// Lowercase alphanumerics only: ids end up in filesystem paths and URLs, so
// avoiding case-sensitivity and URL-escaping issues is worth the tiny loss of
// entropy per character.
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const generate = customAlphabet(alphabet, 12);

export const newId = (prefix?: string): string =>
  prefix ? `${prefix}_${generate()}` : generate();

/** Guards ids that arrive from route params before they touch the filesystem. */
export const isSafeId = (value: string): boolean => /^[a-z0-9_]{1,64}$/.test(value);
