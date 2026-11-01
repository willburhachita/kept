/**
 * Scam red flags in free text (deal descriptions, invite notes, evidence notes).
 * Pure and local: nothing is sent anywhere. These are warnings for humans, not
 * verdicts; Kept's real protection is that money only moves by the proved rules.
 */
import { site } from "./site";

export type FlagSeverity = "high" | "medium";

export interface RedFlag {
  id: string;
  severity: FlagSeverity;
  title: string;
  advice: string;
  /** The words that triggered it. */
  match: string;
}

const RULES: { id: string; severity: FlagSeverity; re: RegExp; title: string; advice: string }[] = [
  {
    id: "off_platform",
    severity: "high",
    re: /\b(western union|moneygram|gift ?cards?|itunes card|steam card|google play card|bitcoin|btc|usdt|tether|crypto(currency)?|wire (it|the money|transfer)|bank transfer|cash ?app|zelle|venmo|mobile money|airtel money|momo)\b/i,
    title: "Asks for payment outside PayPal",
    advice: "Kept only protects money held through PayPal. Anyone asking for gift cards, crypto or a direct transfer is stepping around the protection.",
  },
  {
    id: "credentials",
    severity: "high",
    re: /\b(password|passcode|pin code|one[- ]time (code|password)|otp|verification code|login details|card number|cvv|security code)\b/i,
    title: "Mentions passwords or codes",
    advice: "No real deal needs your password, PIN or a one-time code. Kept and PayPal will never ask for them.",
  },
  {
    id: "advance_fee",
    severity: "high",
    re: /\b(release fee|unlock fee|clearance fee|customs fee|activation fee|processing fee|transfer fee|pay (a|the) fee (to|before) (receive|release|unlock))\b/i,
    title: "Fee to release money",
    advice: "Kept takes its fee from released money automatically. There is never a separate fee you must pay to receive funds.",
  },
  {
    id: "overpayment",
    severity: "high",
    re: /\b(over ?pa(y|id|yment)|refund the (difference|rest|extra|balance)|send (back )?the (difference|rest|extra|change)|paid too much)\b/i,
    title: "Overpayment and refund-the-difference",
    advice: "Classic scam: a fake or reversible overpayment, then a real refund from you. With Kept the amount is fixed in the proved terms.",
  },
  {
    id: "urgency",
    severity: "medium",
    re: /\b(urgent(ly)?|immediately|right now|asap|today only|last chance|act fast|within (an|one|1|2|two) hours?|before (it'?s|its) too late)\b/i,
    title: "Pressure to hurry",
    advice: "Scammers rush people past checks. Every Kept promise has real deadlines written into the terms: take your time to read them.",
  },
  {
    id: "third_party",
    severity: "medium",
    re: /\b(my (agent|shipper|courier|lawyer|cousin|manager) will (pay|collect|send)|pay (my|the) (agent|courier|shipping company)|send it to my (friend|agent|partner))\b/i,
    title: "Money routed through a third party",
    advice: "The payee on a Kept promise is the person who approved the terms. Be wary if money is meant to reach someone else.",
  },
  {
    id: "too_good",
    severity: "medium",
    re: /\b(guaranteed (profit|returns?|income)|double your (money|investment)|risk[- ]free investment|investment opportunity|easy money)\b/i,
    title: "Promises that sound too good",
    advice: "Guaranteed returns are a hallmark of investment fraud. Kept is for paying for real work or goods, not investments.",
  },
];

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

/** Red flags found in `text`, most severe first. */
export function findRedFlags(text: string | null | undefined): RedFlag[] {
  if (!text) return [];
  const flags: RedFlag[] = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) flags.push({ id: r.id, severity: r.severity, title: r.title, advice: r.advice, match: m[0] });
  }
  const official = site.officialHost.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const outside = (text.match(URL_RE) ?? []).filter((u) => {
    try {
      const h = new URL(u).hostname;
      return !(official && h === official) && !h.endsWith("paypal.com");
    } catch {
      return true;
    }
  });
  if (outside.length) {
    flags.push({
      id: "outside_links",
      severity: "medium",
      title: "Links to other websites",
      advice: "Don't sign in or pay through links inside a deal. Open Kept and PayPal by typing their address yourself.",
      match: outside[0],
    });
  }
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

/** Checks a pasted link: is it really a Kept link, and what kind? */
export function inspectLink(raw: string): { ok: boolean; host: string | null; kind: "invite" | "contract" | "mandate" | "sim" | "other" | "invalid"; notes: string[] } {
  const notes: string[] = [];
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, host: null, kind: "invalid", notes: ["That isn't a complete link (it should start with https://)."] };
  }
  const official = site.officialHost.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const hostOk = official ? u.hostname === official : typeof window !== "undefined" && u.hostname === window.location.hostname;
  if (u.protocol !== "https:" && u.hostname !== "localhost") notes.push("The link isn't https: never enter details on an unencrypted page.");
  if (!hostOk) notes.push(`The address is ${u.hostname}, not the official Kept site${official ? ` (${official})` : ""}. Treat it as a phishing attempt.`);
  if (/@/.test(u.href.split("?")[0] ?? "")) notes.push("The link hides its real destination with an @ sign.");
  if (/xn--/.test(u.hostname)) notes.push("The address uses look-alike characters (punycode).");
  const kind = /^\/invite\//.test(u.pathname) ? "invite" : /^\/contracts\//.test(u.pathname) ? "contract" : /^\/mandates\//.test(u.pathname) ? "mandate" : /^\/sim\//.test(u.pathname) ? "sim" : "other";
  if (kind === "sim") notes.push("This is the payment simulator: it moves no real money and only exists in sandbox mode.");
  return { ok: hostOk && notes.length === 0, host: u.hostname, kind, notes };
}
