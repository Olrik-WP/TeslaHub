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
// projected on the road, ground shadow plane, defrost/airflow overlays, etc.).
// Hidden by default; some will come back as dynamic props in Phase 2 (e.g.
// headlight projections when vehicle.headlightsOn is true, defrost when
// vehicle.isDefrostOn is true, airflow overlays when climate is on).
const HIDDEN_NODE_NAMES = new Set([
  // Light cones projected on the floor (designed for top-down Tesla UI).
  'Headlights_Projections',
  'Stoplights_Projections',
  // Ground shadow plane baked under the car (we use ContactShadows instead).
  'Ground_Plane',
  // Tesla CSG overlays — flat planes on the windshields/dashboard used to
  // visualise the defrost and the cabin airflow. They flicker against the
  // glass roof when transparent and serve no purpose in a static view.
  'Defrost_Front',
  'Defrost_Rear',
  'Airflow_left',
  'Airflow_right',
  // Plate viewport: a Godot Viewport that bakes a text label onto a quad
  // (license plate text). Without the live Godot runtime it renders as a
  // black square stuck on the rear bumper.
  'Plate_Viewport',
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
// export. Coordinates derived from real Tesla Model 3 Highland (Poppyseed)
// dimensions:
//   Wheelbase 2875 mm → x ±1.4375 with a +50 mm forward bias for the GLB
//   Track 1580 mm widened to 1700 mm (tires sit outboard of chassis)
//   18" wheel radius 343 mm → wheel center y = 0.343 m
//   Axes: X = longitudinal (+ forward), Y = up, Z = lateral (+ right)
//
// The Godot-exported wheel ships with its Photon cover face on +Z and the
// open hub on -Z. So wheels on the right side of the vehicle (+Z) keep
// the default orientation, and wheels on the left side (-Z) need a
// `scale.z = -1` reflection so their cover also faces outward.
// We use scale-flip rather than Y-rotation because Godot's exported wheel
// has internal transforms that silently cancel any parent rotation,
// while a negative scale always reflects the geometry. Three.js auto-
// reverses face winding for negative scales so normals stay correct.
const WHEEL_FALLBACK_POSITIONS = [
  { id: 'LF', x: +1.4875, y: 0.343, z: -0.78, flipZ: true },
  { id: 'RF', x: +1.4875, y: 0.343, z: +0.78, flipZ: false },
  { id: 'LR', x: -1.3875, y: 0.343, z: -0.78, flipZ: true },
  { id: 'RR', x: -1.3875, y: 0.343, z: +0.78, flipZ: false },
] as const;

// ---- D50 wheel polish -----------------------------------------------------
// The Godot-exported D50 alloy ships with metalness ≈ 0.9 / roughness ≈ 0.1
// (mirror chrome). Under a flat HDR environment with no nearby shiny
// surfaces to reflect, polished metal renders almost black — physically
// correct, visually disappointing. Bumping roughness toward a "brushed
// alloy" feel and boosting envMapIntensity catches more diffuse light.
const WHEEL_ALLOY_MAT_RE = /^(aluminum|aluminium|chrome|metal_anodized|silver)/i;
const WHEEL_ALLOY_ROUGHNESS_MIN = 0.35;
const WHEEL_ALLOY_ENVMAP_BOOST = 1.6;

// ---- Running lights (DISABLED for now) -----------------------------------
// First attempt tried to emissive-boost `Light.material`, `LED_Strip.material`
// and `Illumination1.material`. The emissive idea worked (turn signals lit
// up amber and tail-lights glowed red because the albedo map tints the
// emissive output), BUT those Tesla materials are SHARED between actual
// LED elements AND nearby decorative trims:
//   - Light.material → also painted the white outlines around taillights
//   - Illumination1.material → also painted the charge port lid ring white
// Doing this cleanly requires targeting by NODE NAME (e.g. Headlight_DRL,
// LED_Bar, Charge_Port_Ring) instead of material name, and gating it on
// real vehicle state (vehicle.headlightsOn, vehicle.chargeState, etc.).
// We'll revisit this when wiring the Phase 2 dynamic state.

function PoppyseedModel({ wheelsAvailable }: { wheelsAvailable: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  const wheelGltf = useGLTF(wheelsAvailable ? WHEEL_URL : MODEL_URL);
  // ^ trick: useGLTF must be called unconditionally (hook rule). When the
  //   wheel asset is missing we reuse the main URL — its scene is then
  //   ignored by the wheel mounting code below.

  const bounds = useBounds();
  const cleanedScene = useMemo(() => {
    // Polish the wheel materials ONCE, on the original wheelGltf.scene.
    // SkeletonUtils.clone preserves material references, so tweaks made
    // here propagate to all 4 cloned wheels for free.
    if (wheelsAvailable) {
      const FLAG = '__teslahub_wheel_polished';
      const wheelSceneRef = wheelGltf.scene as unknown as Record<string, boolean>;
      if (!wheelSceneRef[FLAG]) {
        let polishedCount = 0;
        wheelGltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial;
            const matName = (mat as { name?: string }).name ?? '';
            if (WHEEL_ALLOY_MAT_RE.test(matName)) {
              mat.roughness = Math.max(mat.roughness ?? 0.5, WHEEL_ALLOY_ROUGHNESS_MIN);
              mat.envMapIntensity = (mat.envMapIntensity ?? 1) * WHEEL_ALLOY_ENVMAP_BOOST;
              polishedCount++;
            }
          }
        });
        wheelSceneRef[FLAG] = true;
        // eslint-disable-next-line no-console
        console.log(`[Poppyseed3D] polished ${polishedCount} alloy material(s) on wheel`);
      }
    }

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

    // Fix two distinct transparency issues from the Godot → GLB export:
    //
    // 1) GENERIC transparents (side windows, tinted glass, etc.): three.js'
    //    depth sorting flickers them depending on camera angle. Disabling
    //    depthWrite + bumping renderOrder forces them to draw last.
    //
    // 2) THE PANORAMIC GLASS ROOF specifically: Tesla's original Godot 3.2
    //    material relied on a Godot-specific depth_draw_mode that broke
    //    starting from Godot 3.5 — the user confirmed the same flicker
    //    exists in Godot 3.5 itself, so the bug is baked into the GLB.
    //    We apply a stronger fix: force transparent + DoubleSide so the
    //    roof never disappears regardless of viewing angle, plus a higher
    //    renderOrder so it draws after every other glass piece.
    // Walk up the parent chain — Windows_Top is a Group in Godot, so the
    // actual mesh inside has an auto-generated name. Same for the windows
    // and windshields wrapped in Window_LF, Window_RF, Front_Screen etc.
    //
    // OUTER_GLASS_NODE matches the parent Groups in the model hierarchy.
    // OUTER_GLASS_MAT matches Tesla's *_Skybox materials (used for any
    // exterior glass surface that should reflect the environment).
    const OUTER_GLASS_NODE =
      /windows_top|window_l[fr]|window_r[fr]|front_screen|rear_screen|sunroof/i;
    const OUTER_GLASS_MAT = /glass.*skybox|glass_lights/i;
    const isInsideOuterGlass = (start: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = start;
      while (cur) {
        if (OUTER_GLASS_NODE.test(cur.name)) return true;
        cur = cur.parent;
      }
      return false;
    };

// Tesla's Model 3 Highland has factory-tinted glass (toit panoramique
// dark bronze, side windows lightly tinted, custodes dark). We darken
// the original colors via multiplyScalar — keeps existing reflectance
// and HDR highlights, just lowers the diffuse intensity.
const ROOF_TINT = 0.15; // very dark (panoramic roof)
const WINDOW_TINT = 0.45; // moderate (side windows / windshields)

// Body paint color override. Tesla shipped the demo model in a bright
// blue; we override to Pearl White Multi-Coat. Later this could be driven
// by `vehicle.exteriorColor` from the database (Tesla codes: PPSW=white,
// PBSB=black, PMNG=midnight silver, PPMR=red, PPSR=signature red, etc.).
// Hex maps:
//   Pearl White Multi-Coat : 0xF2F2F0
//   Solid Black            : 0x0A0A0A
//   Stealth Grey           : 0x3D3D3D
//   Midnight Silver Metal. : 0x4E5860
//   Deep Blue Metallic     : 0x1B2A45
//   Ultra Red              : 0xB81616
const BODY_PAINT_COLOR = 0xf2f2f0;
// Matches only Tesla's *named* paint materials. We deliberately exclude:
//  - Exterior* (Exterior / Exterior_Fade / Exterior_Perf) — those are
//    composite shells that bake black trims (wipers, rubber seals, mirror
//    backs, plastic handles) into a single mesh using an albedo texture.
//    Overriding their diffuse color tints the black trims too.
//  - Plastic_*, Rubber_*, Chrome, Black_Anodized — obviously not paint.
// Three.js MeshStandardMaterial.color is *multiplied* with the albedo map,
// so for "real" paint materials Tesla uses a neutral/white texture and
// drives the actual color via `mat.color`, which makes recoloring safe.
const BODY_PAINT_MAT = /^paint(_|skybox|$)/i;

    let transparentFixed = 0;
    let roofFixed = 0;
    let windowFixed = 0;
    let paintFixed = 0;
    const glassDebug: string[] = [];
    const paintDebug: string[] = [];
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const isRoof = (() => {
        let cur: THREE.Object3D | null = mesh;
        while (cur) {
          if (/windows_top|sunroof/i.test(cur.name)) return true;
          cur = cur.parent;
        }
        return false;
      })();
      const isOuter = isRoof || isInsideOuterGlass(mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        const mat = m as THREE.Material & {
          opacity?: number;
          side?: THREE.Side;
          color?: THREE.Color;
        };
        const matName = (mat as { name?: string }).name ?? '';

        // Body paint override — re-color only the actual painted shell,
        // keeping reflectance/metalness from the original material so the
        // HDR highlights still look like proper automotive paint.
        if (BODY_PAINT_MAT.test(matName) && mat.color) {
          mat.color.setHex(BODY_PAINT_COLOR);
          paintFixed++;
          // Log every single mesh→material assignment so we can spot a
          // stray trim that's painted by mistake (e.g. wipers/door
          // handles sharing a body material).
          paintDebug.push(`${pathOf(mesh)} mat="${matName}"`);
        }

        const matIsOuter = isOuter || OUTER_GLASS_MAT.test(matName);
        if (matIsOuter) {
          mat.transparent = true;
          mat.depthWrite = false;
          mat.side = THREE.DoubleSide;
          mesh.renderOrder = 2;
          if (mat.color) mat.color.multiplyScalar(isRoof ? ROOF_TINT : WINDOW_TINT);
          if (isRoof) roofFixed++;
          else windowFixed++;
          if (glassDebug.length < 8) {
            glassDebug.push(
              `${isRoof ? 'ROOF' : 'WIN'} ${mesh.name || '(unnamed)'} mat="${matName}"`,
            );
          }
        } else if (mat.transparent || (mat.opacity !== undefined && mat.opacity < 1)) {
          mat.depthWrite = false;
          mesh.renderOrder = 1;
          transparentFixed++;
        }
      }
    });
    if (roofFixed + windowFixed > 0) {
      // eslint-disable-next-line no-console
      console.log('[Poppyseed3D] glass meshes:', glassDebug);
    }
    if (paintFixed > 0) {
      // eslint-disable-next-line no-console
      console.log('[Poppyseed3D] painted meshes:', paintDebug);
    }

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
            if (mirror) wheelClone.rotation.y = Math.PI;
            anchor.add(wheelClone);
            wheelsAttached++;
          }
        } else {
          for (const pos of WHEEL_FALLBACK_POSITIONS) {
            const wheelClone = SkeletonUtils.clone(wheelGltf.scene);

            // Re-center the wheel on its geometric bbox center, so any
            // reflection or rotation pivots around the true center and
            // not the Godot-exported native origin (which sits offset).
            wheelClone.updateMatrixWorld(true);
            const wheelBox = new THREE.Box3().setFromObject(wheelClone);
            const wheelCenter = wheelBox.getCenter(new THREE.Vector3());
            const wheelSize = wheelBox.getSize(new THREE.Vector3());
            wheelClone.position.sub(wheelCenter);

            const wrapper = new THREE.Group();
            wrapper.add(wheelClone);
            wrapper.position.set(pos.x, pos.y, pos.z);
            if (pos.flipZ) wrapper.scale.z = -1;
            scene.add(wrapper);

            wheelsAttached++;
            if (wheelsAttached === 1) {
              // eslint-disable-next-line no-console
              console.log(
                `[Poppyseed3D] wheel native: ` +
                  `size=(${wheelSize.x.toFixed(3)}, ${wheelSize.y.toFixed(3)}, ` +
                  `${wheelSize.z.toFixed(3)}) ` +
                  `center=(${wheelCenter.x.toFixed(3)}, ${wheelCenter.y.toFixed(3)}, ` +
                  `${wheelCenter.z.toFixed(3)})`,
              );
            }
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
        `transparentFixed=${transparentFixed} | roofFixed=${roofFixed} | windowFixed=${windowFixed} | ` +
        `paintFixed=${paintFixed} | ` +
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
        camera={{ position: [8, 5, 11], fov: 35 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          // Slight overexposure helps brushed alloy wheels read against
          // the dark windows and contact shadow.
          gl.toneMappingExposure = 1.05;
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
          {/* margin=1.0 = fit exactly inside canvas, margin>1 adds padding,
              margin<1 zooms in so the car slightly overflows. We can afford
              0.95 because the top/bottom of the bbox is mostly air (sky
              over the roof, tarmac under the wheels). */}
          <Bounds fit clip margin={0.95}>
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
