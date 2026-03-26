import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const links = [
  { to: '/', labelKey: 'nav.home', icon: '⌂' },
  { to: '/charging', labelKey: 'nav.charging', icon: '⚡' },
  { to: '/charging-stats', labelKey: 'nav.dcCurve', icon: '⚡' },
  { to: '/trips', labelKey: 'nav.trips', icon: '⟿' },
  { to: '/map', labelKey: 'nav.map', icon: '◉' },
  { to: '/costs', labelKey: 'nav.costs', icon: '◆' },
  { to: '/vampire', labelKey: 'nav.vampire', icon: '🧛' },
  { to: '/settings', labelKey: 'nav.settings', icon: '⚙' },
];

export default function BottomNav() {
  const { t } = useTranslation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[9999] flex items-center justify-around bg-[#141414] border-t border-[#2a2a2a] h-16 px-1"
      style={{
        WebkitTransform: 'translateZ(0)',
        transform: 'translateZ(0)',
        willChange: 'transform',
        pointerEvents: 'auto',
        touchAction: 'manipulation',
      }}
    >
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[48px] min-h-[56px] rounded-lg text-xs ${
              isActive ? 'text-[#e31937]' : 'text-[#9ca3af]'
            }`
          }
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        >
          <span className="text-lg leading-none mb-0.5">{link.icon}</span>
          <span className="text-[9px]">{t(link.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
