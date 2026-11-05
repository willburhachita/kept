"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { inspectLink } from "@/lib/safety";

/** Paste a link someone sent you; checked right here in the browser, nothing is sent anywhere. */
export function LinkCheck() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ReturnType<typeof inspectLink> | null>(null);
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(inspectLink(value));
  }
  return (
    <div className="rounded-card bg-surface p-6 text-ink sm:p-8">
      <p className="text-2xl font-semibold tracking-[-0.04em]">Got a payment link?</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">Paste it before you sign in or pay. We check it in your browser; nothing is sent anywhere.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <label htmlFor="link-check" className="text-sm text-muted">
          Link
        </label>
        <input
          id="link-check"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
          }}
          placeholder="https://"
          className="h-12 w-full rounded-field bg-canvas px-4 text-[15px] placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-ink"
        />
        <Button type="submit" size="lg" className="w-full" disabled={!value.trim()}>
          Check the link
        </Button>
      </form>
      {result && (
        <div className={`mt-5 rounded-2xl p-4 text-sm ${result.ok ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad"}`} role="status">
          <p className="flex items-center gap-2 font-medium">
            {result.ok ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
            {result.ok ? `Genuine Kept ${result.kind === "other" ? "link" : `${result.kind} link`}` : "Be careful with this link"}
          </p>
          {!result.ok && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
