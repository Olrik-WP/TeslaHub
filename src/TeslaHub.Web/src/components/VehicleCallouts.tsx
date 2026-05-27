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
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleStatus } from '../api/queries';
import { useActiveModel } from './vehicleModelConfig';

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
  ventWindows: CalloutAction;
  closeWindows: CalloutAction;
  // Phase 2 actions (PR-4) — body-state toggles. Each one is rendered
  // when the corresponding capability is supported by the car AND the
  // live state is known (null = render nothing rather than guess).
  lockVehicle: CalloutAction;
  unlockVehicle: CalloutAction;
  sentryToggle: CalloutAction;
  climateToggle: CalloutAction;
}

interface VehicleCalloutsProps {
  vehicle: VehicleStatus | undefined;
  actions: CalloutsActions | null;
}

/**
 * Reads the live state and renders the appropriate set of callouts. If
 * `actions` is null (Fleet API not configured / virtual key not paired)
 * we render NOTHING — the 3D animation alone communicates the state.
 */
export function VehicleCallouts({ vehicle, actions }: VehicleCalloutsProps) {
  const cfg = useActiveModel();
  const ANCHORS = cfg.actionAnchors;
  // Every <Callout> needs a stable "model identity" to know when to drop
  // its cached anchor Object3D. We use the config reference itself — it
  // changes ONLY on VIN-driven model swap, so refs survive cosmetic
  // re-renders but reset cleanly when the GLB swaps.
  if (!vehicle || !actions) return null;

  const frunkOpen = !!vehicle.frunkOpen;
  const trunkOpen = !!vehicle.trunkOpen;
  const portOpen = !!vehicle.chargePortDoorOpen;
  const pluggedIn = !!vehicle.pluggedIn;
  const windowsOpen = !!vehicle.windowsOpen;

  return (
    <>
      {/* --- FRUNK --------------------------------------------------------
          Tesla can OPEN it via API but cannot CLOSE it (no anti-pinch
          sensor on the bonnet). We surface the open button only when the
          frunk is already closed; once it's open the callout disappears
          and the user pops it shut by hand. */}
      {!frunkOpen && (
        <Callout
          calloutKey="frunk"
          anchorName={ANCHORS.frunk}
          label="Ouvrir frunk"
          icon={<PlusIcon />}
          variant="closed"
          action={actions.openFrunk}
        />
      )}

      {/* --- TRUNK -------------------------------------------------------
          Motorised actuator both ways. Single endpoint `actuate_trunk`
          toggles it. */}
      <Callout
        calloutKey="trunk"
        anchorName={ANCHORS.trunk}
        label={trunkOpen ? 'Fermer coffre' : 'Ouvrir coffre'}
        icon={trunkOpen ? <XIcon /> : <PlusIcon />}
        variant={trunkOpen ? 'open' : 'closed'}
        action={trunkOpen ? actions.closeTrunk : actions.openTrunk}
      />

      {/* --- CHARGE PORT + CABLE -----------------------------------------
          The single `charge_port_door_open` endpoint is overloaded:
            - on:true  + not plugged → opens trapdoor
            - on:false + not plugged → closes trapdoor
            - on:true  + plugged     → releases cable latch
          We split into two mutually-exclusive callouts based on
          pluggedIn so each click has unambiguous semantics. */}
      {pluggedIn ? (
        <Callout
          calloutKey="chargePort"
          anchorName={ANCHORS.chargePort}
          label="Déverrouiller câble"
          icon={<UnlockIcon />}
          variant="plug"
          action={actions.unlockCable}
        />
      ) : (
        <Callout
          calloutKey="chargePort"
          anchorName={ANCHORS.chargePort}
          label={portOpen ? 'Fermer trappe' : 'Ouvrir trappe'}
          icon={portOpen ? <XIcon /> : <PlusIcon />}
          variant={portOpen ? 'open' : 'closed'}
          action={portOpen ? actions.closeChargePort : actions.openChargePort}
        />
      )}

      {/* --- WINDOWS -----------------------------------------------------
          TeslaMate exposes only an aggregate boolean. The `vent` Tesla
          command cracks all four 1cm and `close` closes them all. */}
      <Callout
        calloutKey="window"
        anchorName={ANCHORS.window}
        label={windowsOpen ? 'Fermer vitres' : 'Aérer vitres'}
        icon={windowsOpen ? <XIcon /> : <VentIcon />}
        variant={windowsOpen ? 'open' : 'closed'}
        action={windowsOpen ? actions.closeWindows : actions.ventWindows}
      />

      {/* --- LOCK / UNLOCK -----------------------------------------------
          Driver-door anchor. Green pill when locked (safe state, tap
          to unlock), red pill when unlocked (urgent, tap to re-lock).
          Tesla's mobile app mirrors this exact colour logic. */}
      {vehicle.isLocked != null && (
        <Callout
          calloutKey="lock"
          anchorName={ANCHORS.lock}
          label={vehicle.isLocked ? 'Déverrouiller' : 'Verrouiller'}
          icon={<LockIcon open={!vehicle.isLocked} />}
          variant={vehicle.isLocked ? 'secure' : 'danger'}
          action={vehicle.isLocked ? actions.unlockVehicle : actions.lockVehicle}
        />
      )}

      {/* --- SENTRY MODE -------------------------------------------------
          Toggle the surveillance mode. Blue pill when active, discreet
          white when off. Live state already pulses red sentry-camera
          dots via VehicleLightEffects, so the callout primarily serves
          as the control surface (not the indicator). */}
      {vehicle.sentryMode != null && (
        <Callout
          calloutKey="sentry"
          anchorName={ANCHORS.sentry}
          label={vehicle.sentryMode ? 'Sentinelle ON' : 'Sentinelle'}
          icon={<EyeIcon />}
          variant={vehicle.sentryMode ? 'info' : 'closed'}
          action={actions.sentryToggle}
        />
      )}

      {/* --- CLIMATE ON / OFF --------------------------------------------
          Passenger-side anchor so it doesn't pile up on the driver
          door. Green pill when active. Toggles `climate/start` /
          `climate/stop` via the parent — same endpoint as ClimateCard. */}
      {vehicle.isClimateOn != null && (
        <Callout
          calloutKey="climate"
          anchorName={ANCHORS.climate}
          label={vehicle.isClimateOn ? 'Clim ON' : 'Démarrer clim'}
          icon={<SnowflakeIcon />}
          variant={vehicle.isClimateOn ? 'secure' : 'closed'}
          action={actions.climateToggle}
        />
      )}
    </>
  );
}

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

  useEffect(() => {
    anchorRef.current = null;
    missingLoggedRef.current = false;
  }, [anchorName, cfg]);

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const groupRef = useRef<THREE.Group>(null);
  const tip = useRef(new THREE.Vector3());
  const top = useRef(new THREE.Vector3());

  useFrame(({ clock }) => {
    if (!anchorRef.current) {
      anchorRef.current = scene.getObjectByName(anchorName) ?? null;
      if (!anchorRef.current) {
        if (!missingLoggedRef.current && clock.getElapsedTime() > 2) {
          missingLoggedRef.current = true;
          // eslint-disable-next-line no-console
          console.warn(
            `[LiveChargeInfoCallout] anchor "${anchorName}" not found after 2s`,
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

type CalloutVariant = 'closed' | 'open' | 'plug' | 'secure' | 'danger' | 'info';

/**
 * Stable identifier for each callout — keyed by SEMANTIC purpose (not
 * by the underlying scene-node name) so per-car position overrides
 * stored in `showroomOverrides.calloutOffsets` survive future anchor
 * renames or per-model anchor swaps. New callouts must add a key here
 * and the matching position in `calloutOffsets`.
 */
export type CalloutKey =
  | 'frunk'
  | 'trunk'
  | 'chargePort'
  | 'window'
  | 'lock'
  | 'sentry'
  | 'climate';

// Hex colour used by the leader line + anchor dot for each variant.
// Hex form so we can feed both `<lineBasicMaterial color>` (THREE.Color)
// and inline CSS for the dot ring without juggling formats.
const VARIANT_LINE_COLOR: Record<CalloutVariant, string> = {
  closed: '#ffffff',
  open:   '#f59e0b',
  plug:   '#3b82f6',
  secure: '#22c55e',
  danger: '#e31937',
  info:   '#3b82f6',
};

interface CalloutProps {
  calloutKey: CalloutKey;
  anchorName: string;
  label: string;
  icon: ReactNode;
  variant: CalloutVariant;
  action: CalloutAction;
}

function Callout({ calloutKey, anchorName, label, icon, variant, action }: CalloutProps) {
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
  useEffect(() => {
    anchorRef.current = null;
    missingLoggedRef.current = false;
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

  useFrame(({ clock }) => {
    if (!anchorRef.current) {
      anchorRef.current = scene.getObjectByName(anchorName) ?? null;
      if (!anchorRef.current) {
        // Log once after ~2s if still unresolved — helps spot a real
        // missing anchor (renamed/removed in a GLB rebuild) vs a normal
        // pre-load delay.
        if (!missingLoggedRef.current && clock.getElapsedTime() > 2) {
          missingLoggedRef.current = true;
          // eslint-disable-next-line no-console
          console.warn(
            `[VehicleCallouts] anchor "${anchorName}" not found in scene after 2s ` +
              '(check the GLB export — node may have been stripped).',
          );
        }
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[VehicleCallouts] anchor "${anchorName}" resolved`);
    }
    if (!groupRef.current) return;
    const anchor = anchorRef.current;
    // matrixWorld is updated by R3F before frame callbacks fire, so we
    // can read the live world position even during opening animations.
    anchor.getWorldPosition(tip.current);
    top.current.copy(tip.current);
    top.current.y += cfg.calloutHeight;
    // Apply user-calibrated per-callout offset on top of the default
    // lift. Stored as a plain [x, y, z] tuple in world space so the
    // calibration is intuitive in the Showroom (positive X = forward,
    // positive Y = up, positive Z = right — matches the rest of the
    // overrides).
    if (offset) {
      top.current.x += offset[0];
      top.current.y += offset[1];
      top.current.z += offset[2];
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
  //   closed = "at rest, want to open" → small, discreet, white
  //   open   = "currently open, want to close" → orange, prominent
  //   plug   = "cable latched, want to release" → blue, prominent
  //   secure = "locked / climate on / good state"             → green
  //   danger = "unlocked / urgent attention needed"           → Tesla red
  //   info   = "sentry on / passive informational good state" → blue
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
          "danger", etc.). */}
      <line>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial
          color={lineColor}
          transparent
          opacity={lineOpacity}
          depthTest={false}
        />
      </line>

      {/* Anchor dot — a small flat ring rendered AT the tip in 3D so it
          sits on the car body surface. Same colour as the leader line.
          Tied to the same `groupRef.position` minus the lift would
          drift across frames, so we mount it on its own group whose
          position is updated from `tip.current` every frame. */}
      <group ref={tipGroupRef}>
        <mesh renderOrder={998}>
          <sphereGeometry args={[0.025, 14, 14]} />
          <meshBasicMaterial color={lineColor} transparent opacity={lineOpacity} depthTest={false} />
        </mesh>
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
              variantClass
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
