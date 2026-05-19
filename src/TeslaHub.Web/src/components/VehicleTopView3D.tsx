import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  useGLTF,
  OrbitControls,
  Bounds,
  Environment,
  ContactShadows,
  Html,
  useBounds,
} from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import type { VehicleStatus } from '../api/queries';

const MODEL_URL = '/models/poppyseed.glb';
const WHEEL_URL = '/models/wheel_d50_highland.glb';

// Nodes inside the Tesla model that visually pollute a "studio" view because
// they are designed for the original Tesla mobile UI context (puddle lights
// projected on the road, ground shadow plane, etc.). Hidden by default; some
// will come back as dynamic props in Phase 2 (e.g. headlight projections when
// vehicle.headlightsOn is true).
const HIDDEN_NODE_NAMES = new Set([
  'Headlights_Projections',
  'Stoplights_Projections',
  'Ground_Plane',
]);

// Wheel anchor names defined inside Poppyseed.tscn under ROOT/Spatials.
// Tesla flagged the right-side wheels with a marker hint so we can apply a
// mirror on the X axis when needed (the wheel mesh itself is symmetric).
const WHEEL_ANCHORS = [
  { name: 'Wheel_LF_Spatial', mirror: false },
  { name: 'Wheel_LR_Spatial', mirror: false },
  { name: 'Wheel_RF_Spatial', mirror: true },
  { name: 'Wheel_RR_Spatial', mirror: true },
] as const;

function PoppyseedModel({ wheelsAvailable }: { wheelsAvailable: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  const wheelGltf = useGLTF(wheelsAvailable ? WHEEL_URL : MODEL_URL);
  // ^ trick: useGLTF must be called unconditionally (hook rule). When the
  //   wheel asset is missing we reuse the main URL — its scene is then
  //   ignored by the wheel mounting code below.

  const bounds = useBounds();
  const cleanedScene = useMemo(() => {
    const toRemove: THREE.Object3D[] = [];
    const anchors: Record<string, THREE.Object3D> = {};
    scene.traverse((obj) => {
      if (HIDDEN_NODE_NAMES.has(obj.name)) {
        toRemove.push(obj);
      }
      for (const a of WHEEL_ANCHORS) {
        if (obj.name === a.name) anchors[a.name] = obj;
      }
    });

    // Detach (not just hide) the parasite nodes — Three.js Box3.setFromObject
    // includes invisible meshes when computing the bounding box, so without
    // a real removal Bounds.fit() keeps cropping around the projection
    // planes and the car ends up tiny and off-center.
    toRemove.forEach((obj) => obj.parent?.remove(obj));

    if (wheelsAvailable) {
      for (const { name, mirror } of WHEEL_ANCHORS) {
        const anchor = anchors[name];
        if (!anchor) continue;
        const ALREADY = '__teslahub_wheel_attached';
        if ((anchor as unknown as Record<string, boolean>)[ALREADY]) continue;
        const wheelClone = SkeletonUtils.clone(wheelGltf.scene);
        if (mirror) wheelClone.scale.x = -1;
        anchor.add(wheelClone);
        (anchor as unknown as Record<string, boolean>)[ALREADY] = true;
      }
    }

    if (import.meta.env.DEV) {
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // eslint-disable-next-line no-console
      console.log(
        `[Poppyseed3D] removed ${toRemove.length} parasite nodes, ` +
          `wheels=${wheelsAvailable ? 'mounted' : 'skipped (asset missing)'}, ` +
          `bbox size=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} ` +
          `center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`,
      );
    }
    return scene;
  }, [scene, wheelGltf.scene, wheelsAvailable]);

  // Refit the camera once we've mutated the scene tree.
  useEffect(() => {
    if (bounds) bounds.refresh().fit();
  }, [cleanedScene, bounds]);

  return <primitive object={cleanedScene} />;
}

function Loader() {
  return (
    <Html center>
      <div className="text-[#9ca3af] text-xs">Loading 3D model...</div>
    </Html>
  );
}

// Probes the wheel asset once when the canvas mounts. Same trick as
// VehicleTopView for the chassis: returns null while probing, true/false
// once known.
function useAssetAvailable(url: string): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url, { method: 'HEAD', cache: 'force-cache' })
      .then((r) => {
        if (cancelled) return;
        const ct = r.headers.get('content-type') ?? '';
        setAvailable(r.ok && !ct.startsWith('text/'));
      })
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return available;
}

interface Props {
  vehicle: VehicleStatus;
}

export default function VehicleTopView3D({ vehicle: _vehicle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const wheelsAvailable = useAssetAvailable(WHEEL_URL);

  return (
    <div className="relative w-full" style={{ height: 360 }}>
      <Canvas
        ref={canvasRef}
        camera={{ position: [10, 6, 14], fov: 30 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.9;
        }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[10, 15, 10]}
          intensity={0.9}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-8, 6, -8]} intensity={0.25} />

        <Suspense fallback={<Loader />}>
          <Environment preset="city" />
          {/* Bounds re-fits the camera around the visible bbox. We disable
              its auto observe so our manual refresh() after node cleanup is
              authoritative; otherwise the projection planes (visible during
              first frame) would inflate the initial fit. */}
          <Bounds fit clip margin={1.25}>
            {/* Wait until the wheel probe completes before mounting the
                chassis. Otherwise the chassis loads twice via Suspense when
                the wheel state flips from unknown → available. */}
            {wheelsAvailable !== null && (
              <PoppyseedModel wheelsAvailable={wheelsAvailable} />
            )}
          </Bounds>
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.35}
            scale={12}
            blur={2.8}
            far={4}
            resolution={512}
          />
        </Suspense>

        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={4}
          maxDistance={20}
          autoRotate
          autoRotateSpeed={0.6}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.1}
          makeDefault
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
