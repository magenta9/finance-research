import { NavLink } from 'react-router-dom';

import type { RouteDefinition } from './route-metadata';

export { DashboardPage } from './dashboard/dashboard-page';
export { SettingsPage } from './settings/settings-page';
export { AssetsPage } from './assets-page';
export { AllocationPage } from './allocation-page';
export { PiAgentPage } from './pi-agent-page';

const RouteIcon = ({
  icon,
}: {
  icon: RouteDefinition['icon'];
}) => {
  switch (icon) {
    case 'dashboard':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.92" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.72" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.72" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="currentColor" opacity="0.92" />
        </svg>
      );
    case 'assets':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path
            d="M4.5 8.25 12 4l7.5 4.25L12 16.5 4.5 8.25Z"
            fill="currentColor"
            opacity="0.92"
          />
          <path
            d="M4.5 12.5 12 8.25l7.5 4.25L12 20.75 4.5 12.5Z"
            fill="currentColor"
            opacity="0.68"
          />
        </svg>
      );
    case 'allocation':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path d="M7 5.5v13" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M12 5.5v13" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity="0.7" />
          <path d="M17 5.5v13" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity="0.85" />
          <circle cx="7" cy="9" r="2" fill="currentColor" />
          <circle cx="12" cy="15" r="2" fill="currentColor" opacity="0.82" />
          <circle cx="17" cy="11" r="2" fill="currentColor" opacity="0.9" />
        </svg>
      );
    case 'agent':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path
            d="M12 3.75 13.78 8l4.72.44-3.58 3.1 1.1 4.56L12 13.75 7.98 16.1l1.1-4.56-3.58-3.1L10.22 8 12 3.75Z"
            fill="currentColor"
            opacity="0.9"
          />
          <circle cx="18" cy="17" r="1.5" fill="currentColor" opacity="0.72" />
          <circle cx="6" cy="17.5" r="1.2" fill="currentColor" opacity="0.6" />
        </svg>
      );
    case 'settings':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path
            d="M10.2 4.4c.7-1.8 3.3-1.8 4 0l.2.5c.4.9 1.4 1.4 2.4 1.1l.6-.2c1.9-.6 3.4 1.4 2.4 3.1l-.3.5c-.5.8-.4 1.9.2 2.6l.4.4c1.4 1.4.5 3.9-1.5 4.1h-.6c-1 .1-1.8.8-2 1.8l-.1.6c-.3 2-2.9 2.7-4.1 1.1l-.3-.4c-.6-.8-1.7-1.1-2.6-.7l-.5.2c-1.8.7-3.5-.9-3-2.8l.1-.5c.2-1-.2-1.9-1-2.4l-.5-.3c-1.7-1.1-1.4-3.7.4-4.4l.6-.2c.9-.3 1.5-1.2 1.4-2.2l-.1-.6c-.1-1.1.6-2.1 1.7-2.3l.6-.1c1-.2 1.8-.8 2.1-1.8l.2-.5Z"
            fill="currentColor"
            opacity="0.85"
          />
          <circle cx="12" cy="12" r="2.4" fill="var(--color-surface-strong)" />
        </svg>
      );
  }
};

export const RailLink = ({
  route,
  compact,
  compactBelowLarge,
  compactOnMedium,
  compactOnSmall,
  labelOverride,
}: {
  route: RouteDefinition;
  compact: boolean;
  compactBelowLarge?: boolean;
  compactOnMedium?: boolean;
  compactOnSmall?: boolean;
  labelOverride?: string;
}) => (

  <NavLink
    className={({ isActive }) =>
      [
        'group flex h-12 shrink-0 items-center whitespace-nowrap rounded-[16px] text-sm transition-[background-color,color,box-shadow,border-color] duration-300 ease-out',
        compact
          ? 'h-12 w-12 justify-center gap-0 px-0'
          : compactBelowLarge
            ? 'w-full gap-2 px-1.5 py-0 max-lg:w-12 max-lg:justify-center max-lg:gap-0 max-lg:px-0'
            : compactOnMedium
              ? 'w-full gap-2 px-1.5 py-0 max-xl:w-12 max-xl:justify-center max-xl:gap-0 max-xl:px-0'
              : compactOnSmall
                ? 'w-full gap-2 px-1.5 py-0 max-md:w-12 max-md:justify-center max-md:gap-0 max-md:px-0'
                : 'w-full gap-2 px-1.5 py-0',
        isActive
          ? 'border border-transparent bg-[rgba(188,140,88,0.14)] text-[var(--color-foreground)]'
          : 'border border-transparent text-[var(--color-copy)] hover:bg-white/6 hover:text-[var(--color-foreground)]',
      ].join(' ')
    }
    aria-label={labelOverride ?? route.label}
    title={compact ? labelOverride ?? route.label : undefined}
    key={route.path}
    to={route.path}
  >
    <span
      className={[
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent bg-[rgba(156,98,55,0.08)] text-[var(--color-highlight)] transition-[background-color,color,border-color] duration-300 ease-out',
      ].join(' ')}
    >
      <RouteIcon icon={route.icon} />
    </span>
    <span
      aria-hidden={compact}
      className={[
        'min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap font-medium tracking-[0.02em] transition-[max-width,opacity] duration-300 ease-out',
        compact
          ? 'max-w-0 opacity-0'
          : compactBelowLarge
            ? 'max-w-[180px] opacity-100 max-lg:max-w-0 max-lg:opacity-0'
            : compactOnMedium
              ? 'max-w-[180px] opacity-100 max-xl:max-w-0 max-xl:opacity-0'
              : compactOnSmall
                ? 'max-w-[180px] opacity-100 max-md:max-w-0 max-md:opacity-0'
                : 'max-w-[180px] opacity-100',
      ].join(' ')}
    >
      {labelOverride ?? route.label}
    </span>
  </NavLink>
);
