import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <p className="eyebrow">(404) · Not found</p>
      <h1 className="mt-4 max-w-xl text-[clamp(2rem,5vw,3.25rem)] leading-[1.08] tracking-[-0.045em]">
        This page doesn&apos;t exist. <span className="text-faint">If someone sent you this link to pay, be careful.</span>
      </h1>
      <p className="mt-4 max-w-md text-[15px] text-muted">Real Kept links start with this site&apos;s address and never ask you to pay outside PayPal.</p>
      <div className="mt-8 flex gap-2">
        <Button href="/">Go home</Button>
        <Button href="/verify" variant="secondary">
          Check a link
        </Button>
      </div>
    </div>
  );
}
