import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DOCS, type DocMeta } from "@/content/docs";
import { site } from "./site";

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Placeholders in the Markdown become this deployment's real URLs. */
function fill(md: string): string {
  return md
    .replaceAll("{{API}}", site.convexSiteUrl)
    .replaceAll("{{APP}}", site.url)
    .replaceAll("{{MCP}}", site.mcpUrl)
    .replaceAll("{{KEYS}}", site.keysUrl)
    .replaceAll("{{GITHUB}}", site.github);
}

export function getDoc(slug: string): { meta: DocMeta; body: string; headings: Heading[] } | null {
  const meta = DOCS.find((d) => d.slug === slug);
  if (!meta) return null;
  const file = path.join(process.cwd(), "content", "docs", `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const body = fill(fs.readFileSync(file, "utf8"));
  const headings: Heading[] = [];
  let inCode = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) inCode = !inCode;
    if (inCode) continue;
    const m = /^(##|###)\s+(.+)$/.exec(line);
    if (m) headings.push({ depth: m[1] === "##" ? 2 : 3, text: m[2].replace(/`/g, ""), id: slugify(m[2]) });
  }
  return { meta, body, headings };
}

/** Search index for the sidebar: titles, descriptions and headings. */
export function searchIndex(): { slug: string; title: string; description: string; headings: { text: string; id: string }[] }[] {
  return DOCS.map((d) => {
    const doc = getDoc(d.slug);
    return { slug: d.slug, title: d.title, description: d.description, headings: (doc?.headings ?? []).map((h) => ({ text: h.text, id: h.id })) };
  });
}
