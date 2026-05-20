/**
 * Showroom controls for the 3D vehicle viewer.
 *
 * These are the "developer / configurator" controls that let a user
 * manually force any opening or cable state — useful to preview what
 * the model looks like with all doors open, the charge cable plugged,
 * etc., WITHOUT requiring the actual vehicle to be in that state.
 *
 * They were originally embedded directly in VehicleTopView3D as a side
 * rail, but in production the viewer is now READ-ONLY (it reflects the
 * live VehicleStatus from MQTT/TeslaMate) and any clickable state is
 * routed through callouts that send real Tesla commands.
 *
 * This module is extracted for re-use in the upcoming Settings →
 * Configurator tab where the user picks trim variant, paint, wraps,
 * wheel type, etc., and can sanity-check the 3D look interactively.
 *
 * Mount it inside a tree that already has <OpeningsProvider>.
 */
import { useCallback, useMemo, useState } from 'react';
import { useOpeningsContext } from './useVehicleOpenings';
import { OPENINGS, OPENING_LABELS, type OpeningId } from './vehicleOpenings';

export type CableMode = 'off' | 'plugged' | 'charging';

const CABLE_LABELS: Record<CableMode, string> = {
  off: 'Brancher le câble de charge',
  plugged: 'Câble branché (cliquer pour démarrer la charge)',
  charging: 'Charge en cours (cliquer pour débrancher)',
};

const OPENING_SHORT: Record<OpeningId, string> = {
  hood: 'Capot',
  trunk: 'Coffre',
  charge_port: 'Charge',
  door_LF: 'P AvG',
  door_LR: 'P ArG',
  door_RF: 'P AvD',
  door_RR: 'P ArD',
  window_LF: 'V AvG',
  window_LR: 'V ArG',
  window_RF: 'V AvD',
  window_RR: 'V ArD',
  mirror_LF: 'Rétro G',
  mirror_RF: 'Rétro D',
};

export interface ShowroomControlsProps {
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  cableMode: CableMode;
  onCycleCable: () => void;
}

/**
 * Right-side floating control rail.
 *
 * - COLLAPSED: a thin vertical rail (32px wide) with three always-visible
 *   buttons (open panel, auto-rotate, close all).
 * - EXPANDED: rail expands to ~190px wide and shows all 11 openings plus
 *   "Tout ouvrir/fermer". User can hide it again.
 *
 * State is intentionally NOT persisted: each viewer mount starts collapsed
 * so first impression is "see the car", not "see a UI panel".
 */
export function ShowroomControls({
  autoRotate,
  onToggleAutoRotate,
  cableMode,
  onCycleCable,
}: ShowroomControlsProps) {
  const { toggle, set, setAll, targets } = useOpeningsContext();
  const [expanded, setExpanded] = useState(false);

  // Cycling the cable also opens/closes the charge port trapdoor, mirroring
  // the Tesla mobile app: plugging in opens the port, unplugging closes it.
  const handleCableClick = useCallback(() => {
    const next: CableMode =
      cableMode === 'off' ? 'plugged' : cableMode === 'plugged' ? 'charging' : 'off';
    set('charge_port', next === 'off' ? 0 : 1);
    onCycleCable();
  }, [cableMode, onCycleCable, set]);

  const openCount = useMemo(
    () => Object.values(targets).filter((v) => v === 1).length,
    [targets],
  );

  return (
    <div className="absolute top-2 right-2 bottom-2 flex items-start gap-1.5 pointer-events-none">
      {/* Expanded panel — slides in/out via translate-x */}
      <div
        className={
          'pointer-events-auto bg-black/70 backdrop-blur-md border border-white/10 rounded-lg p-2 ' +
          'transition-all duration-200 origin-right ' +
          (expanded
            ? 'translate-x-0 opacity-100 scale-100'
            : 'translate-x-4 opacity-0 scale-95 pointer-events-none')
        }
        style={{ width: 190 }}
        aria-hidden={!expanded}
      >
        <div className="flex gap-1 mb-2">
          <button
            type="button"
            onClick={() => setAll(1)}
            className="flex-1 h-7 text-[11px] rounded bg-white/10 text-white/90 hover:bg-white/20"
          >
            Tout ouvrir
          </button>
          <button
            type="button"
            onClick={() => setAll(0)}
            disabled={openCount === 0}
            className="flex-1 h-7 text-[11px] rounded bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Tout fermer
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {OPENINGS.map((o) => {
            const isOpen = targets[o.id] === 1;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                title={OPENING_LABELS[o.id]}
                className={
                  'h-8 text-[10px] leading-tight rounded border transition-colors ' +
                  (isOpen
                    ? 'bg-blue-500/80 text-white border-blue-400'
                    : 'bg-white/5 text-white/70 hover:bg-white/15 border-white/10')
                }
              >
                {OPENING_SHORT[o.id]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Always-visible vertical rail */}
      <div className="pointer-events-auto flex flex-col gap-1 bg-black/50 backdrop-blur-sm border border-white/10 rounded-md p-1">
        <RailButton
          onClick={() => setExpanded((v) => !v)}
          active={expanded}
          title={expanded ? 'Replier' : 'Ouvertures'}
          glyph={expanded ? '›' : '‹'}
        />
        <RailButton
          onClick={onToggleAutoRotate}
          active={autoRotate}
          title={autoRotate ? 'Stopper la rotation' : 'Lancer la rotation'}
          glyph="↻"
        />
        <RailButton
          onClick={handleCableClick}
          active={cableMode !== 'off'}
          accent={cableMode === 'charging' ? 'green' : undefined}
          title={CABLE_LABELS[cableMode]}
          glyph="⚡"
        />
        {openCount > 0 && (
          <RailButton
            onClick={() => setAll(0)}
            title={`Fermer (${openCount} ouvert${openCount > 1 ? 's' : ''})`}
            glyph="✕"
          />
        )}
      </div>
    </div>
  );
}

interface RailButtonProps {
  onClick: () => void;
  title: string;
  glyph: string;
  active?: boolean;
  accent?: 'green';
}

function RailButton({ onClick, title, glyph, active, accent }: RailButtonProps) {
  const activeClass =
    accent === 'green' ? 'bg-emerald-500/80 text-white' : 'bg-blue-500/80 text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        'w-7 h-7 rounded-sm flex items-center justify-center text-sm transition-colors ' +
        (active ? activeClass : 'text-white/70 hover:bg-white/15 hover:text-white')
      }
    >
      {glyph}
    </button>
  );
}
