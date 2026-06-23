import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial, ContactShadows, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Tesla-showroom-style atmosphere for the 3D vehicle viewer.
 *
 * Turns the bare "car floating in the void" look into a studio set:
 *   - a dark glossy REFLECTIVE FLOOR (circular, dissolving into the dark via
 *     distance fog — no hard horizon line),
 *   - a soft CONTACT SHADOW so the car is grounded (essential for the
 *     community GLB which ships no baked floor shadow),
 *   - a radial LIGHT POOL on the floor under the car,
 *   - a few volumetric LIGHT BEAMS ("sun shafts") drifting from above,
 *   - a cool RIM LIGHT that sculpts the car's shoulder line,
 *   - floating DUST motes (Sparkles),
 *   - light distance FOG.
 *
 * Deliberately NO postprocessing (Bloom/Vignette/GodRays): on mobile it
 * disabled MSAA (aliasing), darkened the corners (black streaks), and broke
 * particle colours via tone-mapping changes. Everything here is plain,
 * robust scene dressing that renders identically and smoothly on phones and
 * desktop — only the reflector/shadow/particle resolution scales via
 * `compact`.
 *
 * Ground is at world y = 0 (matches cableGroundAnchor / supercharger).
 */

const GROUND_Y = 0;

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
    const o = opacity * (0.82 + 0.18 * Math.sin(t * 0.45 + phase));
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
  /** Smaller scenes (Home card) trim resolutions / counts. Always the full
   *  look — just cheaper internals so phones stay smooth. */
  compact?: boolean;
}

export function StudioAtmosphere({ compact = false }: Props) {
  const beamTex = useBeamTexture();
  const glowTex = useGlowTexture();

  // A few shafts angled like studio key lights, biased to the upper-left.
  // Crossed planes => volumetric from any orbit angle. A touch stronger now
  // that there's no Bloom to make them glow.
  const beams = useMemo(
    () =>
      [
        { position: [-3.2, 4.4, -1.6], rotation: [0, 0, 0.2], scale: [3.4, 9, 1], opacity: 0.22, phase: 0 },
        { position: [2.6, 4.6, 1.2], rotation: [0, 0, -0.15], scale: [2.8, 9.5, 1], opacity: 0.17, phase: 1.7 },
        { position: [-0.4, 4.8, 2.8], rotation: [0.16, 0, 0.05], scale: [2.6, 9, 1], opacity: 0.14, phase: 3.1 },
      ] as Omit<BeamProps, 'texture'>[],
    [],
  );

  return (
    <>
      {/* Distance fog: car stays crisp, the floor dissolves into the dark. */}
      <fog attach="fog" args={['#08090b', 16, 46]} />

      {/* Reflective studio floor — circular so its edge fades uniformly into
          the fog (no straight horizon line). A hair below ground so it never
          z-fights a model's baked floor decal. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y - 0.01, 0]}>
        <circleGeometry args={[42, 64]} />
        <MeshReflectorMaterial
          resolution={compact ? 512 : 1024}
          mirror={0.75}
          mixStrength={1.8}
          mixBlur={1}
          blur={[400, 150]}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.2}
          depthScale={1.1}
          roughness={0.62}
          metalness={0.6}
          color="#0a0b0d"
        />
      </mesh>

      {/* Warm light pool on the floor under the car (additive). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y + 0.005, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial
          map={glowTex}
          transparent
          opacity={0.65}
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
        opacity={0.6}
        resolution={compact ? 256 : 512}
        color="#000000"
      />

      {/* Cool rim/back light to sculpt the shoulder line. */}
      <directionalLight position={[6, 7, -7]} intensity={0.7} color="#cfe0ff" />

      {/* Volumetric light shafts. */}
      {beams.map((b, i) => (
        <LightBeam key={i} texture={beamTex} {...b} />
      ))}

      {/* Floating dust motes — kept above the car (not on the floor) and pure
          white so they never read as coloured specks. */}
      <Sparkles
        count={compact ? 35 : 60}
        scale={[11, 4.5, 11]}
        position={[0, 3.4, 0]}
        size={2}
        speed={0.22}
        opacity={0.45}
        color="#ffffff"
        noise={0.5}
      />
    </>
  );
}

export default StudioAtmosphere;
