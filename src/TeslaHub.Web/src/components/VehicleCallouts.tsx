/**
 * Floating "Tesla Car Browser" callouts overlaid on the 3D viewer.
 *
 * Each callout is a small floating button rendered ~60 cm above an
 * anchor mesh in the car, joined to the anchor by a thin white leader
 * line. Tesla's mobile app shows action buttons regardless of body
 * state (you can tap "Coffre" whether it's open or closed), so we
 * mirror that — callouts stay visible as long as the action is
 * reachable, and the icon/colour adapts to the current state.
 *
 *   STATE        VISUAL                 CLICK BEHAVIOUR
 *   closed       discreet white "+"     open the element (issue Tesla command)
 *   open         bold orange "X"        close the element (toggle)
 *   plugged      bold blue "unlock"     release cable latch (charge port only)
 *   no-action    hidden                 — (frunk closed cannot un-close, etc.)
 *
 * Tesla API quirks reflected:
 *   - Frunk cannot be CLOSED remotely (no force sensor on the Model 3
 *     bonnet), so the frunk callout DISAPPEARS once it's already open.
 *     The user closes it manually.
 *   - Charge port endpoint is overloaded — when plugged in it doesn't
 *     toggle the trapdoor any more, it releases the cable latch. We
 *     swap the charge-port callout for an "unlock cable" callout in
 *     that state.
 *   - Doors cannot be opened OR closed remotely on Model 3 Highland
 *     (no remote-door API). We render no door callouts; the 3D
 *     animation alone shows the state.
 *
 * Architecture:
 *   - Tesla command mutations are instantiated by the PARENT (outside
 *     the Canvas) and passed in as `actions`. This avoids relying on
 *     R3F's context bridging for react-query and keeps the click
 *     pipeline identical to HomeQuickActions / OpeningsCard (same
 *     optimistic patches, same wakingHint, same toast feedback).
 */
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleStatus } from '../api/queries';
import { useActiveModel, type CalloutKeyName } from './vehicleModelConfig';
import { useUnits } from '../hooks/useUnits';

// Anchor names live in the model config so a future Y/S/X swap is just
// a config update (vehicleModelConfig.ts). The active config is picked
// per-VIN one level up by <VehicleTopView3D> and supplied through
// Context — we read it via `useActiveModel()` inside the component.

// distanceFactor maps DOM size to a 3D depth value (smaller = smaller
// onscreen). With our camera ~6 m away, 8 produced ~50 px buttons that
// dominated the model. 2.5 keeps them ~16-20 px — visible but tasteful,
// and they shrink/grow naturally with zoom. Tweak here if needed.
const CALLOUT_DISTANCE_FACTOR = 2.5;

export interface CalloutAction {
  onClick: () => void;
  loading: boolean;
}

/**
 * All action handlers the parent must wire up. Unused actions in the
 * current state simply don't fire — the corresponding callout is not
 * rendered.
 */
export interface CalloutsActions {
  openFrunk: CalloutAction;
  openTrunk: CalloutAction;
  closeTrunk: CalloutAction;
  openChargePort: CalloutAction;
  closeChargePort: CalloutAction;
  unlockCable: CalloutAction;
  /** Stop an active charging session. Surfaced INSTEAD of `unlockCable`
   *  while the car is actively charging — Tesla refuses to release the
   *  cable latch mid-charge, so the user must stop first (mirrors the
   *  Control page's separate Stop button). */
  stopCharge: CalloutAction;
  ventWindows: CalloutAction;
  closeWindows: CalloutAction;
  // Phase 2 actions (PR-4) — body-state toggles. Each one is rendered
  // when the corresponding capability is supported by the car AND the
  // live state is known (null = render nothing rather than guess).
  lockVehicle: CalloutAction;
  unlockVehicle: CalloutAction;
  sentryToggle: CalloutAction;
  climateToggle: CalloutAction;
  // Phase 3 actions (PR-9) — extra one-shot or toggleable actions
  // surfaced from the SVG fallback. `defrost` toggles
  // set_preconditioning_max (same endpoint Control's "Précondition"
  // and HomeQuickActions' "Dégivrage" use). `flash` and `honk` are
  // one-shots — the variant stays `closed` (white discreet pill)
  // since there's no "currently flashing" state to reflect.
  defrostToggle: CalloutAction;
  flashLights: CalloutAction;
  honkHorn: CalloutAction;
}

interface VehicleCalloutsProps {
  vehicle: VehicleStatus | undefined;
  actions: CalloutsActions | null;
  /** Showroom preview mode — when true:
   *   - if `actions` is null we substitute no-op handlers so every
   *     callout still renders (positions are visible in the Showroom
   *     even when the Fleet API is intentionally disabled there).
   *   - callouts hidden via `showroomOverrides.calloutsHidden` still
   *     render with a "barré" visual so the user can toggle them
   *     back on / drag them around.
   *
   *  Out of preview (Home, Charging cards…) the click pipeline is
   *  identical to before; hidden callouts skip rendering entirely so
   *  they don't appear on the live page. */
  showroomPreview?: boolean;
}

// No-op action stub used in Showroom preview mode. Keeps the click
// pipeline alive (so React doesn't unmount the leader line / anchor
// dot on hover) but ignores every actual command.
const NOOP_ACTION: CalloutAction = {
  onClick: () => {},
  loading: false,
};
const NOOP_ACTIONS: CalloutsActions = {
  openFrunk: NOOP_ACTION,
  openTrunk: NOOP_ACTION,
  closeTrunk: NOOP_ACTION,
  openChargePort: NOOP_ACTION,
  closeChargePort: NOOP_ACTION,
  unlockCable: NOOP_ACTION,
  stopCharge: NOOP_ACTION,
  ventWindows: NOOP_ACTION,
  closeWindows: NOOP_ACTION,
  lockVehicle: NOOP_ACTION,
  unlockVehicle: NOOP_ACTION,
  sentryToggle: NOOP_ACTION,
  climateToggle: NOOP_ACTION,
  defrostToggle: NOOP_ACTION,
  flashLights: NOOP_ACTION,
  honkHorn: NOOP_ACTION,
};

/**
 * Reads the live state and renders the appropriate set of callouts. If
 * `actions` is null and we're not in Showroom preview, we render
 * NOTHING — the 3D animation alone communicates the state. In Showroom
 * preview every callout renders (with no-op handlers) so the user can
 * see and calibrate them.
 */
export function VehicleCallouts({ vehicle, actions, showroomPreview }: VehicleCalloutsProps) {
  const cfg = useActiveModel();
  const ANCHORS = cfg.actionAnchors;
  const { t } = useTranslation();
  const u = useUnits();
  // Every <Callout> needs a stable "model identity" to know when to drop
  // its cached anchor Object3D. We use the config reference itself — it
  // changes ONLY on VIN-driven model swap, so refs survive cosmetic
  // re-renders but reset cleanly when the GLB swaps.
  if (!vehicle) return null;
  // Showroom preview: subst no-op handlers so callouts always render.
  const effectiveActions: CalloutsActions | null =
    actions ?? (showroomPreview ? NOOP_ACTIONS : null);
  if (!effectiveActions) return null;

  // Per-callout visibility filter — `calloutsHidden[key] === true` hides
  // the callout from the live viewer (Home, Charging…), but the Showroom
  // preview still renders them (with a `hidden` styling) so the user can
  // toggle visibility back on without losing them off-screen.
  const isHidden = (key: CalloutKey): boolean =>
    !!cfg.calloutsHidden?.[key];
  /** Whether this callout should render at all. Out of preview, hidden
   *  callouts are skipped entirely; in preview every callout renders
   *  (hidden ones get a `hidden` visual treatment via `Callout.hidden`). */
  const shouldRender = (key: CalloutKey): boolean =>
    showroomPreview || !isHidden(key);

  const frunkOpen = !!vehicle.frunkOpen;
  const trunkOpen = !!vehicle.trunkOpen;
  const portOpen = !!vehicle.chargePortDoorOpen;
  const pluggedIn = !!vehicle.pluggedIn;
  const windowsOpen = !!vehicle.windowsOpen;
  // Actively charging? Tesla won't release the cable latch mid-charge,
  // so while charging we surface "Stop charging" instead of "Unlock
  // cable" — same intent ordering as the Control page.
  const charging =
    vehicle.chargingState === 'Charging' || vehicle.chargingState === 'Starting';

  return (
    <>
      {/* --- FRUNK --------------------------------------------------------
          Tesla can OPEN it via API but cannot CLOSE it (no anti-pinch
          sensor on the bonnet). We surface the open button only when the
          frunk is already closed; once it's open the callout disappears
          and the user pops it shut by hand. */}
      {!frunkOpen && shouldRender('frunk') && (
        <Callout
          calloutKey="frunk"
          anchorName={ANCHORS.frunk}
          label={t('home.callouts.frunkOpen')}
          icon={<PlusIcon />}
          variant="closed"
          action={effectiveActions.openFrunk}
          hidden={isHidden('frunk')}
        />
      )}

      {/* --- TRUNK -------------------------------------------------------
          Motorised actuator both ways. Single endpoint `actuate_trunk`
          toggles it. */}
      {shouldRender('trunk') && (
        <Callout
          calloutKey="trunk"
          anchorName={ANCHORS.trunk}
          label={trunkOpen ? t('home.callouts.trunkClose') : t('home.callouts.trunkOpen')}
          icon={trunkOpen ? <XIcon /> : <PlusIcon />}
          variant={trunkOpen ? 'open' : 'closed'}
          action={trunkOpen ? effectiveActions.closeTrunk : effectiveActions.openTrunk}
          hidden={isHidden('trunk')}
        />
      )}

      {/* --- CHARGE PORT + CABLE -----------------------------------------
          The single `charge_port_door_open` endpoint is overloaded:
            - on:true  + not plugged → opens trapdoor
            - on:false + not plugged → closes trapdoor
            - on:true  + plugged     → releases cable latch
          We split into two mutually-exclusive callouts based on
          pluggedIn so each click has unambiguous semantics. */}
      {shouldRender('chargePort') && (pluggedIn ? (
        charging ? (
          <Callout
            calloutKey="chargePort"
            anchorName={ANCHORS.chargePort}
            label={t('home.callouts.chargeStop')}
            icon={<StopIcon />}
            variant="open"
            action={effectiveActions.stopCharge}
            hidden={isHidden('chargePort')}
          />
        ) : (
          <Callout
            calloutKey="chargePort"
            anchorName={ANCHORS.chargePort}
            label={t('home.callouts.cableUnlock')}
            icon={<UnlockIcon />}
            variant="plug"
            action={effectiveActions.unlockCable}
            hidden={isHidden('chargePort')}
          />
        )
      ) : (
        <Callout
          calloutKey="chargePort"
          anchorName={ANCHORS.chargePort}
          label={portOpen ? t('home.callouts.chargePortClose') : t('home.callouts.chargePortOpen')}
          icon={portOpen ? <XIcon /> : <PlusIcon />}
          variant={portOpen ? 'open' : 'closed'}
          action={portOpen ? effectiveActions.closeChargePort : effectiveActions.openChargePort}
          hidden={isHidden('chargePort')}
        />
      ))}

      {/* --- WINDOWS -----------------------------------------------------
          TeslaMate exposes only an aggregate boolean. The `vent` Tesla
          command cracks all four 1cm and `close` closes them all. */}
      {shouldRender('window') && (
        <Callout
          calloutKey="window"
          anchorName={ANCHORS.window}
          label={windowsOpen ? t('home.callouts.windowClose') : t('home.callouts.windowVent')}
          icon={windowsOpen ? <XIcon /> : <VentIcon />}
          variant={windowsOpen ? 'open' : 'closed'}
          action={windowsOpen ? effectiveActions.closeWindows : effectiveActions.ventWindows}
          hidden={isHidden('window')}
        />
      )}

      {/* --- LOCK / UNLOCK -----------------------------------------------
          Driver-door anchor. Green pill when locked (safe state, tap
          to unlock), red pill when unlocked (urgent, tap to re-lock).
          Tesla's mobile app mirrors this exact colour logic. */}
      {vehicle.isLocked != null && shouldRender('lock') && (
        <Callout
          calloutKey="lock"
          anchorName={ANCHORS.lock}
          label={vehicle.isLocked ? t('home.callouts.unlock') : t('home.callouts.lock')}
          icon={<LockIcon open={!vehicle.isLocked} />}
          variant={vehicle.isLocked ? 'secure' : 'danger'}
          action={vehicle.isLocked ? effectiveActions.unlockVehicle : effectiveActions.lockVehicle}
          hidden={isHidden('lock')}
        />
      )}

      {/* --- SENTRY MODE -------------------------------------------------
          Toggle the surveillance mode. Blue pill when active, discreet
          white when off. Live state already pulses red sentry-camera
          dots via VehicleLightEffects, so the callout primarily serves
          as the control surface (not the indicator). */}
      {vehicle.sentryMode != null && shouldRender('sentry') && (
        <Callout
          calloutKey="sentry"
          anchorName={ANCHORS.sentry}
          label={vehicle.sentryMode ? t('home.callouts.sentryOn') : t('home.callouts.sentryOff')}
          icon={<EyeIcon />}
          variant={vehicle.sentryMode ? 'info' : 'closed'}
          action={effectiveActions.sentryToggle}
          hidden={isHidden('sentry')}
        />
      )}

      {/* --- CLIMATE ON / OFF --------------------------------------------
          Passenger-side anchor so it doesn't pile up on the driver
          door. Green pill when active. Toggles `climate/start` /
          `climate/stop` via the parent — same endpoint as ClimateCard. */}
      {vehicle.isClimateOn != null && shouldRender('climate') && (
        <Callout
          calloutKey="climate"
          anchorName={ANCHORS.climate}
          label={vehicle.isClimateOn ? t('home.callouts.climateOn') : t('home.callouts.climateOff')}
          icon={<SnowflakeIcon />}
          variant={vehicle.isClimateOn ? 'secure' : 'closed'}
          action={effectiveActions.climateToggle}
          hidden={isHidden('climate')}
        />
      )}

      {/* --- DEFROST -----------------------------------------------------
          Toggle the windshield + rear-window defroster
          (`set_preconditioning_max`). Tesla's mobile app surfaces this
          as a separate button from regular climate, so we mirror that.
          Re-uses the climate anchor as default — user calibrates the
          XYZ offset to move it onto the windshield. */}
      {shouldRender('defrost') && (
        <Callout
          calloutKey="defrost"
          anchorName={ANCHORS.climate}
          label={t('home.callouts.defrost')}
          icon={<DefrostIcon />}
          variant={vehicle.defrostMode === 2 ? 'warning' : 'closed'}
          action={effectiveActions.defrostToggle}
          hidden={isHidden('defrost')}
        />
      )}

      {/* --- FLASH LIGHTS ------------------------------------------------
          One-shot honk-of-headlights. Default anchor = frunk (front
          of the car). User calibrates onto a headlight via the
          Showroom XYZ sliders. */}
      {shouldRender('flash') && (
        <Callout
          calloutKey="flash"
          anchorName={ANCHORS.frunk}
          label={t('home.callouts.flash')}
          icon={<HeadlightIcon />}
          variant="closed"
          action={effectiveActions.flashLights}
          hidden={isHidden('flash')}
        />
      )}

      {/* --- HONK HORN ---------------------------------------------------
          One-shot horn beep. Default anchor = frunk; user calibrates
          onto the grille / hood centre. */}
      {shouldRender('honk') && (
        <Callout
          calloutKey="honk"
          anchorName={ANCHORS.frunk}
          label={t('home.callouts.honk')}
          icon={<HornIcon />}
          variant="closed"
          action={effectiveActions.honkHorn}
          hidden={isHidden('honk')}
        />
      )}

      {/* --- TPMS — 4 data callouts, one per wheel -----------------------
          Each TPMS slot (FL/FR/RL/RR) is mapped to the underlying
          WheelWrapper through `cfg.tpmsAnchorMap` because the wheel IDs
          baked into `wheelFallbackPositions` don't always correspond
          to physical positions — M3 uses +X = forward and the IDs line
          up, but Bayberry (Y) uses +Z = forward and the IDs are rotated
          90°. The map keeps the callout-to-tyre relationship correct
          across families.
          Pressure is rendered in the user's preferred unit (bar / psi).
          Variant follows Tesla's own `tpmsSoftWarningXX` flag as
          authoritative: warning=true → `danger` (red), otherwise →
          `secure` (green). Rendered with `noLine` so the pill sits
          DIRECTLY on the wheel (no leader line + dot crossing the
          car body). Pure data — no onClick. */}
      {TPMS_DEFS.map(({ key, slot, pressure, warning }) => {
        const p = pressure(vehicle);
        const w = warning(vehicle);
        if (p == null && !w) return null;
        if (!shouldRender(key)) return null;
        const wheelId = cfg.tpmsAnchorMap[slot];
        const variant: CalloutVariant =
          w ? 'danger' : 'secure';
        const label = p != null
          ? `${u.fmtPressure(p)} ${u.pressureUnit}`
          : '⚠';
        return (
          <Callout
            key={key}
            calloutKey={key}
            anchorName={`WheelWrapper_${wheelId}`}
            label={label}
            icon={<TpmsIcon warn={w} />}
            variant={variant}
            action={NOOP_ACTION /* data callout — no command fired on click */}
            hidden={isHidden(key)}
            noLine
          />
        );
      })}

      {/* --- USER PRESENCE -----------------------------------------------
          Icon-only data callout showing whether the driver/occupant is
          in the cabin. Anchor defaults to the driver door (lock
          anchor); user nudges it inside the cabin in the Showroom. */}
      {vehicle.isUserPresent != null && shouldRender('userPresent') && (
        <Callout
          calloutKey="userPresent"
          anchorName={ANCHORS.lock}
          label={vehicle.isUserPresent ? t('home.callouts.userPresent') : t('home.callouts.userAbsent')}
          icon={<PersonIcon />}
          variant={vehicle.isUserPresent ? 'secure' : 'closed'}
          action={NOOP_ACTION /* data callout — no command fired on click */}
          hidden={isHidden('userPresent')}
        />
      )}

      {/* --- CLIMATE INFO (interior + exterior temps) --------------------
          Pure data — interior temp / exterior temp as a single pill.
          Default anchor = frunk; user moves it onto the windshield via
          the Showroom XYZ sliders. Renders only when at least one
          temp signal is fresh. */}
      {(vehicle.insideTemp != null || vehicle.outsideTemp != null) && shouldRender('climateInfo') && (
        <Callout
          calloutKey="climateInfo"
          anchorName={ANCHORS.frunk}
          label={
            (vehicle.insideTemp != null ? `${u.fmtTemp(vehicle.insideTemp)}${u.tempUnit}` : '—') +
            ' / ' +
            (vehicle.outsideTemp != null ? `${u.fmtTemp(vehicle.outsideTemp)}${u.tempUnit}` : '—')
          }
          icon={<ThermometerIcon />}
          variant="info"
          action={NOOP_ACTION /* data callout — no command fired on click */}
          hidden={isHidden('climateInfo')}
        />
      )}
    </>
  );
}

// TPMS definitions kept out of the render loop so the closures over
// `pressure(v)` / `warning(v)` stay stable. `slot` is the SEMANTIC
// position (FL/FR/RL/RR) — the per-model `tpmsAnchorMap` resolves it
// to the actual `WheelWrapper_<id>` node at render time.
const TPMS_DEFS: ReadonlyArray<{
  key: CalloutKey;
  slot: 'FL' | 'FR' | 'RL' | 'RR';
  pressure: (v: VehicleStatus) => number | null | undefined;
  warning: (v: VehicleStatus) => boolean | undefined;
}> = [
  {
    key: 'tpmsFL',
    slot: 'FL',
    pressure: (v) => v.tpmsPressureFl,
    warning: (v) => v.tpmsSoftWarningFl ?? undefined,
  },
  {
    key: 'tpmsFR',
    slot: 'FR',
    pressure: (v) => v.tpmsPressureFr,
    warning: (v) => v.tpmsSoftWarningFr ?? undefined,
  },
  {
    key: 'tpmsRL',
    slot: 'RL',
    pressure: (v) => v.tpmsPressureRl,
    warning: (v) => v.tpmsSoftWarningRl ?? undefined,
  },
  {
    key: 'tpmsRR',
    slot: 'RR',
    pressure: (v) => v.tpmsPressureRr,
    warning: (v) => v.tpmsSoftWarningRr ?? undefined,
  },
];

// ---------------------------------------------------------------------------
// Live charge info callout — non-clickable, anchored on the charge port,
// displayed while a session is active. Mirrors the visual language of the
// action callouts (leader line + floating pill) but with a wider info
// panel showing kW / SOC% / time-to-full. Mounted by VehicleTopView3D
// independently from VehicleCallouts so the Fleet API gating doesn't
// apply — a user without virtual key can still see "what their car is
// doing" while it charges.
// ---------------------------------------------------------------------------

export interface LiveChargeInfo {
  /** Live charger power in kW (positive while charging). */
  powerKw: number | null;
  /** Current battery percentage 0-100. */
  socPct: number | null;
  /** Target SOC (used as " → 80%" suffix). */
  targetSocPct: number | null;
  /** Minutes left until full. */
  minutesRemaining: number | null;
}

interface LiveChargeInfoCalloutProps {
  info: LiveChargeInfo;
}

/**
 * Floating "EN CHARGE — 12.4 kW · 67% → 80% · ~25min" panel anchored on
 * the charge-port flap. Updates with the live MQTT/Fleet snapshot, no
 * extra polling. Hidden if no charge data is available.
 */
export function LiveChargeInfoCallout({ info }: LiveChargeInfoCalloutProps) {
  const cfg = useActiveModel();
  const anchorName = cfg.actionAnchors.chargePort;

  const { scene } = useThree();
  const anchorRef = useRef<THREE.Object3D | null>(null);
  const missingLoggedRef = useRef(false);
  // Per-component grace timer: timestamp of the first failed lookup. We can't
  // use the R3F clock for this — it's a global monotonic timer that never
  // resets, so after the app has run a few seconds it would flag every
  // transient miss during a model swap. This resets on every model/anchor swap.
  const lookupStartRef = useRef<number | null>(null);

  useEffect(() => {
    anchorRef.current = null;
    missingLoggedRef.current = false;
    lookupStartRef.current = null;
  }, [anchorName, cfg]);

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const groupRef = useRef<THREE.Group>(null);
  const tip = useRef(new THREE.Vector3());
  const top = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!anchorRef.current) {
      anchorRef.current = scene.getObjectByName(anchorName) ?? null;
      if (!anchorRef.current) {
        if (lookupStartRef.current == null) lookupStartRef.current = performance.now();
        if (
          !missingLoggedRef.current &&
          import.meta.env.DEV &&
          performance.now() - lookupStartRef.current > 5000
        ) {
          missingLoggedRef.current = true;
          // eslint-disable-next-line no-console
          console.warn(
            `[LiveChargeInfoCallout] anchor "${anchorName}" not found after 5s`,
          );
        }
        return;
      }
    }
    if (!groupRef.current) return;
    anchorRef.current.getWorldPosition(tip.current);
    top.current.copy(tip.current);
    // Lift slightly higher than action callouts to avoid stacking with
    // the chargePort action callout when both are visible.
    top.current.y += cfg.calloutHeight + 0.15;

    groupRef.current.position.copy(top.current);

    const pos = lineGeom.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, tip.current.x, tip.current.y, tip.current.z);
    pos.setXYZ(1, top.current.x, top.current.y, top.current.z);
    pos.needsUpdate = true;
  });

  const power = info.powerKw != null && info.powerKw > 0
    ? `${info.powerKw.toFixed(1)} kW`
    : null;
  const socLine = info.socPct != null
    ? info.targetSocPct != null
      ? `${Math.round(info.socPct)}% → ${Math.round(info.targetSocPct)}%`
      : `${Math.round(info.socPct)}%`
    : null;
  const eta = info.minutesRemaining != null && info.minutesRemaining > 0
    ? info.minutesRemaining < 60
      ? `~${Math.round(info.minutesRemaining)} min`
      : `~${(info.minutesRemaining / 60).toFixed(1)} h`
    : null;

  // If absolutely nothing to show, render nothing (still keep the hook
  // chain intact above so positions stay registered).
  if (!power && !socLine && !eta) return null;

  return (
    <>
      <line>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial
          color="#3b82f6"
          transparent
          opacity={0.55}
          depthTest={false}
        />
      </line>

      <group ref={groupRef}>
        <Html
          center
          distanceFactor={CALLOUT_DISTANCE_FACTOR}
          zIndexRange={[18, 0]}
          occlude={false}
        >
          <div
            className={
              'flex items-center gap-1 h-5 px-1.5 rounded-full text-[8px] font-semibold leading-none ' +
              'shadow-[0_2px_6px_rgba(0,0,0,0.45)] border backdrop-blur-md ' +
              'bg-[#3b82f6]/85 border-white/40 text-white'
            }
          >
            <svg viewBox="0 0 12 12" width="7" height="7" fill="currentColor">
              <path d="M7 1 L3 7 L5.5 7 L4.5 11 L9 5 L6.5 5 Z" />
            </svg>
            {power && <span className="whitespace-nowrap">{power}</span>}
            {socLine && (
              <>
                <span className="opacity-50">·</span>
                <span className="whitespace-nowrap tabular-nums">{socLine}</span>
              </>
            )}
            {eta && (
              <>
                <span className="opacity-50">·</span>
                <span className="whitespace-nowrap tabular-nums">{eta}</span>
              </>
            )}
          </div>
        </Html>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Single callout — leader line + Html button that follow the anchor.
// ---------------------------------------------------------------------------

type CalloutVariant = 'closed' | 'open' | 'plug' | 'secure' | 'danger' | 'info' | 'warning';

/**
 * Stable identifier for each callout — keyed by SEMANTIC purpose (not
 * by the underlying scene-node name) so per-car position overrides
 * stored in `showroomOverrides.calloutOffsets` survive future anchor
 * renames or per-model anchor swaps. New callouts must add a key here
 * and the matching position in `calloutOffsets`.
 *
 * Action callouts (clickable, fire a Tesla command):
 *   frunk, trunk, chargePort, window, lock, sentry, climate, defrost,
 *   flash, honk.
 *
 * Data callouts (non-clickable, just surface live state):
 *   tpmsFL, tpmsFR, tpmsRL, tpmsRR (tyre pressure per wheel),
 *   userPresent (driver in cabin),
 *   climateInfo (interior + exterior temps).
 */
// Re-exported from `vehicleModelConfig.ts` so existing call sites that
// `import { CalloutKey } from './VehicleCallouts'` keep working. The
// two type names point to the SAME string-literal union — see the
// `CalloutKeyName` definition in vehicleModelConfig for the docs.
export type CalloutKey = CalloutKeyName;

// Hex colour used by the leader line + anchor dot for each variant.
// Hex form so we can feed both `<lineBasicMaterial color>` (THREE.Color)
// and inline CSS for the dot ring without juggling formats.
const VARIANT_LINE_COLOR: Record<CalloutVariant, string> = {
  closed:  '#ffffff',
  open:    '#f59e0b',
  plug:    '#3b82f6',
  secure:  '#22c55e',
  danger:  '#e31937',
  info:    '#3b82f6',
  // Warning = TPMS borderline (slightly low pressure). Same hue as
  // `open` but kept separate so we can tune them independently later
  // (e.g. open could become more saturated, warning more muted).
  warning: '#f59e0b',
};

interface CalloutProps {
  calloutKey: CalloutKey;
  /** Named scene node to follow. The frame loop calls
   *  `scene.getObjectByName(anchorName)` and copies its world position
   *  every frame, so the callout sticks to the anchor even during
   *  opening animations / variant swaps. */
  anchorName?: string;
  /** Alternative to `anchorName`: a fixed model-space position (in the
   *  same coordinate frame as `wheelFallbackPositions`). Used by TPMS
   *  and any other callout whose anchor doesn't have a stable scene-
   *  node name in the GLB (e.g. user-positioned defrost/flash/honk).
   *  Exactly one of `anchorName` or `anchorPosition` must be set. */
  anchorPosition?: readonly [number, number, number];
  label: string;
  icon: ReactNode;
  variant: CalloutVariant;
  action: CalloutAction;
  /** Showroom-only flag: the callout is rendered (so the user can
   *  position it / toggle visibility back on) but in a dimmed
   *  "barré" treatment to make the hidden state obvious. */
  hidden?: boolean;
  /** Render the pill DIRECTLY at the anchor position, without the
   *  leader line and without the anchor dot. Used by TPMS pills that
   *  sit on the wheel itself — a leader line crossing the car body to
   *  reach a small dot under each wheel was visually busy and made
   *  the wheel callouts hard to read. With `noLine` we keep the
   *  per-callout XYZ calibration (the slider still nudges the pill)
   *  but lose the visual umbilical. */
  noLine?: boolean;
}

function Callout({ calloutKey, anchorName, anchorPosition, label, icon, variant, action, hidden, noLine }: CalloutProps) {
  const { scene } = useThree();
  const cfg = useActiveModel();

  // CRITICAL: lazy resolution via useFrame instead of useMemo.
  //
  // <VehicleCallouts> mounts INSIDE the same <Suspense> as <PoppyseedModel>.
  // When the GLB resolves both components mount on the same render — but at
  // useMemo time R3F hasn't yet committed the <primitive object={cleanedScene} />
  // child into the scene graph. So getObjectByName() returns null on the
  // first render. A useMemo([scene]) never re-runs (scene reference is
  // stable) so the anchor stays null forever and the callout never appears.
  //
  // useFrame runs every frame AFTER R3F has finished its commit, so the
  // child primitives ARE present in the scene graph by the time we look.
  // We resolve once, cache the result in a ref, and skip future lookups.
  // The render output is always present (line + group) so React doesn't
  // need to re-render when the anchor resolves — useFrame just starts
  // updating positions on the existing nodes.
  const anchorRef = useRef<THREE.Object3D | null>(null);
  const missingLoggedRef = useRef(false);

  // Reset the cached anchor on EITHER:
  //   - anchorName change (rare: different node name for same callout
  //     between models — e.g. Window_LF_Spatial vs Window_FL)
  //   - cfg reference change (common: VIN swap to a different model)
  //
  // The cfg-based reset is the important one. When swapping M3 → Y, the
  // old GLB's primitive is detached from the scene root but its INTERNAL
  // children keep their .parent set to siblings in the orphaned tree.
  // So the previous "if (!anchorRef.current.parent) reset" was useless —
  // it never tripped. Hooking onto cfg here gives a bulletproof signal
  // that "everything in the scene has just been swapped, drop caches".
  // Per-component grace timer (see LiveChargeInfoCallout for the rationale):
  // the R3F clock is global and never resets, so it can't be used to gauge how
  // long THIS callout has been waiting for its anchor across model swaps.
  const lookupStartRef = useRef<number | null>(null);

  useEffect(() => {
    anchorRef.current = null;
    missingLoggedRef.current = false;
    lookupStartRef.current = null;
  }, [anchorName, cfg]);

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const groupRef = useRef<THREE.Group>(null);
  const tipGroupRef = useRef<THREE.Group>(null);
  const tip = useRef(new THREE.Vector3());
  const top = useRef(new THREE.Vector3());

  // Per-callout XYZ offset applied AFTER the calloutHeight lift. Stored
  // in showroomOverrides.calloutOffsets and reads through the active
  // model config via `useActiveModel()`. Zero offset = default position
  // directly above the anchor. Used by the Showroom Callouts section
  // to let the user nudge each button independently. Keyed by the
  // semantic `calloutKey` so per-model anchor renames (M3 vs Y) don't
  // invalidate user calibration.
  const offset = cfg.calloutOffsets?.[calloutKey] ?? null;

  useFrame(() => {
    // Two anchor modes coexist. NAMED anchor (the original mode) does
    // a one-shot scene.getObjectByName() lookup and then tracks the
    // node's live world position (= follows opening animations). FIXED
    // anchor (anchorPosition prop) skips the lookup entirely — used by
    // TPMS (wheel centres are positioned via wheelFallbackPositions,
    // not via named GLB nodes) and any user-positioned callout
    // (defrost / flash / honk) whose location is purely a Showroom
    // calibration in model-local coordinates.
    if (anchorPosition) {
      tip.current.set(anchorPosition[0], anchorPosition[1], anchorPosition[2]);
    } else if (anchorName) {
      if (!anchorRef.current) {
        anchorRef.current = scene.getObjectByName(anchorName) ?? null;
        if (!anchorRef.current) {
          // Log once (dev only) if still unresolved 5s after THIS callout
          // started looking — helps spot a genuinely missing anchor
          // (renamed/removed in a GLB rebuild) without false-positives
          // during the heavy GLB load/parse or a model swap.
          if (lookupStartRef.current == null) lookupStartRef.current = performance.now();
          if (
            !missingLoggedRef.current &&
            import.meta.env.DEV &&
            performance.now() - lookupStartRef.current > 5000
          ) {
            missingLoggedRef.current = true;
            // eslint-disable-next-line no-console
            console.warn(
              `[VehicleCallouts] anchor "${anchorName}" not found in scene after 5s ` +
                '(check the GLB export — node may have been stripped).',
            );
          }
          return;
        }
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.info(`[VehicleCallouts] anchor "${anchorName}" resolved`);
      }
      // matrixWorld is updated by R3F before frame callbacks fire, so we
      // can read the live world position even during opening animations.
      anchorRef.current.getWorldPosition(tip.current);
    } else {
      // Caller forgot both props — render nothing.
      return;
    }
    if (!groupRef.current) return;
    // Apply the user-calibrated XYZ offset to the TIP itself (not just
    // the pill). That way the leader line keeps reading as "this pill
    // points at THAT spot on the body" — when the user moves the
    // slider, the anchor dot AND the pill slide together, the line
    // between them stays short and local. Tesla's GLB ships anchors
    // sometimes ~1m off where the visible part actually is (e.g.
    // Hood_Spatial floats above the windshield on the Y); the old
    // pill-only offset meant the line dangled across the whole car
    // even after calibration.
    //
    // Offset axes match the rest of showroomOverrides:
    //   +X = forward · +Y = up · +Z = right.
    if (offset) {
      tip.current.x += offset[0];
      tip.current.y += offset[1];
      tip.current.z += offset[2];
    }
    top.current.copy(tip.current);
    // noLine callouts (TPMS) sit DIRECTLY on the anchor — no extra lift
    // since there's no leader line to make visible. The user can still
    // nudge the pill via the calloutOffsets slider if they want it
    // slightly above / below the centre of the wheel.
    if (!noLine) {
      top.current.y += cfg.calloutHeight;
    }

    groupRef.current.position.copy(top.current);
    if (tipGroupRef.current) {
      tipGroupRef.current.position.copy(tip.current);
    }

    const pos = lineGeom.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, tip.current.x, tip.current.y, tip.current.z);
    pos.setXYZ(1, top.current.x, top.current.y, top.current.z);
    pos.needsUpdate = true;
  });

  // Visual variants:
  //   closed  = "at rest, want to open" → small, discreet, white
  //   open    = "currently open, want to close" → orange, prominent
  //   plug    = "cable latched, want to release" → blue, prominent
  //   secure  = "locked / climate on / good state"             → green
  //   danger  = "unlocked / TPMS critical / urgent"            → Tesla red
  //   info    = "sentry on / climate info / passive good"      → blue
  //   warning = "TPMS borderline / soft alert"                 → amber
  const variantClass =
    variant === 'open'
      ? 'bg-[#f59e0b] hover:bg-[#d97706] text-black opacity-100 border-white/50'
      : variant === 'plug'
        ? 'bg-[#3b82f6] hover:bg-[#2563eb] text-white opacity-100 border-white/40'
        : variant === 'secure'
          ? 'bg-[#22c55e]/85 hover:bg-[#16a34a] text-white opacity-95 border-white/40'
          : variant === 'danger'
            ? 'bg-[#e31937]/85 hover:bg-[#c01530] text-white opacity-100 border-white/40'
            : variant === 'info'
              ? 'bg-[#3b82f6]/80 hover:bg-[#2563eb] text-white opacity-95 border-white/40'
              : variant === 'warning'
                ? 'bg-[#f59e0b]/85 hover:bg-[#d97706] text-black opacity-100 border-white/40'
                : 'bg-white/85 hover:bg-white text-black opacity-55 hover:opacity-100 border-white/25';

  // Leader line + anchor dot colour, picked to match the pill so the
  // "this button controls THIS spot" relationship reads instantly.
  // Closed (at-rest) stays neutral white to avoid visual noise.
  const lineColor = VARIANT_LINE_COLOR[variant];
  // Line opacity follows the same logic — bright when there's something
  // important to act on, dim when at rest.
  const lineOpacity = variant === 'closed' ? 0.35 : 0.7;

  return (
    <>
      {/* Leader line — raw <line> primitive with a mutable BufferGeometry
          keeps allocations to zero per frame. depthTest=false so the
          line stays visible when the camera is on the "wrong" side of
          the anchor (e.g. orbiting behind the car). Tinted with the
          variant colour so the line visually belongs to the button it
          serves (white for at-rest, green for "good state", red for
          "danger", etc.). Skipped entirely for `noLine` callouts
          (TPMS) — they sit on the wheel directly with no umbilical. */}
      {!noLine && (
        <line>
          <primitive object={lineGeom} attach="geometry" />
          <lineBasicMaterial
            color={lineColor}
            transparent
            opacity={lineOpacity}
            depthTest={false}
          />
        </line>
      )}

      {/* Anchor dot — a small flat ring rendered AT the tip in 3D so it
          sits on the car body surface. Same colour as the leader line.
          Tied to the same `groupRef.position` minus the lift would
          drift across frames, so we mount it on its own group whose
          position is updated from `tip.current` every frame. Skipped
          for `noLine` callouts since the pill itself sits on the
          anchor and the dot would just be obscured underneath. */}
      <group ref={tipGroupRef}>
        {!noLine && (
          <mesh renderOrder={998}>
            <sphereGeometry args={[0.025, 14, 14]} />
            <meshBasicMaterial color={lineColor} transparent opacity={lineOpacity} depthTest={false} />
          </mesh>
        )}
      </group>

      <group ref={groupRef}>
        <Html
          center
          // Lower distanceFactor → smaller buttons (see CALLOUT_DISTANCE_FACTOR
          // for the calibration rationale). The button still shrinks/grows
          // with zoom, just at a more tasteful baseline.
          distanceFactor={CALLOUT_DISTANCE_FACTOR}
          // zIndexRange below the rail's 100 so any future Settings/
          // Showroom overlay wins over callouts.
          zIndexRange={[20, 0]}
          // No occlusion test — callouts must remain visible even when
          // the camera angle puts the anchor behind body panels.
          occlude={false}
        >
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.loading}
            title={label}
            aria-label={label}
            className={
              'flex items-center gap-1 h-5 px-1.5 rounded-full text-[8px] font-medium leading-none ' +
              'shadow-[0_2px_6px_rgba(0,0,0,0.45)] border backdrop-blur-md ' +
              'transition-all hover:scale-110 active:scale-95 disabled:opacity-60 ' +
              variantClass +
              // Showroom-only "hidden" treatment: dim + strike-through so
              // the user sees at a glance which callouts are off, while
              // still being able to drag them with the XYZ sliders.
              (hidden ? ' opacity-40 line-through' : '')
            }
          >
            <span className="w-2 h-2 flex items-center justify-center">{icon}</span>
            <span className="whitespace-nowrap">{label}</span>
          </button>
        </Html>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline icons — kept tiny, no external icon library.
// ---------------------------------------------------------------------------

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M6 2v8M2 6h8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="8" height="5" rx="1" />
      <path d="M4 6V4a2 2 0 0 1 4 0" />
    </svg>
  );
}

// Filled rounded square = universal "stop". Used when the car is
// charging so the charge-port callout offers "stop charging" first.
function StopIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="currentColor">
      <rect x="3" y="3" width="6" height="6" rx="1" />
    </svg>
  );
}

function VentIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h8" />
      <path d="M2 8h8" />
      <path d="M4 2v8" />
      <path d="M8 2v8" />
    </svg>
  );
}

function LockIcon({ open }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      {open ? <path d="M4 5.5V3.5a2 2 0 0 1 3.5-1" /> : <path d="M4 5.5V3.5a2 2 0 0 1 4 0v2" />}
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6s2-3.5 5-3.5S11 6 11 6 9 9.5 6 9.5 1 6 1 6z" />
      <circle cx="6" cy="6" r="1.5" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M6 1v10M1 6h10M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  );
}

// Wavy heat-lines rising from a horizontal bar = "defrost / demist".
// Matches Tesla's own in-car icon family.
function DefrostIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10.5h9" />
      <path d="M3 8c0-1 1-1 1-2s-1-1-1-2" />
      <path d="M6 8c0-1 1-1 1-2s-1-1-1-2" />
      <path d="M9 8c0-1 1-1 1-2s-1-1-1-2" />
    </svg>
  );
}

// Half-circle headlight with light beams.
function HeadlightIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h4a3 3 0 0 1 0 6H2z" />
      <path d="M8 4h2M8 6h3M8 8h2" />
    </svg>
  );
}

// Megaphone-style horn glyph.
function HornIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7V5l4-1.5v5L2 7z" />
      <path d="M6 4.2v3.6c1.5-.3 1.5-3.3 0-3.6z" />
      <path d="M9 4l1.5-1M9 6h2M9 8l1.5 1" />
    </svg>
  );
}

// Tire silhouette with optional warning dot. The dot is part of the
// callout label colour anyway, but this glyph reinforces "this pill is
// about a tyre" at a glance even when the callout is partially
// occluded by the wheel.
function TpmsIcon({ warn }: { warn?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <circle cx="6" cy="6" r="1.6" />
      {warn && <circle cx="6" cy="6" r="0.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}

// Driver silhouette — used for the presence callout. Deliberately
// generic (no gender, no clothing) since this is a data marker, not a
// character avatar.
function PersonIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="3.5" r="1.8" />
      <path d="M2.5 10.5c.5-2.5 2-3.5 3.5-3.5s3 1 3.5 3.5" />
    </svg>
  );
}

// Classic mercury thermometer — used for the climate info data
// callout (interior / exterior temp).
function ThermometerIcon() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.5a1.5 1.5 0 0 1 1.5 1.5v4.2a2.3 2.3 0 1 1-3 0V3A1.5 1.5 0 0 1 6 1.5z" />
      <circle cx="6" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
