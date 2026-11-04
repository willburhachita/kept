import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/ui/copy";
import { SectionLabel, Statement } from "@/components/ui/type";
import { DOCS, SECTIONS } from "@/content/docs";
import { site } from "@/lib/site";

export default function DocsHome() {
  const snippet = `npm i @kept/sdk`;
  return (
    <div>
      <SectionLabel index="00">Documentation</SectionLabel>
      <Statement as="h1" className="mt-5 max-w-3xl" lead="Put verified payment promises inside your own platform." tail="One API key, a few calls, and every cent is accounted for." />
      <div className="mt-10 grid gap-3 md:grid-cols-[1.3fr_1fr]">
        <Link href="/docs/quickstart" className="group flex flex-col justify-between rounded-card bg-ink p-7 text-white">
          <p className="eyebrow text-white/45">Start here</p>
          <div className="mt-10">
            <p className="text-2xl tracking-[-0.04em]">Quickstart: a settled promise in ten minutes</p>
            <p className="mt-2 text-sm text-white/55">API key, create, invite, fund on the sandbox, deliver, settle.</p>
          </div>
          <ArrowUpRight className="mt-6 size-5 text-white/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
        <div className="flex flex-col justify-between gap-6 rounded-card bg-surface p-7">
          <div>
            <p className="eyebrow">Install</p>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-sunken px-3 py-2">
              <code className="flex-1 font-mono text-sm">{snippet}</code>
              <CopyButton value={snippet} />
            </div>
          </div>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted">API base</dt>
              <dd className="break-all font-mono text-ink-2">{site.apiBase}</dd>
            </div>
            <div>
              <dt className="text-muted">MCP endpoint</dt>
              <dd className="break-all font-mono text-ink-2">{site.mcpUrl}</dd>
            </div>
          </dl>
        </div>
      </div>
      {SECTIONS.map((s) => (
        <section key={s} className="mt-14">
          <p className="eyebrow mb-4">{s}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {DOCS.filter((d) => d.section === s).map((d) => (
              <Link key={d.slug} href={`/docs/${d.slug}`} className="group rounded-card bg-surface p-6 transition-shadow hover:shadow-lift">
                <p className="flex items-center justify-between text-[17px] tracking-[-0.03em]">
                  {d.title} <ArrowUpRight className="size-4 text-faint group-hover:text-ink" />
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{d.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
