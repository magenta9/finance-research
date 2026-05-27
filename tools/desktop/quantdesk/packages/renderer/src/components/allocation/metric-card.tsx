export const MetricCard = ({
    hint,
    label,
    value,
}: {
    hint: string;
    label: string;
    value: string;
}) => (
    <article className="min-w-0 overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-3 shadow-[0_10px_26px_rgba(61,43,31,0.04)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
        <p className="mt-2 truncate font-display text-2xl leading-7 text-[var(--color-foreground)]">{value}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-copy)]">{hint}</p>
    </article>
);