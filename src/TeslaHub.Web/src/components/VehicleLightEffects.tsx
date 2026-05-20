/**
 * Phase 7 — Vehicle light effects driven by live MQTT state.
 *
 * Combines three independent effects on the same scene:
 *
 *   1. Lock flash   — on `isLocked` transition, briefly show the floor
 *                     light projections (Headlights_Projections,
 *                     Stoplights_Projections). Mimics the real Tesla
 *                     behaviour (1 flash on lock, 2 on unlock).
 *
 *   2. Brake/Reverse lights — when `shiftState` is 'D' or 'R', boost
 *                     emissive on the rear brake lights. When 'R', also
 *                     surface the dedicated reverse lights.
 *
 *   3. Sentry pulse — when `sentryMode === true`, render red pulsing
 *                     dots at the four Model 3 Highland camera positions
 *                     (front, B-pillars L/R, rear). No anchor nodes
 *                     exist in the mesh for cameras so we hardcode the
 *                     world positions, calibrated on Poppyseed.
 *
 * Light effects are SCENE-LEVEL state mutations — we directly toggle
 * `visible` and tweak `emissiveIntensity` on the actual Three.js
 * objects via `scene.getObjectByName(...)`. This is more efficient than
 * mounting + unmounting React components for what are conceptually
 * just material parameter changes.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VehicleStatus } from '../api/queries';

interface VehicleLightEffectsProps {
  vehicle: VehicleStatus | undefined;
}

// ---------------------------------------------------------------------------
// Node name constants — match the Poppyseed.tscn hierarchy. See:
// Tesla-APK-Android/.../Ego/v2023/Poppyseed/Poppyseed.tscn
// ---------------------------------------------------------------------------

/** Floor projection meshes — flashed during lock/unlock events. */
const LOCK_FLASH_NODES = [
  'Headlights_Projections',
  'Stoplights_Projections',
] as const;

/** Rear brake lights — boosted emissive when shifting D or R.
 *  Confirmed via GLB inspection (Tesla-Godot-Test/inspect-glb-nodes.mjs). */
const BRAKE_LIGHT_NODES = [
  'Brake_Lights_Left',
  'Brake_Lights_Right',
  'Brake_Lights_Center',
] as const;

/** Reverse lights — boosted emissive only when shifting R. */
const REVERSE_LIGHT_NODES = ['Reverse_Light', 'Reverse_Light_Perf'] as const;

/** Front headlights + DRL — boosted white when driving (D or R), so the
 *  car visually has its headlights ON when shifted into a drive gear.
 *  Without this the front looks "off" while the rear has bright brakes,
 *  which feels asymmetric. Highland exports separate Headlights (low
 *  beam reflector) and DRL (light bar) nodes. */
const HEADLIGHT_NODES = ['Headlights', 'DRL'] as const;

/** Sentry-mode camera positions on Model 3 Highland, in metres.
 *  Coordinate system (confirmed against wheel fallback positions):
 *    +X = forward (front of car)
 *    +Y = up
 *    +Z = right (passenger side)
 *
 *  Model 3 Highland physically has SIX Sentry cameras:
 *    1. Front       — top centre of windshield, behind rear-view mirror
 *    2/3. Fenders   — tiny lens in the front-fender turn-signal grille
 *                     (forward-looking side cams, also used by Autopilot)
 *    4/5. B-pillars — rear-looking side cams, just behind the front-door
 *                     window cutout
 *    6. Rear        — above license plate, on the trunk lid
 *
 *  Calibrated by eye against the real car body lines.
 */
const SENTRY_CAMERA_POSITIONS: ReadonlyArray<[number, number, number]> = [
  [+0.40, 1.32, 0],      // 1. front (top of windshield)
  [+1.10, 0.72, -0.97],  // 2. left front fender (turn-signal lens)
  [+1.10, 0.72, +0.97],  // 3. right front fender (turn-signal lens)
  [-0.18, 1.20, -0.97],  // 4. left B-pillar (rear-looking)
  [-0.18, 1.20, +0.97],  // 5. right B-pillar (rear-looking)
  [-2.00, 0.95, 0],      // 6. rear (above license plate)
];

// ---------------------------------------------------------------------------
// Main effects component
// ---------------------------------------------------------------------------

export function VehicleLightEffects({ vehicle }: VehicleLightEffectsProps) {
  const { scene } = useThree();

  // Order matters here. useGroundProjections sets the STEADY visibility
  // (on while driving / reversing), useLockFlash transiently overrides
  // it for the chirp pattern then restores the snapshot at cleanup. By
  // mounting projections FIRST we guarantee that when lock-flash's
  // restore() runs it reads the correct steady-state value.
  useGroundProjections(scene, vehicle?.shiftState ?? null);
  useLockFlash(scene, vehicle?.isLocked ?? null);
  useBrakeAndReverseLights(scene, vehicle?.shiftState ?? null);

  return <SentryIndicators active={vehicle?.sentryMode === true} />;
}

// ---------------------------------------------------------------------------
// Ground projections — repurpose the floor-projection meshes as ambient
// headlight / brake-light beams while in drive gears.
// ---------------------------------------------------------------------------
//
// Tesla ships two textured quads anchored under the car: Headlights_Projections
// (white fan in front) and Stoplights_Projections (red glow behind). They
// were designed for the top-down view in the Tesla mobile app, but they
// double brilliantly as ambient ground light when the car "has its lights
// on". We turn them on while shifted in D/R, and use them as the chirp
// surface for lock/unlock flashes (see useLockFlash below).

const HEADLIGHT_PROJECTION_NODE = 'Headlights_Projections';
const STOPLIGHT_PROJECTION_NODE = 'Stoplights_Projections';

function useGroundProjections(scene: THREE.Object3D, shiftState: string | null) {
  const shift = (shiftState ?? '').toUpperCase();
  const driving = shift === 'D' || shift === 'R';
  // Tesla doesn't expose a "brakes pressed" signal via MQTT; the closest
  // proxy is reverse gear (always brake-lit by the hardware) plus drive
  // (treated as "lights on, ready to brake"). When we later wire a real
  // brake-press signal we can scope this tighter.
  const stoplightOn = driving;

  useEffect(() => {
    const head = scene.getObjectByName(HEADLIGHT_PROJECTION_NODE);
    const stop = scene.getObjectByName(STOPLIGHT_PROJECTION_NODE);
    if (head) head.visible = driving;
    if (stop) stop.visible = stoplightOn;
    return () => {
      // Revert to hidden — useLockFlash's snapshot reads the current
      // value so revert-on-cleanup must mirror the default state.
      if (head) head.visible = false;
      if (stop) stop.visible = false;
    };
  }, [scene, driving, stoplightOn]);
}

// ---------------------------------------------------------------------------
// Lock flash — driven by isLocked transitions
// ---------------------------------------------------------------------------

/** Lock event timing (milliseconds). Tesla flashes once on lock, twice on
 *  unlock. Each flash is ~250ms on, ~150ms off. */
const FLASH_ON_MS = 250;
const FLASH_GAP_MS = 150;

function useLockFlash(scene: THREE.Object3D, isLocked: boolean | null) {
  // Keep track of previous state so we only flash on TRANSITION, not on
  // every re-render. First render (prevLocked=undefined) does not flash.
  const prevLockedRef = useRef<boolean | null | undefined>(undefined);

  useEffect(() => {
    const prev = prevLockedRef.current;
    prevLockedRef.current = isLocked;

    // Skip the first render and any "no data → data" hops. The very
    // first time MQTT delivers a value, isLocked transitions from
    // null → true (or false), which would be misread as a real lock
    // event and trigger a flash on page load. By bailing out when
    // EITHER side of the transition is null/undefined we ensure we
    // only flash on a genuine state CHANGE while we have data.
    if (prev === undefined) return;
    if (prev === null) return;             // first real data load
    if (prev === isLocked) return;          // not a transition
    if (isLocked === null) return;          // we lost data, ignore

    const flashes = isLocked ? 1 : 2; // 1 chirp on lock, 2 on unlock

    const projections = LOCK_FLASH_NODES
      .map((name) => scene.getObjectByName(name))
      .filter((n): n is THREE.Object3D => !!n);

    if (projections.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[Poppyseed3D] lock flash: no projection meshes found');
      return;
    }

    // Snapshot the CURRENT visibility so we can restore it cleanly
    // when the chirp finishes — useGroundProjections may have set them
    // to `true` if we're in D/R, and we must not stomp that on cleanup.
    const originalVisible = projections.map((n) => n.visible);

    let cancelled = false;
    const timers: number[] = [];

    const setVisible = (visible: boolean) => {
      for (const node of projections) node.visible = visible;
    };
    const restoreOriginal = () => {
      for (let i = 0; i < projections.length; i++) {
        projections[i].visible = originalVisible[i];
      }
    };

    // Sequence: ON, RESTORE, ON, RESTORE, ... ending RESTORE.
    for (let i = 0; i < flashes; i++) {
      const tOn = i * (FLASH_ON_MS + FLASH_GAP_MS);
      const tOff = tOn + FLASH_ON_MS;
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, tOn),
      );
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) restoreOriginal();
        }, tOff),
      );
    }

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
      // If we got cancelled mid-flash, snap back to the steady state
      // (which might be ON in drive mode) so we never leave projections
      // in an inconsistent state.
      restoreOriginal();
    };
  }, [scene, isLocked]);
}

// ---------------------------------------------------------------------------
// Brake + reverse lights — driven by shiftState
// ---------------------------------------------------------------------------

/** When we boost emissive we REPLACE the mesh's material reference with a
 *  clone, mutate the clone, then restore the original on cleanup. We can't
 *  mutate the material in place because Tesla's GLB ships a single shared
 *  "Light" material (id 17) used by BOTH front and rear light meshes —
 *  in-place mutation would also paint the front headlights red when we
 *  light up the brake lights. Confirmed via GLB inspection. */
type MaterialSnapshot = {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  /** Only the materials we ACTUALLY created via clone() — these need to
   *  be disposed on cleanup. Pass-through materials (mats with no emissive
   *  channel) keep their original reference and must NOT be disposed. */
  newClones: THREE.Material[];
};

const BRAKE_INTENSITY = 2.5;
const BRAKE_COLOR = new THREE.Color('#ff1a1a');
const REVERSE_INTENSITY = 1.8;
const REVERSE_COLOR = new THREE.Color('#fff8e8');
const HEADLIGHT_INTENSITY = 1.4;
const HEADLIGHT_COLOR = new THREE.Color('#fff5e8');

function useBrakeAndReverseLights(scene: THREE.Object3D, shiftState: string | null) {
  // Normalise: Tesla returns "P" / "R" / "N" / "D" or null when not
  // recently in motion. Anything else (parked & turned off) → no boost.
  const shift = (shiftState ?? '').toUpperCase();
  const driving = shift === 'D' || shift === 'R';
  const reverseOn = shift === 'R';

  useEffect(() => {
    const snapshots: MaterialSnapshot[] = [];

    const boost = (nodeNames: readonly string[], intensity: number, color: THREE.Color) => {
      for (const name of nodeNames) {
        const root = scene.getObjectByName(name);
        if (!root) continue;
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;

          // Snapshot the ORIGINAL material reference so we can restore it
          // on cleanup. Then build a per-mesh clone array we can safely
          // mutate without touching the shared material instance.
          const origMaterial = mesh.material;
          const origArray = Array.isArray(origMaterial) ? origMaterial : [origMaterial];
          const nextArray: THREE.Material[] = [];
          const newClones: THREE.Material[] = [];

          for (let i = 0; i < origArray.length; i++) {
            const m = origArray[i] as THREE.MeshStandardMaterial;
            if (!m || !m.emissive) {
              nextArray.push(m);
              continue;
            }
            // Material.clone() creates an independent copy — texture maps
            // are still shared (which is what we want, no extra GPU upload)
            // but emissive/colour parameters become per-clone.
            const clone = m.clone();
            clone.emissive.copy(color);
            clone.emissiveIntensity = intensity;
            nextArray.push(clone);
            newClones.push(clone);
          }

          snapshots.push({ mesh, originalMaterial: origMaterial, newClones });
          mesh.material = Array.isArray(origMaterial) ? nextArray : nextArray[0];
        });
      }
    };

    if (driving) {
      boost(BRAKE_LIGHT_NODES, BRAKE_INTENSITY, BRAKE_COLOR);
      // Front headlights ON whenever we're in a drive gear — visually
      // balances the front (white DRL) with the rear (red brakes) and
      // matches how the real car behaves with auto-headlights enabled.
      boost(HEADLIGHT_NODES, HEADLIGHT_INTENSITY, HEADLIGHT_COLOR);
    }
    if (reverseOn) boost(REVERSE_LIGHT_NODES, REVERSE_INTENSITY, REVERSE_COLOR);

    return () => {
      for (const s of snapshots) {
        s.mesh.material = s.originalMaterial;
        for (const c of s.newClones) c.dispose();
      }
    };
  }, [scene, driving, reverseOn]);
}

// ---------------------------------------------------------------------------
// Sentry indicators — pulsing red dots at camera positions
// ---------------------------------------------------------------------------

interface SentryIndicatorsProps {
  active: boolean;
}

function SentryIndicators({ active }: SentryIndicatorsProps) {
  // Shared sphere geometry across all indicators — six tiny spheres are
  // cheap, but reusing the geometry shaves a few KB of GPU memory.
  const geom = useMemo(() => new THREE.SphereGeometry(0.025, 12, 8), []);
  // Single shared material — we animate its opacity from a useFrame
  // hook below, applied to all indicators at once.
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ef4444',
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      }),
    [],
  );

  // Sin-wave pulse: 1 Hz, opacity oscillates between 0.35 and 1.0.
  useFrame(({ clock }) => {
    if (!active) return;
    const t = clock.getElapsedTime();
    const opacity = 0.35 + 0.32 * (1 + Math.sin(t * Math.PI * 2 * 1.0));
    mat.opacity = opacity;
  });

  if (!active) return null;

  return (
    <group renderOrder={100}>
      {SENTRY_CAMERA_POSITIONS.map(([x, y, z], i) => (
        <mesh
          key={i}
          position={[x, y, z]}
          geometry={geom}
          material={mat}
        />
      ))}
    </group>
  );
}
