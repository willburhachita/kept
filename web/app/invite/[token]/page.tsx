"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteNav } from "@/components/site/site-nav";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { SectionLabel } from "@/components/ui/type";
import { api } from "@/lib/convex";
import { errorMessage } from "@/lib/errors";
import { inspectLink } from "@/lib/safety";

const PROMISES = [
  "The money is put on hold with PayPal before you start. You can see that it's there.",
  "It's released only by rules you both approved, which a verifier proved can't break a promise.",
  "Your PayPal payout email is locked when you approve, so nobody can redirect your pay.",
  "Every step is signed. Disputes go to a neutral arbiter, not to whoever shouts loudest.",
];

const RED_FLAGS = [
  "Being asked to pay, or to “unlock” money, before you receive anything",
  "Gift cards, crypto, wire transfers or any payment outside PayPal",
  "A request for your password, PIN or a one-time code",
  "An “overpayment” you're asked to refund the difference on",
  "Pressure to decide in minutes",
];

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const accept = useMutation(api.contracts.acceptInvite);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<ReturnType<typeof inspectLink> | null>(null);
  useEffect(() => setLink(inspectLink(window.location.href)), []);
  const next = `/invite/${encodeURIComponent(token)}`;

  return (
    <>
      <SiteNav />
      <main className="mx-auto grid max-w-6xl gap-10 px-5 pb-24 pt-32 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <SectionLabel index="00">You&apos;ve been invited</SectionLabel>
          <h1 className="mt-5 text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.05em]">
            Someone wants to make a promise with you. <span className="text-faint">Here&apos;s how you&apos;re protected.</span>
          </h1>
          <ul className="mt-10 space-y-4">
            {PROMISES.map((p) => (
              <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
                <Check className="mt-1 size-4 shrink-0 text-ok" /> {p}
              </li>
            ))}
          </ul>
          <div className="mt-10 rounded-card bg-surface p-6">
            <p className="flex items-center gap-2 text-sm font-medium text-bad">
              <ShieldAlert className="size-4" /> Walk away if you see any of these
            </p>
            <ul className="mt-4 space-y-2.5">
              {RED_FLAGS.map((r) => (
                <li key={r} className="flex gap-3 text-sm text-ink-2">
                  <X className="mt-0.5 size-4 shrink-0 text-bad" /> {r}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lg:pt-10">
          <div className="sticky top-28 space-y-4">
            {link && (
              <Notice tone={link.ok ? "ok" : "bad"} icon={link.ok ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />} title={link.ok ? "This is a genuine Kept invite link" : "Check this link"}>
                {link.ok ? `You're on ${link.host}. Keep using this address; don't follow links inside messages.` : link.notes.join(" ")}
              </Notice>
            )}
            <div className="rounded-card bg-ink p-7 text-white">
              <p className="text-xl leading-snug tracking-[-0.03em]">
                Review the promise before anything else. <span className="text-white/45">Approving is free and nothing is charged to you.</span>
              </p>
              {error && (
                <Notice tone="bad" className="mt-5">
                  {error}
                </Notice>
              )}
              <div className="mt-7 grid gap-2">
                {isLoading ? null : isAuthenticated ? (
                  <Button
                    variant="inverse"
                    size="lg"
                    loading={pending}
                    onClick={async () => {
                      setPending(true);
                      setError(null);
                      try {
                        const { contractId } = await accept({ token });
                        router.replace(`/contracts/${contractId}`);
                      } catch (e) {
                        setError(/invalid|expired|not found/i.test(errorMessage(e)) ? "This invite link has expired or was already used. Ask the sender for a fresh link (they can make one from the promise page)." : errorMessage(e));
                        setPending(false);
                      }
                    }}
                  >
                    Open the promise
                  </Button>
                ) : (
                  <>
                    <Button href={`/signin?mode=signUp&next=${encodeURIComponent(next)}`} variant="inverse" size="lg">
                      Create a free account to review
                    </Button>
                    <Button href={`/signin?next=${encodeURIComponent(next)}`} variant="inverse-ghost" size="lg">
                      I already have an account
                    </Button>
                  </>
                )}
              </div>
              <p className="mt-6 text-xs leading-relaxed text-white/45">The link works once and expires 14 days after it was made. Kept will never ask for your PayPal password.</p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
