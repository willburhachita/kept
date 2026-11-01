import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { Statement } from "@/components/ui/type";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-6xl px-5 pb-32 pt-40">
        <Statement as="h1" lead="Every promise, kept." tail="Proved before anyone pays, held on PayPal, released only when the promise is kept." />
      </main>
      <SiteFooter />
    </>
  );
}
