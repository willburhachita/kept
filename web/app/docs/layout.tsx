import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs/sidebar";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { searchIndex } from "@/lib/docs";

export const metadata = { title: { default: "Documentation", template: "%s · Kept docs" } };

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <div className="mx-auto grid max-w-7xl gap-10 px-5 pb-24 pt-32 lg:grid-cols-[15rem_1fr]">
        <DocsSidebar index={searchIndex()} />
        <div className="min-w-0">{children}</div>
      </div>
      <SiteFooter />
    </>
  );
}
