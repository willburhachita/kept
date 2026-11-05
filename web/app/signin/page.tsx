"use client";

/* eslint-disable @next/next/no-img-element */
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { errorMessage } from "@/lib/errors";
import { PHOTOS, photo } from "@/lib/site";

/** Only same-site paths: never bounce a fresh session to another domain. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

function SignInForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">(params.get("mode") === "signUp" ? "signUp" : "signIn");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get("next"));
  const invited = next.startsWith("/invite/");

  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(next);
  }, [isLoading, isAuthenticated, next, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (mode === "signUp" && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      setError("Use at least 10 characters, including letters and numbers.");
      return;
    }
    form.set("flow", mode);
    setPending(true);
    try {
      await signIn("password", form);
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err, mode === "signIn" ? "Couldn't sign in. Check your email and password." : "Couldn't create the account."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-[26rem]">
      <Logo tagline />
      <h1 className="mt-10 text-[2rem] leading-[1.1] tracking-[-0.045em]">{mode === "signIn" ? "Welcome back." : "Make your first promise."}</h1>
      <p className="mt-2 text-[15px] text-muted">
        {invited ? "Sign in or create an account to review the promise you were invited to." : mode === "signIn" ? "Sign in to see your promises, holds and receipts." : "Free to start. You only pay a small fee when money is actually released."}
      </p>

      <Segmented
        className="mt-8"
        label="Sign in or create account"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        options={[
          { value: "signIn", label: "Sign in" },
          { value: "signUp", label: "Create account" },
        ]}
      />

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {mode === "signUp" && (
          <Field label="Your name" hint="Shown to the other side of a promise.">
            {(p) => <Input {...p} name="name" autoComplete="name" required maxLength={80} placeholder="Ada Mwale" />}
          </Field>
        )}
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required placeholder="you@example.com" />}</Field>
        <Field label="Password" hint={mode === "signUp" ? "At least 10 characters, with letters and numbers." : undefined}>
          {(p) => (
            <div className="relative">
              <Input {...p} name="password" type={show ? "text" : "password"} autoComplete={mode === "signIn" ? "current-password" : "new-password"} required minLength={mode === "signUp" ? 10 : 1} className="pr-12" />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-black/5 hover:text-ink">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" size="lg" loading={pending} className="w-full">
          {mode === "signIn" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
        Kept never asks for your PayPal password, card number or a &ldquo;release fee&rdquo;. If anyone does, it isn&apos;t us.
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="hidden p-2 lg:block">
        <div className="relative h-full overflow-hidden rounded-card bg-ink text-white">
          <img src={photo(PHOTOS.womanBench, 1600)} alt="A freelancer working on a laptop at a wooden bench" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/35 to-ink/10" />
          <div className="absolute inset-x-10 bottom-10">
            <p className="pb-[0.2em] text-[clamp(5rem,9vw,8rem)] font-bold leading-[0.82] tracking-[-0.075em]">
              Kept<span className="text-pp">.</span>
            </p>
            <p className="mt-8 max-w-md text-[1.625rem] font-semibold leading-[1.15] tracking-[-0.045em]">
              She delivers the logo. The money is already waiting. <span className="text-white/45">Nobody has to trust anybody&apos;s word.</span>
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-16 sm:px-10">
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}
