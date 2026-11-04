/** Docs table of contents. Each slug has a Markdown file next to this one. */
export interface DocMeta {
  slug: string;
  title: string;
  section: "Start here" | "Integrate" | "Trust & safety" | "Reference";
  description: string;
}

export const DOCS: DocMeta[] = [
  { slug: "overview", title: "What Kept is", section: "Start here", description: "Payment promises that are proved before anyone pays, held on PayPal, and released only when kept." },
  { slug: "quickstart", title: "Quickstart", section: "Start here", description: "From API key to a settled promise on the PayPal sandbox in about ten minutes." },
  { slug: "concepts", title: "Core concepts", section: "Start here", description: "Promises, rules, proofs, holds, deliveries, windows, arbiters and receipts." },
  { slug: "embedding", title: "Embed Kept in your platform", section: "Integrate", description: "The integration pattern for marketplaces, freelance and home-services apps." },
  { slug: "api", title: "REST API reference", section: "Integrate", description: "Every endpoint, its auth, body, response and errors." },
  { slug: "sdk", title: "JavaScript SDK", section: "Integrate", description: "@kept/sdk: a typed client for contracts, evidence, agents, webhooks and receipts." },
  { slug: "webhooks", title: "Webhooks", section: "Integrate", description: "Signed notifications for every state change, and how to verify them." },
  { slug: "mcp", title: "AI agents & MCP", section: "Integrate", description: "Agent budgets (mandates), scoped tokens, the MCP server and the agent API." },
  { slug: "scam-protection", title: "Scam protection", section: "Trust & safety", description: "The threat model, what stops each attack, and a checklist for your integration." },
  { slug: "security", title: "Security model", section: "Trust & safety", description: "Who can move money, how secrets are kept, and what the AI is allowed to do." },
  { slug: "receipts", title: "Receipts & transparency", section: "Trust & safety", description: "Signed, hash-chained journals and a public Merkle log anyone can verify." },
  { slug: "fees", title: "Fees & money flows", section: "Reference", description: "Exactly what PayPal holds, captures, pays out, voids and refunds, with worked numbers." },
  { slug: "contract-language", title: "Contract language", section: "Reference", description: "The small typed language Claude writes and the verifier proves." },
  { slug: "faq", title: "FAQ", section: "Reference", description: "Short answers to the questions people ask before they pay." },
];

export const SECTIONS = ["Start here", "Integrate", "Trust & safety", "Reference"] as const;
