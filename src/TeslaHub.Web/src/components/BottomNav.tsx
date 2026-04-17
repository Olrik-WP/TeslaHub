import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const S = { size: 20, stroke: 'currentColor', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const Svg = ({ children }: { children: ReactNode }) => (
  <svg width={S.size} height={S.size} viewBox="0 0 24 24" fill={S.fill} stroke={S.stroke} strokeWidth={S.strokeWidth} strokeLinecap={S.strokeLinecap} strokeLinejoin={S.strokeLinejoin}>{children}</svg>
);

const icons: Record<string, ReactNode> = {
  home:       <Svg><path d="M3 12l9-8 9 8" /><path d="M5 12v7a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-7" /></Svg>,
  charging:   <Svg><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" opacity=".15" /><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></Svg>,
  trips:      <Svg><path d="M5 18l5-5 3 3 6-8" /><path d="M15 8h5v5" /></Svg>,
  costs:      <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5a2.5 2 0 013.5-.5c1.5 1-1 3-1 3s2.5 1.5 1 3a2.5 2 0 01-3.5-.5" /></Svg>,
  map:        <Svg><circle cx="12" cy="10" r="3" /><path d="M12 2a8 8 0 00-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 00-8-8z" /></Svg>,
  dcCurve:    <Svg><polyline points="4 18 8 12 12 14 16 8 20 4" /><path d="M4 20h16" /><path d="M4 4v16" /></Svg>,
  battery:    <Svg><rect x="2" y="7" width="18" height="10" rx="2" /><path d="M22 11v2" /><rect x="4" y="9" width="8" height="6" rx="1" fill="currentColor" opacity=".3" /></Svg>,
  efficiency: <Svg><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /><circle cx="12" cy="12" r="4" /></Svg>,
  mileage:    <Svg><path d="M4 16c0-3 4-9 8-9s8 6 8 9" /><circle cx="12" cy="16" r="2" /><path d="M12 14V8" /></Svg>,
  statistics: <Svg><rect x="3" y="12" width="4" height="8" rx="1" /><rect x="10" y="6" width="4" height="14" rx="1" /><rect x="17" y="2" width="4" height="18" rx="1" /></Svg>,
  updates:    <Svg><path d="M12 16V4M8 12l4 4 4-4" /><path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" /></Svg>,
  states:     <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></Svg>,
  vampire:    <Svg><path d="M12 3c-4 0-7 3-7 7 0 5 7 11 7 11s7-6 7-11c0-4-3-7-7-7z" /><path d="M9 11l1.5-3 1.5 3M12 11l1.5-3 1.5 3" /></Svg>,
  locations:  <Svg><circle cx="12" cy="10" r="2" /><path d="M12 2a8 8 0 00-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 00-8-8z" /><path d="M7 20h10" /></Svg>,
  trip:       <Svg><path d="M3 6h18M3 6l3 12h12l3-12" /><circle cx="9" cy="18" r="2" fill="currentColor" opacity=".3" /><circle cx="15" cy="18" r="2" fill="currentColor" opacity=".3" /><path d="M9 6V4a3 3 0 016 0v2" /></Svg>,
  dashboard:  <Svg><circle cx="12" cy="14" r="8" /><path d="M12 14V8" /><path d="M12 14l4 3" /><path d="M8 10h0" /><path d="M16 10h0" /><circle cx="12" cy="14" r="1.5" /></Svg>,
  database:   <Svg><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></Svg>,
  settings:   <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></Svg>,
  more:       <Svg><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></Svg>,
  close:      <Svg><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></Svg>,
};

const primaryLinks = [
  { to: '/', labelKey: 'nav.home', icon: 'home' },
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
  { to: '/charging', labelKey: 'nav.charging', icon: 'charging' },
  { to: '/trips', labelKey: 'nav.trips', icon: 'trips' },
];

const drawerLinks = [
  { to: '/costs', labelKey: 'nav.costs', icon: 'costs' },
  { to: '/map', labelKey: 'nav.map', icon: 'map' },
  { to: '/charging-stats', labelKey: 'nav.dcCurve', icon: 'dcCurve' },
  { to: '/battery', labelKey: 'nav.battery', icon: 'battery' },
  { to: '/efficiency', labelKey: 'nav.efficiency', icon: 'efficiency' },
  { to: '/mileage', labelKey: 'nav.mileage', icon: 'mileage' },
  { to: '/statistics', labelKey: 'nav.statistics', icon: 'statistics' },
  { to: '/updates', labelKey: 'nav.updates', icon: 'updates' },
  { to: '/states', labelKey: 'nav.states', icon: 'states' },
  { to: '/vampire', labelKey: 'nav.vampire', icon: 'vampire' },
  { to: '/locations', labelKey: 'nav.locations', icon: 'locations' },
  { to: '/trip', labelKey: 'nav.trip', icon: 'trip' },
  { to: '/database', labelKey: 'nav.database', icon: 'database' },
  { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
];

const allDrawerPaths = drawerLinks.map((l) => l.to);

export default function BottomNav() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isDrawerPageActive = allDrawerPaths.some((p) => location.pathname === p);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const linkClass = (isActive: boolean) =>
    `flex flex-col items-center justify-center min-w-[48px] min-h-[56px] rounded-lg text-xs ${
      isActive ? 'text-[#e31937]' : 'text-[#9ca3af]'
    }`;

  const linkStyle = { touchAction: 'manipulation' as const, WebkitTapHighlightColor: 'transparent' };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm" onClick={close} />
      )}

      <div
        className={`fixed left-0 right-0 z-[9999] transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-[calc(100%-4rem)]'
        }`}
        style={{
          bottom: 0,
          WebkitTransform: undefined,
          willChange: 'transform',
          pointerEvents: 'auto',
          touchAction: 'manipulation',
        }}
      >
        {open && (
          <div className="bg-[#1a1a1a] border-t border-[#2a2a2a] rounded-t-2xl px-4 pt-3 pb-2">
            <div className="w-10 h-1 bg-[#444] rounded-full mx-auto mb-3" />
            <div className="grid grid-cols-4 gap-2 max-h-[50vh] overflow-y-auto pb-2">
              {drawerLinks.map((link) => (
                <button
                  key={link.to}
                  onClick={() => { navigate(link.to); close(); }}
                  className={`flex flex-col items-center justify-center py-3 rounded-xl text-xs transition-colors ${
                    location.pathname === link.to
                      ? 'bg-[#2a2a2a] text-[#e31937]'
                      : 'text-[#9ca3af] active:bg-[#222]'
                  }`}
                  style={linkStyle}
                >
                  <span className="leading-none mb-1">{icons[link.icon]}</span>
                  <span className="text-[10px]">{t(link.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <nav
          className="flex items-center justify-around bg-[#141414] border-t border-[#2a2a2a] h-16 px-1 pb-safe"
          style={{
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)',
            willChange: 'transform',
            pointerEvents: 'auto',
            touchAction: 'manipulation',
          }}
        >
          {primaryLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => linkClass(isActive)}
              style={linkStyle}
            >
              <span className="leading-none mb-0.5">{icons[link.icon]}</span>
              <span className="text-[9px]">{t(link.labelKey)}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setOpen((p) => !p)}
            className={linkClass(isDrawerPageActive && !open)}
            style={linkStyle}
          >
            <span className="leading-none mb-0.5">{open ? icons.close : icons.more}</span>
            <span className="text-[9px]">{t('nav.more')}</span>
          </button>
        </nav>
      </div>
    </>
  );
}
