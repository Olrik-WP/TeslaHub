import { useState, useCallback, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const primaryLinks = [
  { to: '/', labelKey: 'nav.home', icon: '⌂' },
  { to: '/charging', labelKey: 'nav.charging', icon: '⚡' },
  { to: '/trips', labelKey: 'nav.trips', icon: '⟿' },
  { to: '/costs', labelKey: 'nav.costs', icon: '◆' },
];

const drawerLinks = [
  { to: '/map', labelKey: 'nav.map', icon: '◉' },
  { to: '/charging-stats', labelKey: 'nav.dcCurve', icon: '📈' },
  { to: '/battery', labelKey: 'nav.battery', icon: '🔋' },
  { to: '/efficiency', labelKey: 'nav.efficiency', icon: '⚡' },
  { to: '/mileage', labelKey: 'nav.mileage', icon: '🛣' },
  { to: '/statistics', labelKey: 'nav.statistics', icon: '📊' },
  { to: '/updates', labelKey: 'nav.updates', icon: '💾' },
  { to: '/states', labelKey: 'nav.states', icon: '🔄' },
  { to: '/vampire', labelKey: 'nav.vampire', icon: '🧛' },
  { to: '/locations', labelKey: 'nav.locations', icon: '📍' },
  { to: '/trip', labelKey: 'nav.trip', icon: '🗺' },
  { to: '/database', labelKey: 'nav.database', icon: '🗄' },
  { to: '/settings', labelKey: 'nav.settings', icon: '⚙' },
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
                  <span className="text-xl leading-none mb-1">{link.icon}</span>
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
              <span className="text-lg leading-none mb-0.5">{link.icon}</span>
              <span className="text-[9px]">{t(link.labelKey)}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setOpen((p) => !p)}
            className={linkClass(isDrawerPageActive && !open)}
            style={linkStyle}
          >
            <span className="text-lg leading-none mb-0.5">{open ? '✕' : '≡'}</span>
            <span className="text-[9px]">{t('nav.more')}</span>
          </button>
        </nav>
      </div>
    </>
  );
}
