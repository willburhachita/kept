import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight } from "sugar-high";
import { CopyButton } from "@/components/ui/copy";

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object" && "props" in node) return text((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Docs Markdown: GFM tables, anchored headings, highlighted code with copy buttons, internal links. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-kept">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children: c }) => (
            <h2 id={slug(text(c))}>
              <a href={`#${slug(text(c))}`} className="no-underline">
                {c}
              </a>
            </h2>
          ),
          h3: ({ children: c }) => <h3 id={slug(text(c))}>{c}</h3>,
          a: ({ href = "", children: c }: ComponentProps<"a">) =>
            href.startsWith("/") ? (
              <Link href={href}>{c}</Link>
            ) : (
              <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel={href.startsWith("#") ? undefined : "noopener noreferrer"}>
                {c}
              </a>
            ),
          pre: ({ children: c }) => {
            const code = text(c).replace(/\n$/, "");
            const lang = (c as { props?: { className?: string } } | undefined)?.props?.className?.replace("language-", "") ?? "";
            const html = ["ts", "tsx", "js", "javascript", "typescript", "json", "jsx"].includes(lang) ? highlight(code) : null;
            return (
              <div className="group relative">
                {lang && <span className="absolute left-4 top-2.5 font-mono text-[10px] uppercase tracking-wider text-white/35">{lang}</span>}
                <CopyButton value={code} dark className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" />
                {/* sugar-high escapes the code it highlights; the input is our own docs. */}
                <pre className={lang ? "pt-8" : undefined}>{html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}</pre>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
