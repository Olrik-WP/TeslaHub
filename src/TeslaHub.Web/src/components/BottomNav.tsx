import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Accueil', icon: '⌂' },
  { to: '/charging', label: 'Charge', icon: '⚡' },
  { to: '/trips', label: 'Trajets', icon: '⟿' },
  { to: '/map', label: 'Carte', icon: '◉' },
  { to: '/costs', label: 'Coûts', icon: '◆' },
  { to: '/settings', label: 'Config', icon: '⚙' },
];

export default function BottomNav() {
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
          <span className="text-[10px]">{link.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
