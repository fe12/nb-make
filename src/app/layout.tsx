import type { Metadata, Viewport } from 'next';
import { Caveat, Nunito } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import mark from '@/img/mark.png';
import { HeaderAccount } from '@/components/shell/HeaderAccount';
import { ThemePicker } from '@/components/ThemePicker';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/lib/client/auth';
import { SyncProvider } from '@/lib/client/sync-context';
import './globals.css';

// Self-hosted at build time — no runtime request leaves the machine.
const body = Nunito({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const hand = Caveat({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-hand',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'nb-make — printable notebook layouts',
  description:
    'Design notebook pages, arrange them, impose them onto A4 and export a print-ready PDF. Share what you build.',
  // icon.png / apple-icon.png / favicon.ico in this folder are picked up by
  // Next's file convention; only the manifest needs pointing at.
  manifest: '/manifest.webmanifest',
  applicationName: 'nb-make',
};

export const viewport: Viewport = {
  themeColor: '#2f5d8a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${hand.variable}`}>
      <body className="min-h-screen antialiased">
        {/*
          Auth wraps Sync, which wraps everything: the sync engine reacts to the
          session, and the editor's own store sits inside both so a push can be
          scheduled the moment a notebook is written.
        */}
        <ThemeProvider>
          <AuthProvider>
            <SyncProvider>
              <div className="flex min-h-screen flex-col">
                <header className="sticky top-0 z-40 border-b-2 border-dashed border-ink-300 bg-paper/90 backdrop-blur">
                  <div className="punch-holes h-2 w-full opacity-70" aria-hidden />
                  <div className="mx-auto flex h-14 w-full max-w-[1800px] items-center gap-4 px-5">
                    <Link href="/" className="group flex items-center gap-2.5">
                      {/*
                        Statically imported so Next knows the intrinsic size and
                        can serve a correctly scaled, cached copy rather than the
                        1 MB master. `priority` because it is above the fold on
                        the very first paint.
                      */}
                      <Image
                        src={mark}
                        alt=""
                        width={34}
                        height={34}
                        priority
                        className="-rotate-3 drop-shadow-[1px_2px_0_color-mix(in_srgb,var(--nb-ink-800)_25%,transparent)] transition-transform group-hover:rotate-0"
                      />
                      <span className="font-display text-[22px] leading-none tracking-tight text-ink-900 group-hover:text-accent-600">
                        nb-make
                      </span>
                    </Link>
                    <span className="hidden text-[12px] text-ink-500 lg:block">
                      Printable notebook layouts
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <ThemePicker />
                      <HeaderAccount />
                    </div>
                  </div>
                </header>
                <main className="flex flex-1 flex-col">{children}</main>
              </div>
            </SyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
