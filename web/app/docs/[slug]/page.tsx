import { ArrowLeft, ArrowRight, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/docs/markdown";
import { Toc } from "@/components/docs/sidebar";
import { DOCS } from "@/content/docs";
import { getDoc } from "@/lib/docs";
import { site } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = DOCS.find((x) => x.slug === slug);
  return d ? { title: d.title, description: d.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  const i = DOCS.findIndex((d) => d.slug === slug);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
      <article className="min-w-0 max-w-3xl">
        <p className="eyebrow">{doc.meta.section}</p>
        <h1 className="mt-3 text-[clamp(2.25rem,4.5vw,3.25rem)] leading-[1.04] tracking-[-0.05em]">{doc.meta.title}</h1>
        <p className="mt-3 text-lg leading-relaxed tracking-[-0.025em] text-muted">{doc.meta.description}</p>
        <div className="mt-10">
          <Markdown>{doc.body}</Markdown>
        </div>
        <div className="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="group rounded-card bg-surface p-5">
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <ArrowLeft className="size-3.5" /> Previous
              </span>
              <span className="mt-1 block text-[15px] text-ink">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="group rounded-card bg-surface p-5 text-right">
              <span className="flex items-center justify-end gap-1.5 text-xs text-muted">
                Next <ArrowRight className="size-3.5" />
              </span>
              <span className="mt-1 block text-[15px] text-ink">{next.title}</span>
            </Link>
          )}
        </div>
        <a href={`${site.github}/blob/main/web/content/docs/${slug}.md`} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <PenLine className="size-3.5" /> Improve this page on GitHub
        </a>
      </article>
      <Toc headings={doc.headings} />
    </div>
  );
}
