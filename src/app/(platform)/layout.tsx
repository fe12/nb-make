import { AppSidebar, MobileNav } from '@/components/shell/AppSidebar';

/**
 * Shell for the platform pages.
 *
 * A route group, so the sidebar wraps the library, community, saved, settings
 * and admin without adding a segment to any URL — `/community` stays
 * `/community`. The notebook editor lives outside this group deliberately: it
 * needs the full window for the page canvas.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-1">
      <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 border-r-2 border-dashed border-ink-200 md:block">
        <AppSidebar />
      </aside>
      <div className="min-w-0 flex-1">
        <MobileNav />
        {children}
      </div>
    </div>
  );
}
