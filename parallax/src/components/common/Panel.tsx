import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  as = "section",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div" | "aside";
}) {
  const Tag = as;
  return (
    <Tag className={cn("panel", className)}>
      {(title || action) && (
        <div className="panel-head">
          {typeof title === "string" ? <h2 className="panel-title">{title}</h2> : title}
          {action}
        </div>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="text-xs text-faint max-w-xs">{hint}</p>}
    </div>
  );
}
