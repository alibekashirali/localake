import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "default" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-400",
  default: "bg-white text-ink-700 border border-line hover:bg-slate-50 hover:border-line-strong",
  ghost: "text-ink-600 hover:bg-slate-100 hover:text-ink-900",
  danger: "bg-white text-danger border border-line hover:bg-red-50 hover:border-red-200",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "default", size = "md", loading, icon, className, children, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={clsx(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-400",
        "transition-colors hover:bg-slate-100 hover:text-ink-700",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card flex min-h-0 flex-col", className)}>{children}</div>;
}

export function CardHeader({
  title, actions, className,
}: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-between gap-2 px-4 pt-3.5 pb-3", className)}>
      <div className="min-w-0 text-[15px] font-semibold tracking-[-0.01em] text-ink-900">{title}</div>
      {actions ? <div className="flex flex-none items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function Badge({
  children, tone = "neutral",
}: { children: ReactNode; tone?: "neutral" | "brand" | "ok" | "warn" }) {
  const tones = {
    neutral: "bg-slate-100 text-ink-600",
    brand: "bg-brand-50 text-brand-700",
    ok: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
  } as const;
  return (
    <span className={clsx("rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}

/** Row of underlined tabs, as used by the Inspector and the Results panel. */
export function TabBar<T extends string>({
  tabs, value, onChange, right, className,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-between border-b border-line px-4", className)}>
      <div className="flex items-center gap-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              "relative -mb-px border-b-2 py-2.5 text-[13px] font-medium transition-colors",
              value === tab.id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {right ? <div className="flex items-center gap-2 py-2">{right}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon, title, hint, action,
}: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-ink-400">{icon}</div> : null}
      <div className="text-[13px] font-medium text-ink-700">{title}</div>
      {hint ? <div className="max-w-xs text-[12px] leading-relaxed text-ink-500">{hint}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-ink-400" />;
}
