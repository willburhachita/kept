"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Check, KeyRound, Plus, Webhook, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyButton, Hash, SecretReveal } from "@/components/ui/copy";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { RelativeTime } from "@/components/ui/time";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/type";
import { api, type Id } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const EVENT_GROUPS = [
  { value: "*", label: "Everything" },
  { value: "contract.*", label: "Contract lifecycle" },
  { value: "terms.*", label: "Terms verified / approved" },
  { value: "funding.*", label: "Funding" },
  { value: "paypal.*", label: "PayPal movements" },
  { value: "evidence.*", label: "Deliveries and reviews" },
  { value: "mandate.*", label: "Agent budgets" },
  { value: "spend.*", label: "Agent purchases" },
];

function Profile() {
  const viewer = useQuery(api.users.viewer);
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!viewer) return <Skeleton className="h-48 rounded-card" />;
  const n = name ?? viewer.displayName;
  const p = payout ?? viewer.payoutEmail ?? "";
  async function save(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await update({ displayName: n.trim(), payoutEmail: p.trim() ? p.trim() : null });
      toast({ title: "Profile saved", tone: "ok" });
    } catch (err) {
      toast({ title: "Couldn't save", body: errorMessage(err), tone: "bad" });
    } finally {
      setPending(false);
    }
  }
  return (
    <Card id="profile">
      <CardHeader eyebrow="Profile" title={viewer.email} />
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" hint="What the other side of a promise sees.">
          {(pp) => <Input {...pp} value={n} onChange={(e) => setName(e.target.value)} maxLength={80} />}
        </Field>
        <Field label="PayPal payout email" hint="Where you get paid. Locked into each promise when you approve it.">
          {(pp) => <Input {...pp} type="email" value={p} onChange={(e) => setPayout(e.target.value)} placeholder="you@paypal-email.com" />}
        </Field>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <p className="text-xs text-muted">
            Role: {viewer.role} · member since <RelativeTime at={viewer.createdAt} />
          </p>
          <Button type="submit" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ApiKeys() {
  const keys = useQuery(api.apiKeys.list);
  const create = useAction(api.apiKeys.create);
  const revoke = useMutation(api.apiKeys.revoke);
  const toast = useToast();
  const [label, setLabel] = useState("server");
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Id<"apiKeys"> | null>(null);
  return (
    <Card id="api-keys">
      <CardHeader eyebrow="REST API" title="API keys" />
      <p className="-mt-2 mb-5 text-sm text-muted">
        Server-side only. Send as <code className="font-mono text-xs">Authorization: Bearer sk_…</code> to <code className="font-mono text-xs">{site.apiBase}</code>.
      </p>
      {secret && <SecretReveal value={secret} title="New API key" />}
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            const r = await create({ label });
            setSecret(r.key);
          } catch (err) {
            toast({ title: "Couldn't create a key", body: errorMessage(err), tone: "bad" });
          } finally {
            setPending(false);
          }
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Key label" maxLength={80} />
        <Button type="submit" loading={pending} icon={<Plus className="size-4" />}>
          Create key
        </Button>
      </form>
      <ul className="mt-4 divide-y divide-line">
        {keys?.map((k) => (
          <li key={k._id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm">
                <KeyRound className="size-3.5 text-muted" /> <code className="font-mono text-xs">{k.prefix}…</code> {k.label}
              </p>
              <p className="text-xs text-muted">
                created <RelativeTime at={k.createdAt} /> · {k.lastUsedAt ? <>last used <RelativeTime at={k.lastUsedAt} /></> : "never used"}
              </p>
            </div>
            {k.revoked ? (
              <Chip tone="neutral">Revoked</Chip>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setRevoking(k._id)}>
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Revoke this key?"
        description="Requests using it start failing immediately. This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  if (revoking) await revoke({ keyId: revoking });
                  toast({ title: "Key revoked", tone: "ok" });
                } catch (e) {
                  toast({ title: "Couldn't revoke", body: errorMessage(e), tone: "bad" });
                }
                setRevoking(null);
              }}
            >
              Revoke key
            </Button>
          </>
        }
      />
    </Card>
  );
}

function Deliveries({ endpointId }: { endpointId: Id<"webhookEndpoints"> }) {
  const rows = useQuery(api.outbound.recentDeliveries, { endpointId });
  if (rows === undefined) return <Skeleton className="h-10" />;
  if (!rows.length) return <p className="text-xs text-muted">No deliveries yet.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.slice(0, 8).map((d) => (
        <li key={d._id} className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-2">
            {d.status === "delivered" ? <Check className="size-3 text-ok" /> : d.status === "failed" ? <X className="size-3 text-bad" /> : <span className="size-3 rounded-full border border-line-2" />}
            <code className="font-mono">{d.eventType}</code>
          </span>
          <span className="text-muted">
            {d.responseStatus ? `HTTP ${d.responseStatus}` : (d.lastError ?? d.status)} · {d.attempts} tr{d.attempts === 1 ? "y" : "ies"} · <RelativeTime at={d.createdAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Webhooks() {
  const eps = useQuery(api.outbound.listEndpoints);
  const create = useAction(api.outbound.createEndpoint);
  const del = useMutation(api.outbound.deleteEndpoint);
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["*"]);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (v: string) => setEvents((xs) => (v === "*" ? ["*"] : xs.includes(v) ? xs.filter((x) => x !== v) : [...xs.filter((x) => x !== "*"), v]));
  return (
    <Card id="webhooks">
      <CardHeader eyebrow="Webhooks" title="Get every state change, signed" />
      <p className="-mt-2 mb-5 text-sm text-muted">Standard Webhooks signatures (HMAC-SHA256). Verify them with <code className="font-mono text-xs">verifyWebhook</code> from @kept/sdk before trusting a payload. HTTPS only; private addresses are blocked.</p>
      {secret && <SecretReveal value={secret} title="Signing secret" />}
      <form
        className="mt-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            const r = await create({ url: url.trim(), events: events.length ? events : ["*"] });
            setSecret(r.secret);
            setUrl("");
          } catch (err) {
            toast({ title: "Couldn't add the endpoint", body: errorMessage(err), tone: "bad" });
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex gap-2">
          <Input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.com/webhooks/kept" aria-label="Endpoint URL" />
          <Button type="submit" loading={pending} icon={<Webhook className="size-4" />}>
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_GROUPS.map((g) => (
            <button key={g.value} type="button" onClick={() => toggle(g.value)} className={cn("rounded-full px-3 py-1 text-xs transition-colors", events.includes(g.value) ? "bg-ink text-white" : "bg-black/[0.05] text-muted hover:text-ink")}>
              {g.label}
            </button>
          ))}
        </div>
      </form>
      <ul className="mt-5 space-y-2">
        {eps?.map((ep) => (
          <li key={ep._id} className="rounded-2xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-ink">{ep.url}</p>
                <p className="mt-1 text-xs text-muted">
                  {ep.events.join(", ")} · {ep.failures} recent failures
                </p>
              </div>
              <div className="flex items-center gap-1">
                {ep.disabledAt ? (
                  <Chip tone="neutral">Disabled</Chip>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(open === ep._id ? null : ep._id)}>
                      {open === ep._id ? "Hide log" : "Delivery log"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await del({ endpointId: ep._id });
                          toast({ title: "Endpoint disabled", tone: "ok" });
                        } catch (e) {
                          toast({ title: "Couldn't disable it", body: errorMessage(e), tone: "bad" });
                        }
                      }}
                    >
                      Disable
                    </Button>
                  </>
                )}
              </div>
            </div>
            {open === ep._id && (
              <div className="mt-3 border-t border-line pt-3">
                <Deliveries endpointId={ep._id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Transparency() {
  const t = useQuery(api.transparency.checkpoints, { limit: 6 });
  return (
    <Card id="transparency">
      <CardHeader eyebrow="Transparency log" title="Public checkpoints" />
      <p className="-mt-2 mb-4 text-sm text-muted">Every journal entry from every promise is sealed into a signed Merkle checkpoint (RFC 6962), so history can't be rewritten quietly, even by Kept.</p>
      {t === undefined ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          <div className="tabular mb-4 flex flex-wrap gap-1.5">
            <Chip tone="neutral">Latest #{t.latestSeq}</Chip>
            <Chip tone="neutral">{String(t.pendingEntries)} entries waiting for the next seal</Chip>
            <Chip tone="neutral">key {t.keyId}</Chip>
          </div>
          <ul className="divide-y divide-line">
            {t.checkpoints.map((c) => (
              <li key={c.seq} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                <span className="flex items-center gap-2">
                  {c.signatureValid && c.hashValid ? <Check className="size-3.5 text-ok" /> : <X className="size-3.5 text-bad" />}#{c.seq} · {c.size} entries
                </span>
                <span className="flex items-center gap-2 text-muted">
                  root <Hash value={c.root} chars={12} /> · <RelativeTime at={c.at} />
                </span>
              </li>
            ))}
            {t.checkpoints.length === 0 && <li className="py-2 text-xs text-muted">The first checkpoint is sealed within 10 minutes of the first activity.</li>}
          </ul>
        </>
      )}
    </Card>
  );
}

function Snippets() {
  const curl = `curl ${site.apiBase}/me -H "Authorization: Bearer $KEPT_API_KEY"`;
  const sdk = `npm i @kept/sdk\n\nconst kept = new Kept({ baseUrl: "${site.convexSiteUrl}", apiKey: process.env.KEPT_API_KEY });`;
  return (
    <Card tone="dark">
      <p className="eyebrow text-white/45">Quick start</p>
      {[curl, sdk].map((s) => (
        <div key={s} className="mt-4 flex items-start gap-2 rounded-xl bg-white/[0.06] p-3">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-white/85">{s}</pre>
          <CopyButton value={s} dark />
        </div>
      ))}
      <Button href="/docs/quickstart" variant="inverse" size="sm" className="mt-5">
        Read the quickstart
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings & developers" description="Your profile, plus everything you need to run Kept inside your own platform." />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Profile />
          <ApiKeys />
          <Webhooks />
        </div>
        <aside className="space-y-4">
          <Snippets />
          <Transparency />
        </aside>
      </div>
    </>
  );
}
