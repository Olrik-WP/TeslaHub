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

/** Trapezoid shaft geometry: narrow at the TOP (the source), wide at the
 *  BOTTOM (the floor) so it reads as a spotlight cone spreading out — far more
 *  natural than a straight rectangle. Origin centred; spans y∈[-0.5,0.5]. */
function makeShaftGeometry(topW: number, botW: number): THREE.BufferGeometry {
  const tw = topW / 2;
  const bw = botW / 2;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([
    -tw, 0.5, 0, tw, 0.5, 0, bw, -0.5, 0,
    -tw, 0.5, 0, bw, -0.5, 0, -bw, -0.5, 0,
  ]);
  const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Soft, low-contrast cloud texture for the ground mist (very feathered so a
 *  few stacked planes read as a haze, not a disc). */
function useMistTexture(): THREE.Texture {
  return useMemo(() => {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(208,216,230,0.1)');
    g.addColorStop(0.5, 'rgba(202,212,228,0.045)');
    g.addColorStop(1, 'rgba(198,208,226,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Light ground mist: a few large, soft, slowly-drifting horizontal planes
 *  hovering just above the floor. Additive + very low opacity so it veils the
 *  base of the car like fog WITHOUT hiding the reflection or washing the floor.
 *  Sits above the reflector, so it also shows (faintly) in the mirror. */
function GroundFog({ texture }: { texture: THREE.Texture }) {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  const c = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (a.current) a.current.rotation.z = t * 0.015;
    if (b.current) b.current.rotation.z = -t * 0.011 + 1.5;
    if (c.current) c.current.rotation.z = t * 0.008 + 3;
  });
  const layers: Array<{ ref: React.RefObject<THREE.Mesh | null>; y: number; s: number; o: number }> = [
    { ref: a, y: 0.22, s: 30, o: 0.16 },
    { ref: b, y: 0.45, s: 34, o: 0.1 },
    { ref: c, y: 0.72, s: 38, o: 0.06 },
  ];
  return (
    <>
      {layers.map((l, i) => (
        <mesh key={i} ref={l.ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, l.y, 0]}>
          <planeGeometry args={[l.s, l.s]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={l.o}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  );
}

interface BeamProps {
  texture: THREE.Texture;
  geom: THREE.BufferGeometry;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  opacity: number;
  phase: number;
}

/** A single volumetric light shaft: two crossed additive trapezoids so it
 *  reads as a 3D spreading cone from any orbit angle. Breathes in intensity. */
function LightBeam({ texture, geom, position, rotation, scale, opacity, phase }: BeamProps) {
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
      <mesh geometry={geom}>
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
      <mesh geometry={geom} rotation={[0, Math.PI / 2, 0]}>
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
  const mistTex = useMistTexture();
  // Spreading cone shape, shared by every shaft (narrow top → wide bottom).
  const shaftGeom = useMemo(() => makeShaftGeometry(0.22, 1), []);

  // One DOMINANT key shaft from the upper-right (like the reference render),
  // tilted off-vertical so it never looks like a flat curtain, plus two subtle
  // fills. Crossed trapezoids => volumetric, spreading cone from any angle.
  const beams = useMemo(
    () =>
      [
        // Dominant key, upper-right, tilted toward the car.
        { position: [3.4, 5, 1.6], rotation: [0.12, 0, -0.32], scale: [4.2, 10, 1], opacity: 0.26, phase: 0 },
        // Soft fill, upper-left.
        { position: [-3, 4.6, -1.2], rotation: [0, 0, 0.22], scale: [3, 9, 1], opacity: 0.14, phase: 1.7 },
        // Faint rear fill for depth.
        { position: [-0.4, 4.8, 3], rotation: [0.2, 0, 0.05], scale: [2.6, 9, 1], opacity: 0.1, phase: 3.1 },
      ] as Omit<BeamProps, 'texture' | 'geom'>[],
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
          mirror={0.92}
          mixStrength={1.5}
          mixBlur={0.35}
          blur={[120, 45]}
          minDepthThreshold={0.2}
          maxDepthThreshold={1.0}
          depthScale={1.2}
          roughness={0.4}
          metalness={0.7}
          // Graphite, dark + contrasty. Keep a TOUCH of HDR ambiance (not 0)
          // so the floor stays alive instead of flat-dead — the grey wash came
          // mostly from the spotlight (now decay=2), not this. The planar car
          // reflection is independent (reflector pass, not the env map).
          envMapIntensity={0.08}
          color="#0a0b0e"
        />
      </mesh>

      {/* Warm light pool on the floor under the car (additive). Kept small +
          subtle so it accents the centre instead of greying the whole floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y + 0.005, 0]}>
        <planeGeometry args={[8.5, 8.5]} />
        <meshBasicMaterial
          map={glowTex}
          transparent
          opacity={0.3}
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

      {/* Dramatic KEY SPOTLIGHT from the upper-right — lights the roof/shoulder
          like the reference render and lays a CONCENTRATED pool on the floor.
          decay=2 (physical falloff) is the key: the light fades with distance
          so only the centre brightens and the rest of the floor stays dark —
          decay=0 was flooding the whole floor into flat grey. Aimed at the
          floor centre (default target at origin). */}
      <spotLight
        position={[5.5, 9, 3.5]}
        angle={0.5}
        penumbra={1}
        decay={2}
        distance={30}
        intensity={340}
        color="#fff6e8"
      />

      {/* Cool rim/back light to sculpt the far shoulder line. */}
      <directionalLight position={[-6, 6, -7]} intensity={0.55} color="#cfe0ff" />

      {/* Volumetric light shafts (spreading cones). */}
      {beams.map((b, i) => (
        <LightBeam key={i} texture={beamTex} geom={shaftGeom} {...b} />
      ))}

      {/* Light drifting ground mist. */}
      <GroundFog texture={mistTex} />

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
