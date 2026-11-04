"use client";

import { formatCents, type Currency } from "@kept/core";
import { FlaskConical, ShieldAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";

const ORDER = /^SIMORD_(\d+)_([A-Z]{3})_([A-Za-z0-9-]+)_[0-9A-F]+$/;

/** Only follow redirects back into this site: a simulator must never become an open redirect. */
function sameOrigin(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin ? u.toString() : null;
  } catch {
    return null;
  }
}

function Simulator() {
  const params = useSearchParams();
  const [leaving, setLeaving] = useState<"approve" | "cancel" | null>(null);
  const token = params.get("token") ?? "";
  const order = useMemo(() => {
    const m = ORDER.exec(token);
    return m ? { cents: Number(m[1]), currency: m[2] as Currency, reference: m[3] } : null;
  }, [token]);
  const back = typeof window === "undefined" ? null : sameOrigin(params.get("return"));
  const cancel = typeof window === "undefined" ? null : sameOrigin(params.get("cancel"));
  const isMandate = Boolean(back && /\/mandates\//.test(back));

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center justify-between">
        <Logo />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-tint px-3 py-1.5 text-xs font-medium text-warn">
          <FlaskConical className="size-3.5" /> Sandbox simulator
        </span>
      </div>

      <div className="mt-8 rounded-card bg-surface p-7">
        <p className="eyebrow">Kept payment simulator</p>
        {order ? (
          <>
            <p className="mt-4 text-sm text-muted">{isMandate ? "Hold for an agent budget" : "Hold for a promise"}</p>
            <p className="tabular mt-1 text-[3rem] leading-none tracking-[-0.06em]">{formatCents(order.cents, order.currency)}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Approving here plays the part of approving on paypal.com, so you can try the whole flow without a PayPal account. <strong className="font-medium text-ink">No real money moves.</strong>
            </p>
            <dl className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Reference</dt>
                <dd className="truncate font-mono text-xs text-ink-2">{order.reference}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Order</dt>
                <dd className="truncate font-mono text-xs text-ink-2">{token.slice(0, 28)}…</dd>
              </div>
            </dl>
            {back && cancel ? (
              <div className="mt-7 grid gap-2">
                <Button
                  size="lg"
                  loading={leaving === "approve"}
                  onClick={() => {
                    setLeaving("approve");
                    window.location.assign(back);
                  }}
                >
                  Approve the hold
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  loading={leaving === "cancel"}
                  onClick={() => {
                    setLeaving("cancel");
                    window.location.assign(cancel);
                  }}
                >
                  Cancel and go back
                </Button>
              </div>
            ) : (
              <Notice tone="bad" className="mt-6" icon={<ShieldAlert className="size-4" />} title="This link points somewhere else">
                Its return address isn&apos;t on this site, so the simulator won&apos;t follow it. Real Kept links never send you to another website after payment.
              </Notice>
            )}
          </>
        ) : (
          <Notice tone="bad" className="mt-5" title="Not a simulator order">
            This link doesn&apos;t contain a valid sandbox order. Start funding again from your promise.
          </Notice>
        )}
      </div>
      <p className="mt-5 text-center text-xs leading-relaxed text-faint">This page exists only while Kept runs on its simulated payment rail. In live mode you approve on paypal.com.</p>
    </div>
  );
}

export default function SimApprovePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-16">
      <Suspense>
        <Simulator />
      </Suspense>
    </div>
  );
}
