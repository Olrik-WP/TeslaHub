import { type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Standard card wrapper for the Control page. Mirrors the Home page
 * styling so the two pages feel like the same product
 * (bg-[#141414] / border [#2a2a2a] / rounded-xl).
 */
export default function ControlCard({ title, subtitle, icon, badge, children, className = '' }: Props) {
  return (
    <section className={`bg-[#141414] border border-[#2a2a2a] rounded-xl p-4 ${className}`}>
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-[#9ca3af] shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#e0e0e0] truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-[#6b7280] truncate">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}
