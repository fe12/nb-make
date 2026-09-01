export interface AssetMeta {
  id: string;
  name: string;
  /** `image/png` or `image/jpeg` — the two formats pdf-lib can embed. */
  mime: string;
  /** Intrinsic pixel dimensions, needed to honour aspect ratio on the page. */
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

export type AssetIndex = Record<string, AssetMeta>;

export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;

/**
 * Resolves an asset id to something an `<img>` can load.
 *
 * Image bytes live in IndexedDB, so the real answer is a blob URL that only the
 * browser session knows about. The SVG renderer is shared with Node (where
 * images are embedded from bytes, not URLs), so it asks through this indirection
 * rather than depending on the browser store.
 */
let resolveAssetUrl: (id: string) => string = () => '';

export function setAssetUrlResolver(resolver: (id: string) => string): void {
  resolveAssetUrl = resolver;
}

/**
 * Fallback URLs for images this browser does not hold.
 *
 * Viewing someone else's published notebook means rendering images that live in
 * *their* IndexedDB, so publishing uploads them and records the public URLs.
 * The local blob URL always wins when there is one -- it is already in memory
 * and works offline -- and this is consulted only when there is not.
 */
const remoteAssetUrls = new Map<string, string>();

export function registerRemoteAssets(urls: Record<string, string>): void {
  for (const [id, url] of Object.entries(urls)) remoteAssetUrls.set(id, url);
}

export function clearRemoteAssets(): void {
  remoteAssetUrls.clear();
}

export const assetUrl = (id: string): string =>
  resolveAssetUrl(id) || remoteAssetUrls.get(id) || '';

/** Intrinsic aspect ratio, defaulting to 4:3 when the asset is unknown. */
export function aspectOf(index: AssetIndex, id: string): number {
  const meta = index[id];
  if (!meta || meta.height === 0) return 4 / 3;
  return meta.width / meta.height;
}
