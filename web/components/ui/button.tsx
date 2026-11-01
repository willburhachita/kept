import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "inverse" | "inverse-ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.02em] transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]",
  secondary: "bg-pp-tint text-ink hover:bg-[rgb(5_55_130/0.14)]",
  ghost: "text-ink hover:bg-black/[0.05]",
  outline: "border border-line-2 bg-surface text-ink hover:border-ink",
  danger: "bg-bad text-white hover:bg-[#a32608]",
  inverse: "bg-white text-ink hover:bg-white/90",
  "inverse-ghost": "text-white/80 hover:bg-white/10 hover:text-white",
  link: "h-auto rounded-none px-0 text-pp underline-offset-4 hover:text-pp-deep hover:underline active:scale-100",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-[15px]",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(base, sizes[size], variants[variant], className);
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  className?: string;
  children?: ReactNode;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = CommonProps & { href: string; external?: boolean; target?: string; onClick?: () => void; "aria-label"?: string };

/**
 * Pill button. Primary is black (PayPal's main CTA), secondary is PayPal's blue tint.
 * Pass `href` to render a link with the same look.
 */
export function Button(props: ButtonProps | LinkProps) {
  const { variant = "primary", size = "md", loading, icon, iconRight, className, children } = props;
  const content = (
    <>
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
      {iconRight}
    </>
  );
  if (typeof props.href === "string") {
    const { href, external, target, onClick } = props as LinkProps;
    const cls = buttonClass(variant, size, className);
    if (external || /^https?:/.test(href)) {
      return (
        <a href={href} className={cls} target={target ?? "_blank"} rel="noopener noreferrer" onClick={onClick} aria-label={props["aria-label"]}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} onClick={onClick} aria-label={props["aria-label"]}>
        {content}
      </Link>
    );
  }
  const { variant: _v, size: _s, loading: _l, icon: _i, iconRight: _ir, className: _c, children: _ch, disabled, type, ...rest } = props as ButtonProps;
  return (
    <button type={type ?? "button"} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {content}
    </button>
  );
}

/** Round icon button (Lint's arrow buttons on photo cards). */
export function IconButton({
  className,
  label,
  tone = "light",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "light" | "dark" | "glass" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-200 active:scale-95 disabled:opacity-40",
        tone === "light" && "bg-white text-ink hover:bg-white/85",
        tone === "dark" && "bg-ink text-white hover:bg-ink-2",
        tone === "glass" && "bg-black/[0.05] text-ink hover:bg-black/10",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
