import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-field border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-2 focus:border-ink focus:outline-none focus:ring-4 focus:ring-black/[0.06] disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-bad";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-11", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-28 resize-y py-3 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        fieldBase,
        "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%237a7a7a%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[position:right_1rem_center] bg-no-repeat pr-10",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * Label + control + hint/error. The control is rendered by `children(id)` so the
 * label, hint and error are wired with ids for screen readers.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-sm text-muted">
        <span>{label}</span>
        {optional && <span className="text-xs text-faint">Optional</span>}
      </label>
      {children({ id, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={errId} className="text-sm text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Inline alert box for errors, warnings and notes. */
export function Notice({
  tone = "neutral",
  title,
  icon,
  className,
  children,
}: {
  tone?: "neutral" | "blue" | "ok" | "warn" | "bad";
  title?: ReactNode;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const t = {
    neutral: "bg-black/[0.04] text-ink-2",
    blue: "bg-pp-tint text-pp-deep",
    ok: "bg-ok-tint text-ok",
    warn: "bg-warn-tint text-warn",
    bad: "bg-bad-tint text-bad",
  }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex gap-3 rounded-2xl px-4 py-3 text-sm leading-relaxed", t, className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}
