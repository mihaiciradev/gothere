import { MotionProvider } from "@/components/motion/motion-provider";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "./_components/site-header";

export default function AttendeeLayout({ children }: LayoutProps<"/">) {
  return (
    <MotionProvider>
      <div data-surface="attendee" className="flex min-h-full flex-1 flex-col bg-bg text-fg">
        <a
          href="#main"
          className="sr-only z-[60] bg-lime px-4 py-2 text-obsidian focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </MotionProvider>
  );
}
