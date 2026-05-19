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

// Wheel anchor names from Poppyseed.tscn under ROOT/Spatials. Godot's
// PackedSceneGLTF exporter strips empty Spatial nodes, so these usually
// DON'T survive in the .glb. We keep the lookup as a best-effort first
// pass — if any survived (custom export, edited mesh), they win.
const WHEEL_ANCHORS = [
  { name: 'Wheel_LF_Spatial', mirror: false },
  { name: 'Wheel_LR_Spatial', mirror: false },
  { name: 'Wheel_RF_Spatial', mirror: true },
  { name: 'Wheel_RR_Spatial', mirror: true },
] as const;

// Fallback positions used when the empty anchors above were stripped at
// export. Coordinates come from the real Tesla Model 3 Highland (Poppyseed)
// dimensions: wheelbase 2875 mm, track 1580 mm, 18" wheel radius 343 mm.
// We assume the model's origin is at chassis-ground center (verified via
// bbox center y=0.72 with size y=1.45). Axes:
//   X = longitudinal (front/back)
//   Y = vertical (ground up)
//   Z = lateral (left/right)
// If the wheels appear swapped front/back, flip the sign of x. If swapped
// left/right, flip the sign of z. Mirror is applied on Z so the cylindrical
// wheel keeps its profile when reflected across the car centerline.
const WHEEL_FALLBACK_POSITIONS = [
  { id: 'LF', x: +1.4375, y: 0.343, z: -0.79, mirror: false },
  { id: 'RF', x: +1.4375, y: 0.343, z: +0.79, mirror: true },
  { id: 'LR', x: -1.4375, y: 0.343, z: -0.79, mirror: false },
  { id: 'RR', x: -1.4375, y: 0.343, z: +0.79, mirror: true },
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
    const wheelCandidates: { name: string; type: string; path: string }[] = [];

    const pathOf = (obj: THREE.Object3D): string => {
      const parts: string[] = [];
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        parts.unshift(cur.name || `(${cur.type})`);
        cur = cur.parent;
      }
      return parts.join('/');
    };

    scene.traverse((obj) => {
      if (HIDDEN_NODE_NAMES.has(obj.name)) {
        toRemove.push(obj);
      }
      for (const a of WHEEL_ANCHORS) {
        if (obj.name === a.name) anchors[a.name] = obj;
      }
      // Diagnostic: collect anything that smells like a wheel anchor or
      // mesh, so we can find the real names Godot used at GLB export.
      if (/wheel/i.test(obj.name)) {
        wheelCandidates.push({
          name: obj.name,
          type: obj.type,
          path: pathOf(obj),
        });
      }
    });

    // eslint-disable-next-line no-console
    console.log(
      `[Poppyseed3D] found ${wheelCandidates.length} node(s) matching /wheel/i:`,
      wheelCandidates,
    );

    // Detach (not just hide) the parasite nodes — Three.js Box3.setFromObject
    // includes invisible meshes when computing the bounding box, so without
    // a real removal Bounds.fit() keeps cropping around the projection
    // planes and the car ends up tiny and off-center.
    toRemove.forEach((obj) => obj.parent?.remove(obj));

    let wheelsAttached = 0;
    let wheelMode: 'anchor' | 'fallback' | 'none' = 'none';
    if (wheelsAvailable) {
      const anchorsFound = WHEEL_ANCHORS.filter((a) => anchors[a.name]).length;
      wheelMode = anchorsFound === 4 ? 'anchor' : 'fallback';

      const ALREADY = '__teslahub_wheels_attached';
      if (!(scene as unknown as Record<string, boolean>)[ALREADY]) {
        if (wheelMode === 'anchor') {
          for (const { name, mirror } of WHEEL_ANCHORS) {
            const anchor = anchors[name];
            const wheelClone = SkeletonUtils.clone(wheelGltf.scene);
            if (mirror) wheelClone.scale.z = -1;
            anchor.add(wheelClone);
            wheelsAttached++;
          }
        } else {
          for (const pos of WHEEL_FALLBACK_POSITIONS) {
            const wheelClone = SkeletonUtils.clone(wheelGltf.scene);
            wheelClone.position.set(pos.x, pos.y, pos.z);
            if (pos.mirror) wheelClone.scale.z = -1;
            scene.add(wheelClone);
            wheelsAttached++;
          }
        }
        (scene as unknown as Record<string, boolean>)[ALREADY] = true;
      }
    }

    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // eslint-disable-next-line no-console
    console.log(
      `[Poppyseed3D] removed=${toRemove.length} | wheelsAvailable=${wheelsAvailable} | ` +
        `wheelsMode=${wheelMode} | wheelsAttached=${wheelsAttached}/4 | ` +
        `bbox=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} ` +
        `center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`,
    );
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
        const ok = r.ok && !ct.startsWith('text/');
        // eslint-disable-next-line no-console
        console.log(
          `[Poppyseed3D] probe ${url} → status=${r.status} content-type="${ct}" → available=${ok}`,
        );
        setAvailable(ok);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn(`[Poppyseed3D] probe ${url} failed:`, err);
        setAvailable(false);
      });
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
