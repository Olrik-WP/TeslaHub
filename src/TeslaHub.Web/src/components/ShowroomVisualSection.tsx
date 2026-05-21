/**
 * Showroom right-panel section that drives the ephemeral visual
 * state — what the car appears to be doing (doors open, charging,
 * locked, in Drive…) WITHOUT triggering any API call.
 *
 * All handlers mutate the parent's `visualState` only. The viewer
 * receives a stub `VehicleStatus` built from that state and re-
 * animates on every change.
 */
import { useTranslation } from 'react-i18next';
import {
  type ShowroomVisualState,
  type CableModeKey,
  DEFAULT_VISUAL_STATE,
  openAllOpenings,
  closeAllOpenings,
  openAllDoors,
  closeAllDoors,
  setCableMode,
  getCableMode,
} from './showroomVisualState';

interface Props {
  state: ShowroomVisualState;
  onChange: (next: ShowroomVisualState) => void;
}

// Small util — type-safe toggle on a boolean flag of the state.
function toggle<K extends keyof ShowroomVisualState>(
  state: ShowroomVisualState,
  key: K,
): ShowroomVisualState {
  return { ...state, [key]: !state[key] } as ShowroomVisualState;
}

export function ShowroomVisualSection({ state, onChange }: Props) {
  const { t } = useTranslation();
  const cableMode = getCableMode(state);

  const isShiftLocked = state.shiftState !== 'P'; // can't open / charge while moving

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-[#9ca3af] font-medium">
          {t('showroom.sections.visuals', 'Visuels (aperçu sans API)')}
        </h3>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_VISUAL_STATE)}
          className="text-[10px] text-[#6b7280] hover:text-white"
          title={t('showroom.visuals.resetAll', 'Tout réinitialiser à l\'état neutre')}
        >
          {t('showroom.visuals.reset', 'Reset')}
        </button>
      </header>

      <p className="text-[10px] text-[#6b7280] -mt-1">
        {t(
          'showroom.visuals.hint',
          'Aperçu local uniquement. Aucune commande n\'est envoyée à la voiture.',
        )}
      </p>

      {/* ─── Master ─── */}
      <SubGroup label={t('showroom.visuals.master', 'Tout')}>
        <Btn
          onClick={() => onChange(openAllOpenings(state))}
          label={t('showroom.visuals.openAll', 'Tout ouvrir')}
        />
        <Btn
          onClick={() => onChange(closeAllOpenings(state))}
          label={t('showroom.visuals.closeAll', 'Tout fermer')}
        />
      </SubGroup>

      {/* ─── Body openings ─── */}
      <SubGroup label={t('showroom.visuals.body', 'Carrosserie')}>
        <ToggleBtn
          active={state.frunkOpen}
          onClick={() => onChange(toggle(state, 'frunkOpen'))}
          label={t('showroom.visuals.frunk', 'Frunk')}
        />
        <ToggleBtn
          active={state.trunkOpen}
          onClick={() => onChange(toggle(state, 'trunkOpen'))}
          label={t('showroom.visuals.trunk', 'Coffre')}
        />
        <ToggleBtn
          active={state.windowsOpen}
          onClick={() => onChange(toggle(state, 'windowsOpen'))}
          label={t('showroom.visuals.windows', 'Vitres')}
        />
      </SubGroup>

      {/* ─── Doors ─── */}
      <SubGroup label={t('showroom.visuals.doors', 'Portes')}>
        <Btn
          onClick={() => onChange(openAllDoors(state))}
          label={t('showroom.visuals.openDoors', 'Ouvrir')}
        />
        <Btn
          onClick={() => onChange(closeAllDoors(state))}
          label={t('showroom.visuals.closeDoors', 'Fermer')}
        />
        <div className="grid grid-cols-2 gap-1 w-full col-span-2 mt-1">
          <ToggleBtn
            active={state.driverFrontDoorOpen}
            onClick={() => onChange(toggle(state, 'driverFrontDoorOpen'))}
            label="LF"
            small
          />
          <ToggleBtn
            active={state.passengerFrontDoorOpen}
            onClick={() => onChange(toggle(state, 'passengerFrontDoorOpen'))}
            label="RF"
            small
          />
          <ToggleBtn
            active={state.driverRearDoorOpen}
            onClick={() => onChange(toggle(state, 'driverRearDoorOpen'))}
            label="LR"
            small
          />
          <ToggleBtn
            active={state.passengerRearDoorOpen}
            onClick={() => onChange(toggle(state, 'passengerRearDoorOpen'))}
            label="RR"
            small
          />
        </div>
      </SubGroup>

      {/* ─── Charging ─── */}
      <SubGroup label={t('showroom.visuals.charging', 'Charge')}>
        <ToggleBtn
          active={state.chargePortDoorOpen}
          onClick={() => onChange(toggle(state, 'chargePortDoorOpen'))}
          label={t('showroom.visuals.chargePort', 'Trappe')}
        />
        <div className="col-span-2 grid grid-cols-3 gap-1 mt-1">
          {(['off', 'plugged', 'charging'] as CableModeKey[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(setCableMode(state, m))}
              className={cableBtnClass(cableMode === m)}
            >
              {t(`showroom.visuals.cable.${m}`,
                m === 'off' ? 'Off' : m === 'plugged' ? 'Branché' : 'Recharge')}
            </button>
          ))}
        </div>
      </SubGroup>

      {/* ─── Security ─── */}
      <SubGroup label={t('showroom.visuals.security', 'Sécurité')}>
        <ToggleBtn
          active={state.isLocked}
          onClick={() => onChange(toggle(state, 'isLocked'))}
          label={t('showroom.visuals.locked', 'Verrouillée')}
          hint={t(
            'showroom.visuals.lockedHint',
            'Toggle = flash phares + rétros pliés',
          )}
        />
        <ToggleBtn
          active={state.sentryMode}
          onClick={() => onChange(toggle(state, 'sentryMode'))}
          label={t('showroom.visuals.sentry', 'Sentinelle')}
        />
      </SubGroup>

      {/* ─── Driving — phares + projections + brake + reverse ─── */}
      <SubGroup label={t('showroom.visuals.driving', 'Conduite')}>
        {(['P', 'D', 'R', 'N'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onChange({ ...state, shiftState: g })}
            className={shiftBtnClass(state.shiftState === g)}
            title={shiftHint(g, t)}
          >
            {g}
          </button>
        ))}
      </SubGroup>

      {isShiftLocked && (
        <p className="text-[10px] text-amber-400/80">
          {t(
            'showroom.visuals.drivingWarning',
            'Mode {{gear}} : phares actifs (D) ou feux de recul (R). Repassez en P pour réinit.',
            { gear: state.shiftState },
          )}
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components — styles deliberately kept inline / minimal here
// since they're only used in this section.
// ─────────────────────────────────────────────────────────────────

function SubGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-[#6b7280]">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

function Btn({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'h-8 px-2 text-xs rounded-md bg-[#1a1a1a] border border-[#2a2a2a] ' +
        'text-[#d4d4d4] hover:bg-[#2a2a2a] hover:text-white transition-colors'
      }
    >
      {label}
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  label,
  hint,
  small,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={
        (small ? 'h-7 px-1 text-[10px] ' : 'h-8 px-2 text-xs ') +
        'rounded-md border transition-colors ' +
        (active
          ? 'bg-[#e31937]/15 border-[#e31937]/60 text-[#fca5a5] hover:bg-[#e31937]/25'
          : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:bg-[#2a2a2a] hover:text-white')
      }
    >
      {label}
    </button>
  );
}

function shiftBtnClass(active: boolean): string {
  return (
    'h-8 px-2 text-xs font-mono font-semibold rounded-md border transition-colors ' +
    (active
      ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
      : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:bg-[#2a2a2a] hover:text-white')
  );
}

function cableBtnClass(active: boolean): string {
  return (
    'h-7 px-2 text-[10px] rounded-md border transition-colors ' +
    (active
      ? 'bg-blue-500/15 border-blue-500/60 text-blue-300'
      : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#9ca3af] hover:bg-[#2a2a2a] hover:text-white')
  );
}

function shiftHint(g: 'P' | 'D' | 'R' | 'N', t: (k: string, fb: string) => string): string {
  switch (g) {
    case 'P': return t('showroom.visuals.shift.P', 'Park · neutre');
    case 'D': return t('showroom.visuals.shift.D', 'Drive · phares + projection avant');
    case 'R': return t('showroom.visuals.shift.R', 'Reverse · feux + projection arrière');
    case 'N': return t('showroom.visuals.shift.N', 'Neutral');
  }
}
