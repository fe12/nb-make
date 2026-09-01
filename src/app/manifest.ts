import type { MetadataRoute } from 'next';

/**
 * Lets the app be installed as a standalone window, which suits a local tool
 * you keep open next to a printer far better than a browser tab.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'nb-make — printable notebook layouts',
    short_name: 'nb-make',
    description:
      'Design notebook pages, arrange them, impose them onto printable sheets and export a print-ready PDF. Everything stays in your browser.',
    start_url: '/',
    display: 'standalone',
    background_color: '#eef2f6',
    theme_color: '#2f5d8a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
