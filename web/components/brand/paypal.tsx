/* eslint-disable @next/next/no-img-element */
import { Lock } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "@/components/ui/spinner";
import { PAYPAL_LOGO } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * PayPal's checkout button (gold, official logo). Used only where the funder is
 * sent to PayPal to approve a hold or payment.
 */
export function PayPalButton({ loading, label = "Pay with", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; label?: string }) {
  return (
    <button
      type="button"
      disabled={rest.disabled || loading}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-pp-gold px-6 text-[15px] font-medium text-[#111] transition-[filter,transform] duration-200 hover:brightness-95 active:scale-[0.99] disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner className="size-5" />
      ) : (
        <>
          <span className="tracking-[-0.01em]">{label}</span>
          <img src={PAYPAL_LOGO.full} alt="PayPal" width={84} height={24} className="h-[22px] w-auto" />
        </>
      )}
    </button>
  );
}

/** "Held and paid by PayPal" badge for money screens. */
export function PayPalBadge({ className, dark, text = "Money held by PayPal" }: { className?: string; dark?: boolean; text?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs", dark ? "bg-white/10 text-white/80" : "bg-pp-tint text-pp-deep", className)}>
      <img src={PAYPAL_LOGO.mark} alt="" width={14} height={14} className="size-3.5" />
      {text}
    </span>
  );
}

/** Small reassurance line under payment buttons. */
export function PaymentAssurance({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-xs leading-relaxed text-muted", className)}>
      <Lock className="mt-0.5 size-3.5 shrink-0" />
      You approve on paypal.com. Kept never sees your card or PayPal password, and the money moves only by the proved rules.
    </p>
  );
}
