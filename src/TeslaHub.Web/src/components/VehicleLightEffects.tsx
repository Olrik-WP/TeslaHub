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

/** Rear brake lights — boosted emissive when shifting D or R. */
const BRAKE_LIGHT_NODES = [
  'Brake_Lights_Left',
  'Brake_Lights_Right',
  'Brake_Lights_Center',
] as const;

/** Reverse lights — boosted emissive only when shifting R. */
const REVERSE_LIGHT_NODES = ['Reverse_Light', 'Reverse_Light_Perf'] as const;

/** Sentry-mode camera positions on Model 3 Highland, in metres. Y is up,
 *  X is longitudinal (+forward), Z is lateral (+right). Calibrated by
 *  eye against the real car (camera lens positions on body). */
const SENTRY_CAMERA_POSITIONS: ReadonlyArray<[number, number, number]> = [
  [+0.40, 1.32, 0],     // front-facing camera (top of windshield)
  [-0.18, 1.20, -0.85], // B-pillar left
  [-0.18, 1.20, +0.85], // B-pillar right
  [-2.00, 0.95, 0],     // rear camera (top of trunk lid)
  [+1.95, 0.50, -0.92], // front fender repeater left
  [+1.95, 0.50, +0.92], // front fender repeater right
];

// ---------------------------------------------------------------------------
// Main effects component
// ---------------------------------------------------------------------------

export function VehicleLightEffects({ vehicle }: VehicleLightEffectsProps) {
  const { scene } = useThree();

  useLockFlash(scene, vehicle?.isLocked ?? null);
  useBrakeAndReverseLights(scene, vehicle?.shiftState ?? null);

  return <SentryIndicators active={vehicle?.sentryMode === true} />;
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

    // Skip the first render and any "null → null" re-renders (no real
    // transition, just stale data still loading).
    if (prev === undefined) return;
    if (prev === isLocked) return;
    if (isLocked === null) return; // unknown state, don't flash

    const flashes = isLocked ? 1 : 2; // 1 chirp on lock, 2 on unlock

    const projections = LOCK_FLASH_NODES
      .map((name) => scene.getObjectByName(name))
      .filter((n): n is THREE.Object3D => !!n);

    if (projections.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[Poppyseed3D] lock flash: no projection meshes found');
      return;
    }

    let cancelled = false;
    const timers: number[] = [];

    const setVisible = (visible: boolean) => {
      for (const node of projections) node.visible = visible;
    };

    // Sequence: ON, OFF, ON, OFF, ... ending OFF.
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
          if (!cancelled) setVisible(false);
        }, tOff),
      );
    }

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
      // Force back to hidden if we got cancelled mid-flash, so we never
      // leave the projections lit.
      setVisible(false);
    };
  }, [scene, isLocked]);
}

// ---------------------------------------------------------------------------
// Brake + reverse lights — driven by shiftState
// ---------------------------------------------------------------------------

/** When boosting emissive we save the original and restore on cleanup so
 *  we don't permanently alter the materials. Map from material → original
 *  emissiveIntensity / emissive color. */
type EmissiveSnapshot = {
  material: THREE.MeshStandardMaterial;
  origIntensity: number;
  origColor: THREE.Color;
};

const BRAKE_INTENSITY = 2.5;
const BRAKE_COLOR = new THREE.Color('#ff1a1a');
const REVERSE_INTENSITY = 1.8;
const REVERSE_COLOR = new THREE.Color('#fff8e8');

function useBrakeAndReverseLights(scene: THREE.Object3D, shiftState: string | null) {
  // Normalise: Tesla returns "P" / "R" / "N" / "D" or null when not
  // recently in motion. Anything else (parked & turned off) → no boost.
  const shift = (shiftState ?? '').toUpperCase();
  const brakeOn = shift === 'D' || shift === 'R';
  const reverseOn = shift === 'R';

  useEffect(() => {
    const snapshots: EmissiveSnapshot[] = [];

    const boost = (nodeNames: readonly string[], intensity: number, color: THREE.Color) => {
      for (const name of nodeNames) {
        const root = scene.getObjectByName(name);
        if (!root) continue;
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial;
            if (!mat || !mat.emissive) continue;
            snapshots.push({
              material: mat,
              origIntensity: mat.emissiveIntensity ?? 1,
              origColor: mat.emissive.clone(),
            });
            mat.emissive.copy(color);
            mat.emissiveIntensity = intensity;
          }
        });
      }
    };

    if (brakeOn) boost(BRAKE_LIGHT_NODES, BRAKE_INTENSITY, BRAKE_COLOR);
    if (reverseOn) boost(REVERSE_LIGHT_NODES, REVERSE_INTENSITY, REVERSE_COLOR);

    return () => {
      for (const s of snapshots) {
        s.material.emissive.copy(s.origColor);
        s.material.emissiveIntensity = s.origIntensity;
      }
    };
  }, [scene, brakeOn, reverseOn]);
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
