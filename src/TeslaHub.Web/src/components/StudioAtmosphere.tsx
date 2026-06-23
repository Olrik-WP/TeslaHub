import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial, ContactShadows, Sparkles } from '@react-three/drei';
import {
  EffectComposer,
  Bloom,
  Vignette,
  ToneMapping,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';

/**
 * Tesla-showroom-style atmosphere for the 3D vehicle viewer.
 *
 * Turns the bare "car floating in the void" look into a studio set:
 *   - a graded 3D BACKDROP dome (so the scene owns its background and the
 *     postprocessing pass stays correct),
 *   - a dark glossy REFLECTIVE FLOOR (circular, dissolving into the backdrop
 *     via distance fog — no hard horizon line),
 *   - a soft CONTACT SHADOW so the car is grounded (essential for the
 *     community GLB which ships no baked floor shadow),
 *   - a radial LIGHT POOL on the floor under the car,
 *   - a few soft volumetric LIGHT BEAMS ("sun shafts") drifting from above,
 *   - a cool RIM LIGHT that sculpts the car's shoulder line,
 *   - floating DUST motes (Sparkles),
 *   - light distance FOG,
 *   - BLOOM + VIGNETTE + ACES tone mapping (postprocessing).
 *
 * IMPORTANT — looks great on mobile too. Nothing is removed on weaker
 * devices; instead every cost knob (reflector resolution, bloom kernel,
 * MSAA, particle count) scales down via the `tier` so the rich look is
 * preserved while staying smooth. A <PerformanceMonitor> in the Canvas adds
 * a runtime safety net (drops DPR under sustained load).
 *
 * Ground is at world y = 0 (matches cableGroundAnchor / supercharger).
 */

const GROUND_Y = 0;
const FOG_COLOR = '#0a0b0d';

export type QualityTier = 'high' | 'mid';

/** Pick a quality tier once, from device hints. Both tiers are "beautiful";
 *  `mid` just trims internal resolutions so phones/tablets stay fluid. */
export function useQualityTier(): QualityTier {
  return useMemo(() => {
    if (typeof window === 'undefined') return 'mid';
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const small = window.matchMedia?.('(max-width: 820px)')?.matches ?? false;
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const weak = coarse || small || cores <= 4 || mem <= 4;
    return weak ? 'mid' : 'high';
  }, []);
}

/** Vertical gradient texture for a light shaft: bright core fading out
 *  horizontally and softly capped top + bottom. Generated once. */
function useBeamTexture(): THREE.Texture {
  return useMemo(() => {
    const w = 64;
    const h = 256;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const topFade = Math.min(1, v / 0.3);
      const botFade = Math.min(1, (1 - v) / 0.6);
      const vert = topFade * botFade;
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const dx = Math.abs(u - 0.5) * 2;
        const horiz = Math.pow(1 - dx, 1.7);
        const a = Math.max(0, vert * horiz);
        const i = (y * w + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 249;
        img.data[i + 2] = 233;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Soft radial glow texture for the floor light pool. */
function useGlowTexture(): THREE.Texture {
  return useMemo(() => {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,248,232,0.6)');
    g.addColorStop(0.4, 'rgba(255,246,228,0.22)');
    g.addColorStop(1, 'rgba(255,246,228,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Vertical gradient texture for the backdrop dome (top dark → horizon
 *  slightly lifted → bottom dark). Mapped on a back-side sphere. */
function useDomeTexture(): THREE.Texture {
  return useMemo(() => {
    const h = 256;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#060708'); // top
    g.addColorStop(0.55, '#0e0f12'); // upper horizon lift
    g.addColorStop(0.7, '#121317'); // horizon glow
    g.addColorStop(1, '#070809'); // bottom
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

interface BeamProps {
  texture: THREE.Texture;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  opacity: number;
  phase: number;
}

/** A single volumetric light shaft: two crossed additive planes so it reads
 *  as a 3D beam from any orbit angle. Gently breathes in intensity. */
function LightBeam({ texture, position, rotation, scale, opacity, phase }: BeamProps) {
  const matA = useRef<THREE.MeshBasicMaterial>(null);
  const matB = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const o = opacity * (0.8 + 0.2 * Math.sin(t * 0.45 + phase));
    if (matA.current) matA.current.opacity = o;
    if (matB.current) matB.current.opacity = o;
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={matA}
          map={texture}
          transparent
          opacity={opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={matB}
          map={texture}
          transparent
          opacity={opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

interface Props {
  tier?: QualityTier;
}

export function StudioAtmosphere({ tier = 'high' }: Props) {
  const beamTex = useBeamTexture();
  const glowTex = useGlowTexture();
  const domeTex = useDomeTexture();
  const high = tier === 'high';

  // Soft, wide shafts biased to the upper-left, like studio key lights. Crossed
  // planes => volumetric from any angle. Bloom makes them glow like god-rays.
  const beams = useMemo(
    () =>
      [
        { position: [-3.4, 4.6, -1.4], rotation: [0, 0, 0.2], scale: [4.4, 9.5, 1], opacity: 0.12, phase: 0 },
        { position: [2.8, 4.8, 1.4], rotation: [0, 0, -0.14], scale: [3.8, 10, 1], opacity: 0.09, phase: 1.7 },
        { position: [-0.6, 5, 3], rotation: [0.16, 0, 0.04], scale: [3.4, 9.5, 1], opacity: 0.08, phase: 3.1 },
      ] as Omit<BeamProps, 'texture'>[],
    [],
  );

  return (
    <>
      {/* Distance fog: car stays crisp, the floor dissolves into the dome. */}
      <fog attach="fog" args={[FOG_COLOR, 18, 48]} />

      {/* Graded backdrop dome — owns the visible background so postprocessing
          stays correct and the floor has something to fade into. */}
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[60, 32, 16]} />
        <meshBasicMaterial map={domeTex} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
      </mesh>

      {/* Reflective studio floor — circular so its edge fades uniformly into
          the fog/dome (no straight horizon line). A hair below ground so it
          never z-fights a model's baked floor decal. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y - 0.01, 0]}>
        <circleGeometry args={[40, 64]} />
        <MeshReflectorMaterial
          resolution={high ? 1024 : 512}
          mirror={0.85}
          mixStrength={2.2}
          mixBlur={1}
          blur={[high ? 600 : 300, high ? 200 : 120]}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.2}
          depthScale={1.1}
          roughness={0.55}
          metalness={0.6}
          color="#0a0b0d"
        />
      </mesh>

      {/* Warm light pool on the floor under the car (additive). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y + 0.005, 0]}>
        <planeGeometry args={[13, 13]} />
        <meshBasicMaterial
          map={glowTex}
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Soft contact shadow grounds the car (key for the community GLB). */}
      <ContactShadows
        position={[0, GROUND_Y + 0.002, 0]}
        scale={14}
        far={5}
        blur={2.6}
        opacity={0.62}
        resolution={high ? 512 : 256}
        color="#000000"
      />

      {/* Cool rim/back light to sculpt the shoulder line. */}
      <directionalLight position={[6, 7, -7]} intensity={high ? 0.8 : 0.7} color="#cfe0ff" />

      {/* Volumetric light shafts. */}
      {beams.map((b, i) => (
        <LightBeam key={i} texture={beamTex} {...b} />
      ))}

      {/* Floating dust motes drifting through the beams. */}
      <Sparkles
        count={high ? 90 : 45}
        scale={[13, 6, 13]}
        position={[0, 2.6, 0]}
        size={2.2}
        speed={0.22}
        opacity={0.5}
        color="#fff7e6"
        noise={0.6}
      />

      {/* Postprocessing — Bloom is the big beauty win (reflections, beams and
          lights glow). Kernel/MSAA scale with tier so phones stay smooth. */}
      <EffectComposer multisampling={high ? 4 : 0} enableNormalPass={false}>
        <Bloom
          intensity={high ? 0.7 : 0.55}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.22}
          mipmapBlur
          radius={high ? 0.7 : 0.55}
        />
        <Vignette eskil={false} offset={0.28} darkness={0.72} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}

export default StudioAtmosphere;
