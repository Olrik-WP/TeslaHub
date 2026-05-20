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
import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleStatus } from '../api/queries';

// Height (in metres) of the leader line above each anchor. 0.55 keeps
// the callout clear of the car silhouette on the standard camera pose
// (CAMERA_TARGET y=0.6) without rocketing it off-screen on top crops.
const CALLOUT_HEIGHT = 0.55;

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
          anchorName="Hood_Spatial"
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
        anchorName="Trunk_Spatial"
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
          anchorName="Charge_Cap_Spatial"
          label="Déverrouiller câble"
          icon={<UnlockIcon />}
          variant="plug"
          action={actions.unlockCable}
        />
      ) : (
        <Callout
          anchorName="Charge_Cap_Spatial"
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
        anchorName="Window_LF_Spatial"
        label={windowsOpen ? 'Fermer vitres' : 'Aérer vitres'}
        icon={windowsOpen ? <XIcon /> : <VentIcon />}
        variant={windowsOpen ? 'open' : 'closed'}
        action={windowsOpen ? actions.closeWindows : actions.ventWindows}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Single callout — leader line + Html button that follow the anchor.
// ---------------------------------------------------------------------------

type CalloutVariant = 'closed' | 'open' | 'plug';

interface CalloutProps {
  anchorName: string;
  label: string;
  icon: ReactNode;
  variant: CalloutVariant;
  action: CalloutAction;
}

function Callout({ anchorName, label, icon, variant, action }: CalloutProps) {
  const { scene } = useThree();

  // Resolve the anchor once — the Poppyseed scene is static so the
  // ref stays valid for the component's lifetime. If the anchor wasn't
  // exported (rare, but possible after an asset reshuffle) we silently
  // skip rendering rather than show a misplaced callout.
  const anchor = useMemo(() => scene.getObjectByName(anchorName) ?? null, [scene, anchorName]);

  // Geometry buffers reused across frames. lineGeom carries the 2 ×
  // (x,y,z) Float32 positions we mutate every frame; the group is moved
  // to the same `top` point so the <Html> overlay tracks the leader.
  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const groupRef = useRef<THREE.Group>(null);
  const tip = useRef(new THREE.Vector3());
  const top = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!anchor || !groupRef.current) return;
    // matrixWorld is updated by R3F before frame callbacks fire, so we
    // can read the live world position even during opening animations.
    anchor.getWorldPosition(tip.current);
    top.current.copy(tip.current);
    top.current.y += CALLOUT_HEIGHT;

    groupRef.current.position.copy(top.current);

    const pos = lineGeom.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, tip.current.x, tip.current.y, tip.current.z);
    pos.setXYZ(1, top.current.x, top.current.y, top.current.z);
    pos.needsUpdate = true;
  });

  if (!anchor) return null;

  // Visual variants:
  //   closed = "at rest, want to open" → small, discreet, white
  //   open   = "currently open, want to close" → orange, prominent
  //   plug   = "cable latched, want to release" → blue, prominent
  const variantClass =
    variant === 'open'
      ? 'bg-[#f59e0b] hover:bg-[#d97706] text-black opacity-100 border-white/50'
      : variant === 'plug'
        ? 'bg-[#3b82f6] hover:bg-[#2563eb] text-white opacity-100 border-white/40'
        : 'bg-white/85 hover:bg-white text-black opacity-55 hover:opacity-100 border-white/25';
  // Line opacity follows the same logic — bright when there's something
  // important to act on, dim when at rest.
  const lineOpacity = variant === 'closed' ? 0.35 : 0.65;

  return (
    <>
      {/* Leader line — raw <line> primitive with a mutable BufferGeometry
          keeps allocations to zero per frame. depthTest=false so the
          line stays visible when the camera is on the "wrong" side of
          the anchor (e.g. orbiting behind the car). */}
      <line>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial
          color="white"
          transparent
          opacity={lineOpacity}
          depthTest={false}
        />
      </line>

      <group ref={groupRef}>
        <Html
          center
          // distanceFactor scales the DOM element with depth so callouts
          // far from the camera don't dominate. 8 keeps the button
          // ~28px on the default 5.5m camera distance.
          distanceFactor={8}
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
              'flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[10px] font-medium ' +
              'shadow-[0_4px_12px_rgba(0,0,0,0.35)] border backdrop-blur-md ' +
              'transition-all hover:scale-105 active:scale-95 disabled:opacity-60 ' +
              variantClass
            }
          >
            <span className="w-3 h-3 flex items-center justify-center">{icon}</span>
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
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 2v8M2 6h8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="8" height="5" rx="1" />
      <path d="M4 6V4a2 2 0 0 1 4 0" />
    </svg>
  );
}

function VentIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h8" />
      <path d="M2 8h8" />
      <path d="M4 2v8" />
      <path d="M8 2v8" />
    </svg>
  );
}
