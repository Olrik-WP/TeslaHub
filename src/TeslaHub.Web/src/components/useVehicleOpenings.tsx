import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  OPENINGS,
  OPENINGS_BY_ID,
  type KeyframeRotation,
  type KeyframeTranslation,
  type OpeningId,
  type OpeningTrack,
} from './vehicleOpenings';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface OpeningsContextValue {
  /** Toggle a single opening (open if closed, close if open). */
  toggle: (id: OpeningId) => void;
  /** Set the target value of a single opening, 0 = closed, 1 = open. */
  set: (id: OpeningId, target: 0 | 1) => void;
  /** Open or close every opening at once. */
  setAll: (target: 0 | 1) => void;
  /** Live progress map (0..1) — re-rendered every frame is too noisy, so this
   *  is the LATEST sampled value (not subscribed); use for one-off reads. */
  readProgress: () => Readonly<Record<OpeningId, number>>;
  /** Last known target per opening (cheap React-state, re-renders the UI). */
  targets: Readonly<Record<OpeningId, 0 | 1>>;
}

const OpeningsContext = createContext<OpeningsContextValue | null>(null);

export function useOpeningsContext(): OpeningsContextValue {
  const ctx = useContext(OpeningsContext);
  if (!ctx) throw new Error('useOpeningsContext must be used inside <OpeningsProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider — pure React state, no Three.js. Children can be UI overlays.
// ---------------------------------------------------------------------------

interface OpeningsProviderProps {
  children: ReactNode;
}

export function OpeningsProvider({ children }: OpeningsProviderProps) {
  const [targets, setTargets] = useState<Record<OpeningId, 0 | 1>>(() =>
    OPENINGS.reduce(
      (acc, o) => {
        acc[o.id] = 0;
        return acc;
      },
      {} as Record<OpeningId, 0 | 1>,
    ),
  );

  // Live animated progress — mutated every frame by useOpeningsAnimator, so
  // we don't trigger React re-renders. UI reads it on demand via readProgress.
  const progressRef = useRef<Record<OpeningId, number>>(
    OPENINGS.reduce(
      (acc, o) => {
        acc[o.id] = 0;
        return acc;
      },
      {} as Record<OpeningId, number>,
    ),
  );

  const set = useCallback((id: OpeningId, target: 0 | 1) => {
    setTargets((prev) => (prev[id] === target ? prev : { ...prev, [id]: target }));
  }, []);

  const toggle = useCallback((id: OpeningId) => {
    setTargets((prev) => ({ ...prev, [id]: prev[id] === 1 ? 0 : 1 }));
  }, []);

  const setAll = useCallback((target: 0 | 1) => {
    setTargets((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const o of OPENINGS) {
        if (next[o.id] !== target) {
          next[o.id] = target;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const readProgress = useCallback(() => progressRef.current, []);

  // Expose the ref to the animator via a sibling hook. We sneak it through
  // the context value as a non-enumerable property to keep the public type
  // clean.
  const value = useMemo<OpeningsContextValue & { __progressRef?: typeof progressRef }>(() => {
    return {
      toggle,
      set,
      setAll,
      readProgress,
      targets,
      __progressRef: progressRef,
    };
  }, [toggle, set, setAll, readProgress, targets]);

  return <OpeningsContext.Provider value={value}>{children}</OpeningsContext.Provider>;
}

// ---------------------------------------------------------------------------
// Internal — keyframe interpolation
// ---------------------------------------------------------------------------

function lerpTriple(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  k: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * Sample a keyframe track at time `time` (seconds). Performs linear
 * interpolation between the two surrounding keyframes — matches Godot's
 * default Animation interp=1 (linear).
 */
function sampleRotation(
  keys: KeyframeRotation[],
  time: number,
): [number, number, number] {
  if (keys.length === 0) return [0, 0, 0];
  if (time <= keys[0].t) return keys[0].eul;
  const last = keys[keys.length - 1];
  if (time >= last.t) return last.eul;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t;
      const k = span > 0 ? (time - a.t) / span : 0;
      return lerpTriple(a.eul, b.eul, k);
    }
  }
  return last.eul;
}

function sampleTranslation(
  keys: KeyframeTranslation[],
  time: number,
): [number, number, number] {
  if (keys.length === 0) return [0, 0, 0];
  if (time <= keys[0].t) return keys[0].pos;
  const last = keys[keys.length - 1];
  if (time >= last.t) return last.pos;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t;
      const k = span > 0 ? (time - a.t) / span : 0;
      return lerpTriple(a.pos, b.pos, k);
    }
  }
  return last.pos;
}

// ---------------------------------------------------------------------------
// Animator — lives inside <Canvas>, snapshots rest transforms, runs useFrame
// ---------------------------------------------------------------------------

/** Cached rest transform per pivot node. */
interface RestTransform {
  node: THREE.Object3D;
  restPos: THREE.Vector3;
  restRot: THREE.Euler;
}

interface AnimatorProps {
  scene: THREE.Object3D;
  /** Speed for the lerp toward the target (units: 1/sec). 4 → ~0.25s to
   *  reach 95% of target. */
  approach?: number;
}

/**
 * Mount inside <Canvas>. Watches targets and progressively animates each
 * pivot node toward `target` (0 = closed, 1 = open). Plays the same
 * keyframes Tesla defined in Godot, sampled at `progress * length` seconds.
 */
export function VehicleOpeningsAnimator({ scene, approach = 4 }: AnimatorProps) {
  const ctx = useContext(OpeningsContext) as
    | (OpeningsContextValue & { __progressRef?: React.MutableRefObject<Record<OpeningId, number>> })
    | null;
  if (!ctx) throw new Error('VehicleOpeningsAnimator requires <OpeningsProvider>');

  // Snapshot rest transforms ONCE per (scene, opening). We do this lazily
  // inside useFrame to ensure the scene graph is fully mounted and any
  // sibling-mutating useMemo (cleanedScene) has already run.
  const restCache = useRef<Map<string, RestTransform>>(new Map());

  const resolveNode = useCallback(
    (name: string): THREE.Object3D | null => {
      const cached = restCache.current.get(name);
      if (cached) return cached.node;
      const found = scene.getObjectByName(name) ?? null;
      if (found) {
        restCache.current.set(name, {
          node: found,
          restPos: found.position.clone(),
          restRot: found.rotation.clone(),
        });
      }
      return found;
    },
    [scene],
  );

  useFrame((_, delta) => {
    const targets = ctx.targets;
    const progress = ctx.__progressRef?.current;
    if (!progress) return;

    // Approach factor independent of frame rate.
    const k = 1 - Math.exp(-approach * delta);

    for (const opening of OPENINGS) {
      const target = targets[opening.id];
      const current = progress[opening.id];
      // Move progress toward target; clamp to [0,1].
      const next = THREE.MathUtils.clamp(current + (target - current) * k, 0, 1);
      // Skip work when fully settled (nothing visually changes).
      const moving = Math.abs(next - current) > 1e-4 || (target === 0 && current > 1e-4) || (target === 1 && current < 1 - 1e-4);
      if (!moving) continue;

      progress[opening.id] = next;
      const time = next * opening.length;

      for (const track of opening.tracks) {
        applyTrack(track, time, resolveNode);
      }
    }
  });

  return null;
}

/**
 * Apply a single keyframe track to its node, offset from the rest transform.
 *
 * Rotation keyframes are in degrees; we convert to radians on application.
 * Translation keyframes are absolute Tesla-authored positions: they ALREADY
 * include the rest offset (e.g. windows have rest=(-0.193, 0.325, 0.056)),
 * so we apply them directly without adding restPos.
 */
function applyTrack(
  track: OpeningTrack,
  time: number,
  resolveNode: (name: string) => THREE.Object3D | null,
): void {
  const node = resolveNode(track.node);
  if (!node) return;
  const rest = node as THREE.Object3D & { userData: Record<string, unknown> };
  // Pull the cached rest from our resolveNode side effect via the closure.
  // (resolveNode populates restCache before returning the node.)
  // We don't actually need restPos for translation tracks (see above), only
  // for rotation tracks that don't start at (0,0,0) — those are rare (only
  // the charge port has a non-zero rest rotation, baked into its keyframes).

  if (track.rotation) {
    const eul = sampleRotation(track.rotation, time);
    node.rotation.set(
      THREE.MathUtils.degToRad(eul[0]),
      THREE.MathUtils.degToRad(eul[1]),
      THREE.MathUtils.degToRad(eul[2]),
      // Godot uses YXZ for rotation_degrees; Three.js default is XYZ. For
      // single-axis rotations the order is irrelevant; for the windows
      // (which combine small rotations on 3 axes) the difference is well
      // below visual perception thresholds (<1° error at peak).
      'YXZ',
    );
  }

  if (track.translation) {
    const pos = sampleTranslation(track.translation, time);
    node.position.set(pos[0], pos[1], pos[2]);
  }

  // Force matrix update so child nodes see the new transform immediately.
  node.updateMatrix();
  // Reference rest to avoid "unused" warning in future cleanup.
  void rest;
}

// ---------------------------------------------------------------------------
// Helpers exposed to UI components
// ---------------------------------------------------------------------------

/**
 * Returns the opening id whose pivot node is an ancestor of the given
 * mesh, or null. Used to route raycast clicks back to the right opening.
 */
export function findOpeningForObject(obj: THREE.Object3D): OpeningId | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    for (const o of OPENINGS) {
      for (const track of o.tracks) {
        if (cur.name === track.node) return o.id;
      }
    }
    cur = cur.parent;
  }
  return null;
}

export { OPENINGS, OPENINGS_BY_ID };
export type { OpeningId };
