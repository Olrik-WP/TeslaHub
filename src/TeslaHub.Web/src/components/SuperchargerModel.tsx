import { Component, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useActiveModel } from './vehicleModelConfig';

/**
 * Tesla Supercharger V3/V4 post — extracted from the mobile app via the
 * Godot pipeline (`supercharger_base.glb`, no integrated cable).
 *
 * Mounted when the car is plugged in or charging. Position and rotation
 * come from the per-car merged config (Showroom overrides → Home).
 */
export function SuperchargerModel() {
  const cfg = useActiveModel();
  const sc = cfg.supercharger;
  const { scene: rawScene } = useGLTF(sc.modelUrl);

  const scene = useMemo(() => {
    const clone = SkeletonUtils.clone(rawScene) as THREE.Group;
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return clone;
  }, [rawScene]);

  const rotationRad = THREE.MathUtils.degToRad(sc.rotationY);
  const scale = sc.scale ?? 1;

  return (
    <group position={sc.position} rotation={[0, rotationRad, 0]} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}

/** Swallow GLB load failures so a missing SC asset never crashes the viewer. */
class SuperchargerErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function SuperchargerModelSafe() {
  return (
    <SuperchargerErrorBoundary>
      <SuperchargerModel />
    </SuperchargerErrorBoundary>
  );
}
