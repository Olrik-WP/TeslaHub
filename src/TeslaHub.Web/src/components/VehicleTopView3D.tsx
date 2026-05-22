import { Suspense, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  useGLTF,
  OrbitControls,
  Environment,
  Html,
} from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import type { VehicleStatus } from '../api/queries';
import {
  OpeningsProvider,
  VehicleOpeningsAnimator,
  useOpeningsContext,
} from './useVehicleOpenings';
import { ChargingCable } from './ChargingCable';
import { useVehicleVisualSync } from './VehicleVisualSync';
import { VehicleCallouts, type CalloutAction, type CalloutsActions } from './VehicleCallouts';
import { VehicleLightEffects } from './VehicleLightEffects';
import type { CableMode } from './ShowroomControls';
import {
  presumeSupported,
  useControlAvailability,
  useControlMutation,
  type OptimisticPatch,
} from '../hooks/useVehicleControl';
import {
  PoppyseedConfig,
  VehicleModelContext,
  useActiveModel,
} from './vehicleModelConfig';
import { useResolvedModelConfig, wrapPngUrl } from './useResolvedModelConfig';
import type { ShowroomOverrides } from './showroomOverrides';

// Charging handle is universal across Tesla models — same physical part
// regardless of which car it's plugged into. Not in the per-model config.
const HANDLE_URL = '/models/charger_handle.glb';

// ---- Debug visualisation context -----------------------------------------
// Showroom-only ephemeral toggles. When `glass = true` every glass mesh is
// repainted in a high-saturation hue per role (outer/inner-mixed/inner-solo/
// nomat-glass/nomat-privacy) so the user can SEE which slider affects which
// pane. NOT persisted — `showroomMode` consumers wire local state here and
// flip it on/off from the GlassSection toggle.
export interface ShowroomDebugFlags {
  /** Colour-code every glass mesh by role (outer = red, inner-mixed =
   *  blue, inner-solo = green, nomat-glass = orange, nomat-privacy =
   *  violet). Pure visualisation aid for the Showroom calibration. */
  glass: boolean;
}
const DEFAULT_DEBUG_FLAGS: ShowroomDebugFlags = { glass: false };
const ShowroomDebugContext = createContext<ShowroomDebugFlags>(DEFAULT_DEBUG_FLAGS);
// URL of the custom body wrap PNG to apply on top of the `Paint`
// material (NOT `PaintRough`). `null` = no wrap, render solid paint
// via `bodyPaintColor`. Resolved in the outer VehicleTopView3D from
// the override blob + per-car upload existence flag, then consumed
// by `PoppyseedModel` to load + apply the texture.
const WrapUrlContext = createContext<string | null>(null);
// Bright per-role colours; saturated enough to read clearly through
// the HDR environment lighting even at low opacity.
const GLASS_DEBUG_COLORS = {
  outer:         { color: 0xff0000, opacity: 0.55 }, // red
  innerMixed:    { color: 0x0066ff, opacity: 0.55 }, // blue
  innerSolo:     { color: 0x00ff66, opacity: 0.55 }, // green
  nomatGlass:    { color: 0xff8800, opacity: 0.55 }, // orange
  nomatPrivacy:  { color: 0xff00ff, opacity: 0.55 }, // violet
} as const;

// ---- Ground projections ---------------------------------------------------
// The Tesla mobile app draws two textured quads under the car as ambient
// light overlays: `Headlights_Projection*` in front, `Stoplights_*` /
// `BrakeLightProjection*` behind. Each model's GLB now ships with the
// proper baked baseColorTexture on those meshes (the Model 3 projections
// were rebaked from the Bayberry materials in Godot — see
// docs/3d-viewer-spec.md). The runtime no longer touches the projection
// materials; visibility is toggled by `useGroundProjections` in
// VehicleLightEffects based on shift state (D/R).

// ---- Wheel polish ---------------------------------------------------------
// The D50 base wheel set on the Highland is actually a BLACK PLASTIC
// hubcap (Photon-style cover), not an alloy. So most of our wheel meshes
// use Plastic_Black_D50 / Rubber_D50 materials. Polished alloy treatment
// stays in this file for later when we add real alloy variants (Glider,
// Helix_19, Wishbone, ZeroG, etc). Tesla reuses these material names
// Wheel material classification:
//   TIRE  → matches tire brand / "Tire" naming (Pirelli, Conti, Tire,
//           legacy Plastic_Black/Rubber). Kept matte-black, but envMap
//           lifted a bit so the spoke design stays readable.
//   ALLOY → EVERYTHING ELSE on the wheel mesh. Each wheel design ships
//           its rim under its own bespoke material name
//           (`Helix2_Dark2`, `GeminiDark3`, `Arachnid_V2_213`,
//           `BayberryE41Material`, untitled primitives on D50
//           Highland…). Earlier we tried to match the rim with a
//           "starts-with-aluminum|chrome|silver" regex and it FAILED
//           on every modern Tesla wheel GLB — the Showroom alloy
//           sliders were silently no-op. Default-to-alloy is robust:
//           every primitive whose material isn't a tire gets the
//           polish (roughness, envBoost, optional tint).
const WHEEL_TIRE_MAT_RE = /^(tire|pirelli|conti(nental)?|michelin|rubber|plastic_black)/i;

// ---- Per-model derived constants -----------------------------------------
// Returns the same shape as the old file-level CFG block, but driven by
// the React Context-provided `useActiveModel()`. Memoised on the config
// reference so it only rebuilds when the user switches car (rare). The
// Vector3s / Sets are constructed ONCE per swap, not per render.
function useModelConsts() {
  const cfg = useActiveModel();
  return useMemo(
    () => ({
      cfg,
      MODEL_URL: cfg.modelUrl,
      WHEEL_URL: cfg.wheelUrl,
      CHARGE_PORT_NODE: cfg.chargePort.nodeName,
      CHARGE_PORT_ALT_NAMES: cfg.chargePort.alternateNames,
      CHARGE_PORT_FALLBACK_WORLD: new THREE.Vector3(...cfg.chargePort.fallbackWorld),
      PORT_FROM_PIVOT_OFFSET: new THREE.Vector3(...cfg.chargePort.pivotToSocketOffset),
      PLUG_DIRECTION: new THREE.Vector3(...cfg.chargePort.plugDirection),
      CABLE_GROUND_WORLD: new THREE.Vector3(...cfg.cableGroundAnchor),
      FLOOR_NODE_NAMES: new Set(cfg.floorNodes),
      HIDDEN_NODE_NAMES: new Set(cfg.hiddenNodes),
      // Re-asserted on every cleanedScene pass so they can never be
      // turned back on (useful for ugly leftover meshes like Y E41's
      // bumper-mounted DRL_*/HighBeam_* clusters).
      PERMANENTLY_HIDDEN_NODE_NAMES: new Set(cfg.permanentlyHiddenNodes ?? []),
      CONDITIONALLY_HIDDEN_NODE_NAMES: new Set([
        cfg.groundProjectionNodes.headlights,
        cfg.groundProjectionNodes.stoplights,
      ]),
      WHEEL_ANCHORS: cfg.wheelAnchorNames,
      WHEEL_FALLBACK_POSITIONS: cfg.wheelFallbackPositions,
    }),
    [cfg],
  );
}

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
  const {
    cfg,
    MODEL_URL,
    WHEEL_URL,
    HIDDEN_NODE_NAMES,
    PERMANENTLY_HIDDEN_NODE_NAMES,
    CONDITIONALLY_HIDDEN_NODE_NAMES,
    FLOOR_NODE_NAMES,
    WHEEL_ANCHORS,
    WHEEL_FALLBACK_POSITIONS,
  } = useModelConsts();
  const debug = useContext(ShowroomDebugContext);
  const debugGlass = debug.glass;
  const { scene: rawScene } = useGLTF(MODEL_URL);
  const wheelGltf = useGLTF(wheelsAvailable ? WHEEL_URL : MODEL_URL);
  // ^ trick: useGLTF must be called unconditionally (hook rule). When the
  //   wheel asset is missing we reuse the main URL — its scene is then
  //   ignored by the wheel mounting code below.

  // CRITICAL: drei caches the parsed GLTF scene by URL — every viewer
  // mounted with the same URL gets the SAME `rawScene` object. That
  // means when Home and Showroom both render the M3, any node mutation
  // (door rotation, wheel attachment, paint colour…) made by one
  // viewer is also visible in the other.
  // SkeletonUtils.clone() duplicates the scene graph but PRESERVES
  // material + geometry references — so each viewer gets its own set
  // of transforms while shared GPU resources stay shared. The clone is
  // cheap (<1 ms on a ~200-node Tesla GLB) and is recomputed only when
  // the underlying URL/scene changes (model swap), not on every render.
  const scene = useMemo(() => SkeletonUtils.clone(rawScene), [rawScene]);

  const cleanedScene = useMemo(() => {
    // Polish the wheel materials ONCE, on the original wheelGltf.scene.
    // SkeletonUtils.clone preserves material references, so tweaks made
    // here propagate to all 4 cloned wheels for free.
    if (wheelsAvailable) {
      // Snapshot the GLB's baseline material values ONCE per wheel scene
      // so the Showroom can tune `wheelFinish` (roughness, envBoost,
      // tint) up AND back down. Without the snapshot, every Showroom
      // tick would compound the multiplier on the previous frame's
      // already-boosted value (envMapIntensity → +∞, tint → drift).
      type WheelSnap = { roughness: number; envMapIntensity: number; color: number };
      const SNAP_KEY = '__teslahub_wheel_snap';
      const wheelSceneAny = wheelGltf.scene as unknown as Record<string, unknown>;
      let snap = wheelSceneAny[SNAP_KEY] as WeakMap<THREE.Material, WheelSnap> | undefined;
      if (!snap) {
        snap = new WeakMap();
        wheelSceneAny[SNAP_KEY] = snap;
      }
      const finish = cfg.wheelFinish;
      let alloyCount = 0;
      let plasticCount = 0;
      const seenMats: string[] = [];
      wheelGltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial;
          const matName = (mat as { name?: string }).name ?? '';
          if (seenMats.indexOf(matName) === -1) seenMats.push(matName);
          // Capture baseline ONCE — every subsequent re-run computes from
          // these reference values, never from the mutated current ones.
          let base = snap!.get(mat);
          if (!base) {
            base = {
              roughness: mat.roughness ?? 0.5,
              envMapIntensity: mat.envMapIntensity ?? 1,
              color: mat.color ? mat.color.getHex() : 0xffffff,
            };
            snap!.set(mat, base);
          }
          if (WHEEL_TIRE_MAT_RE.test(matName)) {
            mat.metalness = 0;
            mat.roughness = finish.plasticRoughness;
            mat.envMapIntensity = base.envMapIntensity * finish.plasticEnvBoost;
            plasticCount++;
          } else {
            // Everything that's not a tire on a wheel mesh is treated
            // as alloy/rim — covers all the bespoke Tesla material
            // names (Helix2_Dark2, GeminiDark3, Arachnid_V2_213,
            // BayberryE41Material, untitled primitives on D50, etc.).
            mat.roughness = Math.max(base.roughness, finish.alloyRoughnessMin);
            mat.envMapIntensity = base.envMapIntensity * finish.alloyEnvBoost;
            if (mat.color) {
              if (finish.alloyTint !== undefined) {
                mat.color.setHex(finish.alloyTint);
              } else {
                mat.color.setHex(base.color);
              }
            }
            alloyCount++;
          }
        }
      });
      // eslint-disable-next-line no-console
      console.log(
        `[Poppyseed3D] wheel polish: alloy=${alloyCount} plastic=${plasticCount} | ` +
          `materials seen: ${seenMats.join(', ')}`,
      );
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

    type WithProjInit = { __teslahub_proj_init?: boolean };
    const sceneInit = scene as THREE.Object3D & WithProjInit;
    const hideProjectionsOnInit = !sceneInit.__teslahub_proj_init;

    // VARIANT AXIS visibility filter — Tesla packs every trim / drive
    // layout / market region / audio package into ONE GLB by shipping
    // duplicate overlapping meshes (M3: Bumper_F_Base vs Bumper_F_Perf
    // for trim, Steering_Wheel_Spatial vs Steering_Wheel_RHD_Spatial
    // for drive, Plate_EU vs Plate_US for market, …). Without
    // filtering they all overlap and z-fight.
    //
    // Build two lookups across ALL axes:
    //   - variantAllNodes    : every node referenced by ANY option
    //                          across ANY axis (the "swap pool")
    //   - variantActiveNodes : the union of nodes owned by the
    //                          currently-active option of each axis
    //
    // Then every traversed node in `variantAllNodes` is visible iff
    // it's in `variantActiveNodes`. Nodes outside the pool stay
    // untouched (shared body, doors, etc.).
    const variantAxes = cfg.variantAxes;
    const variantAllNodes = new Set<string>();
    const variantActiveNodes = new Set<string>();
    if (variantAxes && variantAxes.length > 0) {
      for (const axis of variantAxes) {
        const activeId =
          cfg.activeVariants?.[axis.id] ?? axis.defaultOption;
        for (const opt of axis.options) {
          for (const n of opt.ownedNodes) variantAllNodes.add(n);
          if (opt.id === activeId) {
            for (const n of opt.ownedNodes) variantActiveNodes.add(n);
          }
        }
      }
    }

    scene.traverse((obj) => {
      if (HIDDEN_NODE_NAMES.has(obj.name)) {
        toRemove.push(obj);
      } else if (PERMANENTLY_HIDDEN_NODE_NAMES.has(obj.name)) {
        // Re-asserted EVERY pass so they can never be revived. Used
        // for the misplaced Y E41 DRL_*/HighBeam_* clusters which
        // sit on the bumper and look like floating headlight chunks.
        obj.visible = false;
      } else if (variantAllNodes.has(obj.name)) {
        // Mesh participates in a variant swap (trim, drive layout,
        // market region, audio package…) — visible only when its
        // owning option is active. Re-asserted on every pass so a
        // Showroom toggle updates the silhouette live.
        obj.visible = variantActiveNodes.has(obj.name);
      } else if (CONDITIONALLY_HIDDEN_NODE_NAMES.has(obj.name)) {
        // Hide projection nodes ONCE at first attach. After that
        // useGroundProjections owns their `.visible` flag (D/R +
        // lock flash). Re-running this traverse on every cleanedScene
        // memo tick (Showroom door buttons, slider drags…) was
        // stomping visible back to false and killing the beams.
        if (hideProjectionsOnInit) {
          obj.visible = false;
        }
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

    if (hideProjectionsOnInit) {
      sceneInit.__teslahub_proj_init = true;
    }

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
    // GLASS ZONING — every outer-glass mesh is classified into one of
    // three calibration zones based on its parent-node chain:
    //
    //   - 'door'  → 4 door windows (Window_(L|R)[FR] on M3, Window_(FL|FR|RL|RR) on Y)
    //   - 'pano'  → panoramic roof + windshield + lunette (Windows_Top on M3, Fade + Static_Exterior on Y)
    //   - 'trunk' → trunk hatch outer glass (Y Trunk_Cover_Main only; M3 has none)
    //
    // Any mesh whose material matches OUTER_GLASS_MAT but whose parent
    // chain matches NONE of the zone regexes is left untouched — this
    // is the firewall that stops glass sliders from leaking onto the
    // headlight covers (Tesla shares the `Glass`/`Glass_Lights` material
    // across body glass AND lights on both models, so material-name
    // matching alone would tint the headlights red).
    const OUTER_GLASS_MAT = cfg.materialPatterns.outerGlassMaterial;
    const INNER_GLASS_MAT = cfg.materialPatterns.innerGlassMaterial;
    const zoning = cfg.glassZoning;
    type GlassZone = 'door' | 'pano' | 'trunk' | null;
    const classifyGlassZone = (start: THREE.Object3D): GlassZone => {
      let cur: THREE.Object3D | null = start;
      while (cur) {
        const n = cur.name;
        if (zoning.doorWindowNode.test(n)) return 'door';
        if (zoning.panoroofNode.test(n)) return 'pano';
        if (zoning.trunkGlassNode?.test(n)) return 'trunk';
        if (zoning.sharedBodyNode?.test(n)) return 'pano';
        cur = cur.parent;
      }
      return null;
    };
    const isOnFloor = (start: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = start;
      while (cur) {
        if (FLOOR_NODE_NAMES.has(cur.name)) return true;
        cur = cur.parent;
      }
      return false;
    };

// Tesla's Model 3 Highland has factory-tinted glass (toit panoramique
// dark bronze, side windows lightly tinted, custodes dark). We darken
// the original colors via multiplyScalar — keeps existing reflectance
// and HDR highlights, just lowers the diffuse intensity.
// Outer glass tint scalars are now driven per zone via
// `cfg.glassFinish.{doorWindowTint,panoroofTint,trunkGlassTint}` so
// the Showroom can dial each zone independently.

// Body paint color override + matcher — sourced from cfg so each model
// can use its own naming convention. Hex defaults to Pearl White
// Multi-Coat (0xF2F2F0). Later this can be driven by
// `vehicle.exteriorColor` (Tesla codes: PPSW=white, PBSB=black,
// PMNG=midnight silver, PPMR=red, PPSR=signature red, etc.).
//   Pearl White Multi-Coat : 0xF2F2F0
//   Solid Black            : 0x0A0A0A
//   Stealth Grey           : 0x3D3D3D
//   Midnight Silver Metal. : 0x4E5860
//   Deep Blue Metallic     : 0x1B2A45
//   Ultra Red              : 0xB81616
//
// IMPORTANT: the per-model regex must NOT match composite "shell"
// materials (e.g. `Exterior`, `Exterior_Fade`) that bake black trims
// (wipers, rubber seals, mirror backs, plastic handles) into a single
// mesh via an albedo texture — overriding their diffuse colour tints
// the black trims too. Three.js multiplies `MeshStandardMaterial.color`
// with the albedo map, so for "real" paint materials Tesla uses a
// neutral texture and drives the colour via `mat.color`, which makes
// recolouring safe — that's the only kind we want to match.
const BODY_PAINT_COLOR = cfg.bodyPaintColor;
const BODY_PAINT_MAT = cfg.materialPatterns.bodyPaint;

    let transparentFixed = 0;
    let roofFixed = 0;
    let windowFixed = 0;
    let paintFixed = 0;
    let floorFixed = 0;
    const glassDebug: string[] = [];
    const paintDebug: string[] = [];

    // ──────────────────────────────────────────────────────────────────
    // Pre-pass: detect glass role at the PARENT GROUP level.
    //
    // Tesla reuses the SAME `Glass_Interior` material on meshes that
    // play very different visual roles:
    //   • windshield + front door windows : Glass_Interior sits BEHIND
    //     an outer Glass/Glass_Windows pane → role 'mixed'
    //   • rear door windows on the Y      : Glass_Interior is the
    //     ONLY pane on the mesh           → role 'inner-only'
    //
    // We need opposite treatments for the two roles:
    //   - mixed      → KILL the mirror (rough+env) and lower opacity so
    //                  the cabin shows through the layered glass.
    //   - inner-only → KEEP the reflection — it's the only thing that
    //                  reads as "tinted glass" instead of a black panel.
    //
    // CRITICAL: three.js's GLTFLoader splits each glTF mesh's primitives
    // into separate Mesh objects nested under a Group sharing the
    // original node name (Static_Exterior → mesh_45_0, mesh_45_1, …).
    // Each sub-Mesh therefore carries only ONE material, so per-mesh
    // role detection picks 'inner-only' for the Glass_Interior pane of
    // the windshield because its sibling Glass primitive is a separate
    // sub-Mesh. We must aggregate flags at the parent Group level
    // (across sibling sub-meshes) and then propagate the role down.
    // ──────────────────────────────────────────────────────────────────
    type GlassRole = 'mixed' | 'inner-only' | 'outer-only' | 'none';
    const meshGlassRole = new WeakMap<THREE.Mesh, GlassRole>();
    const groupFlags = new WeakMap<
      THREE.Object3D,
      { hasOuter: boolean; hasInner: boolean }
    >();
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const group = m.parent ?? m;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      let hasOuterMat = false;
      let hasInnerMat = false;
      for (const mat of mats) {
        if (!mat) continue;
        const n = (mat as { name?: string }).name ?? '';
        if (OUTER_GLASS_MAT.test(n)) hasOuterMat = true;
        if (INNER_GLASS_MAT.test(n)) hasInnerMat = true;
      }
      // Only consider OUTER presence when the mesh actually lives in a
      // glass zone — otherwise headlight covers (which carry a `Glass`
      // or `Glass_Lights` material on both M3 and Y) would be flagged
      // as "outer glass parents" and pull the windshield-tint slider
      // onto the lights via the mixed/solo role classifier.
      const zone = classifyGlassZone(m);
      const inGlassZone = zone !== null;
      const existing = groupFlags.get(group) ?? { hasOuter: false, hasInner: false };
      if (hasOuterMat && inGlassZone) existing.hasOuter = true;
      if (hasInnerMat) existing.hasInner = true;
      groupFlags.set(group, existing);
    });
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const group = m.parent ?? m;
      const flags = groupFlags.get(group);
      let role: GlassRole = 'none';
      if (flags) {
        if (flags.hasOuter && flags.hasInner) role = 'mixed';
        else if (flags.hasInner) role = 'inner-only';
        else if (flags.hasOuter) role = 'outer-only';
      }
      meshGlassRole.set(m, role);
    });


    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Classify which calibration zone this mesh belongs to. Null
      // means "not body glass" — used as the firewall below.
      const glassZone = classifyGlassZone(mesh);
      const isInGlassZone = glassZone !== null;
      const isRoof = glassZone === 'pano';
      const isTrunk = glassZone === 'trunk';
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        const mat = m as THREE.Material & {
          opacity?: number;
          side?: THREE.Side;
          color?: THREE.Color;
        };
        const matName = (mat as { name?: string }).name ?? '';

        // Tesla studio floor — radial shadow baked into a textured quad.
        // Godot names it "Floor" (see ground_shadow_path in Poppyseed.tscn);
        // the GLB also carries "Ground_Plane". A MeshStandardMaterial gets
        // lit by ambient+directional+HDR env which lightens the centre of
        // the gradient (the bit that should be pitch black) to grey/white.
        // Swap to an unlit MeshBasicMaterial so the texture acts as a pure
        // alpha mask over a black quad — true shadow regardless of lighting.
        if (isOnFloor(mesh)) {
          const std = mat as THREE.MeshStandardMaterial;
          const tex = std.map ?? undefined;
          if (tex) tex.colorSpace = THREE.SRGBColorSpace;
          const basic = new THREE.MeshBasicMaterial({
            color: 0x000000,
            map: tex,
            alphaMap: tex,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            opacity: 0.9,
          });
          if (Array.isArray(mesh.material)) {
            const idx = mesh.material.indexOf(mat as THREE.Material);
            if (idx >= 0) mesh.material[idx] = basic;
          } else {
            mesh.material = basic;
          }
          mesh.renderOrder = -10;
          floorFixed++;
          continue;
        }

        // Ground projection quads — every GLB now ships the baked Tesla
        // beam texture on `Headlights_Projection*` / `Stoplights_*` /
        // `BrakeLightProjection*` (the M3 export was rebaked from the
        // Bayberry materials in Godot). GLTFLoader compiles the
        // MeshStandardMaterial with its baked baseColorTexture intact;
        // we just skip these meshes here so the glass / paint logic
        // below doesn't run on them. Visibility (D/R) is toggled by
        // useGroundProjections.
        const headName = cfg.groundProjectionNodes.headlights;
        const stopName = cfg.groundProjectionNodes.stoplights;
        let isProjection = false;
        for (let c: THREE.Object3D | null = mesh; c; c = c.parent) {
          if (c.name === headName || c.name === stopName) {
            isProjection = true;
            break;
          }
        }
        if (isProjection) continue;

        // GLTFLoader's default material — bright white CHROME (metalness=1).
        // Tesla exports the Bayberry windshield as a primitive WITHOUT a
        // material reference inside Static_Exterior. GLTFLoader silently
        // assigns a cached MeshStandardMaterial (color=white, metalness=1,
        // roughness=1, NO name) to all such primitives — see
        // createDefaultMaterial() in three.js GLTFLoader.js. Combined with
        // the HDR `Environment preset="city"`, the windshield becomes a
        // bright chrome mirror reflecting the sky — exactly the "mur gris"
        // the user reported. Detect by fingerprint (the loader doesn't tag
        // it with a name) and replace each occurrence with a sensible dark
        // tinted glass material so it reads as windshield, not chrome.
        const isGltfDefaultMat = (() => {
          if (matName !== '') return false;
          const std = mat as THREE.MeshStandardMaterial;
          if (!(std as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return false;
          if (!std.color) return false;
          return (
            std.color.r >= 0.99 &&
            std.color.g >= 0.99 &&
            std.color.b >= 0.99 &&
            (std.metalness ?? 0) >= 0.99 &&
            (std.roughness ?? 0) >= 0.99
          );
        })();
        // Only treat the GLTF default material as glass when the mesh
        // actually lives in a glass zone — otherwise we'd convert any
        // mesh that ships without a material (e.g. a stray light cover
        // primitive) into a translucent grey panel.
        if (isGltfDefaultMat && isInGlassZone) {
          // Some Tesla models (Y Juniper) ship rear-door windows as
          // privacy glass — much darker than the front side windows.
          // The GLB only marks them by parent node name, so we look up
          // the chain and boost opacity when we land inside one of the
          // configured privacy-glass groups.
          const isPrivacyGlass = (() => {
            const patterns = cfg.privacyGlassNodes;
            if (!patterns || patterns.length === 0) return false;
            let c: THREE.Object3D | null = mesh;
            while (c) {
              if (patterns.some((p) => p.test(c!.name))) return true;
              c = c.parent;
            }
            return false;
          })();
          const debugColor = debugGlass
            ? (isPrivacyGlass ? GLASS_DEBUG_COLORS.nomatPrivacy : GLASS_DEBUG_COLORS.nomatGlass)
            : null;
          // Use the configured per-zone opacity so the Showroom
          // slider can drive the privacy-glass darkness too.
          const fallbackOpacity = isPrivacyGlass
            ? cfg.glassFinish.innerSoloOpacity
            : cfg.glassFinish.doorWindowOpacity;
          const glass = new THREE.MeshStandardMaterial({
            name: isPrivacyGlass ? '__TeslaHub_NoMat_PrivacyGlass' : '__TeslaHub_NoMat_Glass',
            color: debugColor ? debugColor.color : (isPrivacyGlass ? 0x080808 : 0x111111),
            metalness: 0,
            roughness: isPrivacyGlass ? 0.55 : 0.45,
            transparent: true,
            opacity: debugColor ? debugColor.opacity : fallbackOpacity,
            depthWrite: false,
            side: THREE.DoubleSide,
            envMapIntensity: 0.25 * cfg.glassFinish.outerEnvMultiplier,
          });
          if (Array.isArray(mesh.material)) {
            const idx = mesh.material.indexOf(mat as THREE.Material);
            if (idx >= 0) mesh.material[idx] = glass;
          } else {
            mesh.material = glass;
          }
          mesh.renderOrder = Math.max(mesh.renderOrder ?? 0, 2);
          if (glassDebug.length < 48) {
            glassDebug.push(
              `NOMAT→${isPrivacyGlass ? 'privacy' : 'glass'} ${pathOf(mesh)}`,
            );
          }
          transparentFixed++;
          continue;
        }

        // ──────────────────────────────────────────────────────────────
        // Interior placeholder overrides — Tesla ships Bayberry with a
        // few materials left as authoring placeholders (bright purple
        // `Decor`, blue `cupholder`, near-white `Interior2` / `Wing`).
        // Repaint them in place so the cabin reads as a normal Tesla
        // black interior instead of bleeding random saturated colour
        // through the window glass.
        //   - We mutate the shared material (no clone) on purpose:
        //     every mesh that referenced it should pick up the new
        //     colour automatically. Subsequent passes (body paint,
        //     glass, etc.) still see the overridden colour, which is
        //     fine because the patterns target different material
        //     names anyway.
        // ──────────────────────────────────────────────────────────────
        const interiorOverrides = cfg.interiorOverrides;
        if (interiorOverrides && interiorOverrides.length > 0) {
          for (const ov of interiorOverrides) {
            if (!ov.matchName.test(matName)) continue;
            const std = mat as THREE.MeshStandardMaterial;
            if (std.color) std.color.setHex(ov.color);
            if (ov.roughness !== undefined) std.roughness = ov.roughness;
            if (ov.metalness !== undefined) std.metalness = ov.metalness;
            break;
          }
        }

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

        // OUTER routing — covers the vast majority of glass. Inner panes
        // (`Glass_Interior*`) intentionally fall into this branch too:
        // Tesla layers door windows and panoramic roofs as outer+inner
        // pairs where the inner pane carries most of the tint (alpha
        // 0.78 black). The OUTER branch keeps that tint visible.
        //
        // EXCEPTION: a config-scoped subset of inner panes must be
        // demoted to the dimmed-inner treatment (kill mirror, opacity
        // ≈ 0.08) — namely Bayberry's `Glass_Interior_Fade` which sits
        // behind the windshield. Without this exception, OUTER+roof
        // would stack the inner at 0.90 on top of the outer at 0.55
        // and the windshield reads as an opaque grey wall.
        const isDimmedInner =
          cfg.materialPatterns.dimmedInnerGlassMaterial?.test(matName) ?? false;
        // CRITICAL firewall: a material is routed to the OUTER branch
        // ONLY when (a) its name matches the outer-glass material
        // pattern AND (b) its mesh lives inside a known glass zone.
        // Without (b), Tesla's shared `Glass`/`Glass_Lights` material
        // would route the headlight covers through the OUTER branch
        // and the glass sliders would tint the headlights red.
        const matIsOuter =
          !isDimmedInner && isInGlassZone && OUTER_GLASS_MAT.test(matName);
        if (matIsOuter) {
          const glassFin = cfg.glassFinish;

          // ──────────────────────────────────────────────────────────
          // PER-MESH CLONE — Tesla ships many glass meshes that all
          // reference the SAME `MeshStandardMaterial` instance (e.g.
          // on the Y, `Glass` is shared between Trunk_Cover_Main, the
          // windshield primitive in Static_Exterior AND a piece of
          // headlight cover). Without a per-mesh clone, dragging the
          // TRUNK opacity slider would also tint the windshield and
          // the lights because every `std.color.multiplyScalar(...)`
          // mutates the shared instance.
          //
          // Strategy mirrors the INNER branch a few lines below:
          //   1. Resolve the GLB-original material by following a
          //      back-reference on the current `mat` (which may
          //      already BE a clone left over from the previous
          //      memo pass).
          //   2. Snap baseline values on the ORIGINAL material once,
          //      so every clone reads from un-mutated values.
          //   3. Reuse the same clone across re-runs (cached in a
          //      per-mesh WeakMap keyed on the original) so we
          //      don't allocate a new material every drag tick.
          // ──────────────────────────────────────────────────────────
          type WithOriginRef = {
            __teslahub_outer_origin?: THREE.MeshStandardMaterial;
          };
          type WithBaseSnap = {
            __thOuterBase?: {
              color: number;
              env: number;
              opacity: number;
              rough: number;
            };
          };
          type WithCloneMap = {
            __teslahub_outer_clones?: WeakMap<
              THREE.MeshStandardMaterial,
              THREE.MeshStandardMaterial
            >;
          };
          const matAsAny = mat as unknown as WithOriginRef;
          const original: THREE.MeshStandardMaterial =
            matAsAny.__teslahub_outer_origin ?? (mat as THREE.MeshStandardMaterial);
          const originalAny = original as unknown as WithBaseSnap;
          if (!originalAny.__thOuterBase) {
            originalAny.__thOuterBase = {
              color: original.color?.getHex() ?? 0xffffff,
              env: original.envMapIntensity ?? 1,
              opacity: original.opacity ?? 1,
              rough: original.roughness ?? 0.5,
            };
          }
          const outerBase = originalAny.__thOuterBase;

          const meshAny = mesh as unknown as WithCloneMap;
          if (!meshAny.__teslahub_outer_clones) {
            meshAny.__teslahub_outer_clones = new WeakMap();
          }
          const cloneMap = meshAny.__teslahub_outer_clones;
          let std = cloneMap.get(original);
          if (!std) {
            std = original.clone();
            (std as unknown as WithOriginRef).__teslahub_outer_origin = original;
            cloneMap.set(original, std);
            // Substitute the clone into the mesh's material slot.
            if (Array.isArray(mesh.material)) {
              const idx = mesh.material.indexOf(mat as THREE.Material);
              if (idx >= 0) mesh.material[idx] = std;
            } else {
              mesh.material = std;
            }
          }

          // Tesla's `Glass_Windows_Fade` ships marked alphaMode=OPAQUE
          // even though it's meant to be tinted automotive glass —
          // force it into the translucent branch so the slider-driven
          // opacity takes effect.
          const isGlassFade = /^glass_windows_fade$/i.test(matName);

          // Tesla marks many alpha=1.0 materials as BLEND in source,
          // which makes GLTFLoader sort them in the transparent pass
          // and flicker between coplanar surfaces. Demote those to
          // truly opaque so they pass through depth-tested opaque.
          // The decision uses the SNAPPED baseOpacity so it's stable
          // across re-runs.
          const isEffectivelyOpaque = !isGlassFade && outerBase.opacity >= 0.95;

          const zoneOpacity =
            isRoof
              ? glassFin.panoroofOpacity
              : isTrunk
                ? glassFin.trunkGlassOpacity
                : glassFin.doorWindowOpacity;
          const zoneTint =
            isRoof
              ? glassFin.panoroofTint
              : isTrunk
                ? glassFin.trunkGlassTint
                : glassFin.doorWindowTint;

          if (isEffectivelyOpaque) {
            std.transparent = false;
            std.depthWrite = true;
            std.side = THREE.DoubleSide;
            std.opacity = 1;
          } else {
            std.transparent = true;
            std.depthWrite = false;
            std.side = THREE.DoubleSide;
            mesh.renderOrder = isRoof ? 3 : isTrunk ? 2 : 2;
            // ALWAYS apply the zone opacity in the translucent branch.
            // The previous `if (opacity < 0.4)` gate meant materials
            // shipping at 0.45–0.5 (Y Glass_Windows, M3 Glass_Tinted)
            // would never be touched by the slider — that's why OPAC
            // was inert on both models.
            std.opacity = zoneOpacity;
          }

          // ENV REFLECTION — Tesla ships many glass materials very
          // rough (Y Glass_Windows = 0.83) which blurs the HDR sky
          // into a flat grey, so envMapIntensity has no visible
          // effect. Couple the env multiplier to a roughness cap so
          // dialling the slider up actually sharpens the reflection.
          //
          //   envMul = 0     → reflection killed
          //   envMul = 1     → GLB-baked roughness preserved
          //   envMul > 1     → roughness pulled toward 0.05 (mirror)
          if ('envMapIntensity' in std) {
            std.envMapIntensity = glassFin.outerEnvMultiplier;
          }
          if ('roughness' in std) {
            const envMul = glassFin.outerEnvMultiplier;
            if (envMul <= 1) {
              // Sub-1 mul keeps the baked roughness (no over-correction).
              std.roughness = outerBase.rough;
            } else {
              // Above 1, pull roughness from baked value down to 0.05
              // proportionally — at envMul = 2 we're a clear mirror.
              const t = Math.min(1, (envMul - 1));
              std.roughness = outerBase.rough * (1 - t) + 0.05 * t;
            }
          }

          if (std.color) {
            std.color.setHex(outerBase.color);
            const c = std.color;
            if (c.r < 0.05 && c.g < 0.05 && c.b < 0.05) {
              // GLB ships near-black — re-tint to a configurable shade
              // so we don't render an opaque void.
              const v = zoneTint * 0.5;
              c.setRGB(v, v, v);
            } else {
              c.multiplyScalar(zoneTint);
            }
          }
          // Debug colorisation — runs LAST so it takes priority.
          // Doesn't touch the snapshot, so toggling debug off in the
          // next memo pass restores the calibrated look unchanged.
          if (debugGlass && std.color) {
            std.color.setHex(GLASS_DEBUG_COLORS.outer.color);
            std.opacity = GLASS_DEBUG_COLORS.outer.opacity;
            std.transparent = true;
            std.depthWrite = false;
          }

          if (isRoof) roofFixed++;
          else windowFixed++;
          if (glassDebug.length < 48) {
            const zoneTag = isRoof ? 'PANO' : isTrunk ? 'TRUNK' : 'DOOR';
            glassDebug.push(
              `${zoneTag} ${mesh.name || '(unnamed)'} mat="${matName}" ` +
                `opacity=${outerBase.opacity.toFixed(2)}→${isEffectivelyOpaque ? 'OPAQUE' : (std.opacity ?? 1).toFixed(2)}`,
            );
          }
        } else if (INNER_GLASS_MAT.test(matName)) {
          // Tesla's `Glass_Interior` (rough=0.01, alpha=0.78, black) is
          // a SHARED material reused across meshes with very different
          // physical meaning. We must treat it per-mesh, which means
          // we clone it here so mutations don't bleed across meshes.
          // Recover the GLB-original material reference. First time we
          // see this mesh we snapshot it on the mesh itself; subsequent
          // passes (Showroom slider drags re-running the memo) re-read
          // from that snapshot. Without it we'd clone the previously
          // mutated clone every tick → envMapIntensity drives toward 0,
          // opacity drives toward inner mixed (0.08) even for solo
          // panes, the whole thing degrades after a few drags.
          type WithGlassOrig = { __teslahub_glass_original?: THREE.Material };
          const meshAny = mesh as unknown as WithGlassOrig;
          let original: THREE.MeshStandardMaterial;
          if (meshAny.__teslahub_glass_original) {
            original = meshAny.__teslahub_glass_original as THREE.MeshStandardMaterial;
          } else {
            original = mat as THREE.MeshStandardMaterial;
            meshAny.__teslahub_glass_original = original;
          }
          const cloned = original.clone();
          const role = meshGlassRole.get(mesh) ?? 'none';

          const glassFin = cfg.glassFinish;
          if (role === 'mixed') {
            // Inner cabin-side pane behind an outer Glass/Glass_Windows
            // pane (windshield, front door windows). The rough=0.01
            // mirror reflects the HDR sky through the semi-transparent
            // outer pane → bright white windshield. The composite is
            // also too opaque (outer 55% + inner 78% = 90% blocking)
            // so we see no cabin even after killing the reflection.
            //
            // Solution: collapse the inner pane to a faint tint veil.
            // The outer Glass already carries the tint colour and the
            // see-through quality (matches the trunk hatch which uses
            // only the outer pane and reads correctly). Driving the
            // inner opacity near zero makes the windshield render like
            // the trunk: outer-glass-only, 55% opaque, 45% see-through.
            cloned.roughness = Math.max(cloned.roughness ?? 0.5, 0.7);
            if ('envMapIntensity' in cloned) {
              cloned.envMapIntensity = (cloned.envMapIntensity ?? 1) * glassFin.innerMixedEnvMultiplier;
            }
            cloned.opacity = glassFin.innerMixedOpacity;
            mesh.renderOrder = 1;
          } else {
            // SOLO pane: Tesla modeled the rear door windows with only
            // `Glass_Interior` (no outer Glass_Windows layer). Killing
            // the reflection here turns them into flat black panels —
            // the mirror IS what reads as "tinted glass". Keep a
            // softened reflection and force the configured opacity so
            // the user can dial the privacy-glass darkness.
            cloned.roughness = Math.max(cloned.roughness ?? 0.5, 0.25);
            if ('envMapIntensity' in cloned) {
              cloned.envMapIntensity = (cloned.envMapIntensity ?? 1) * glassFin.innerSoloEnvMultiplier;
            }
            cloned.opacity = glassFin.innerSoloOpacity;
            mesh.renderOrder = 2;
          }

          cloned.transparent = true;
          cloned.depthWrite = false;
          cloned.side = THREE.DoubleSide;

          // Debug colorisation — same priority as outer.
          if (debugGlass && cloned.color) {
            const dbg = role === 'mixed' ? GLASS_DEBUG_COLORS.innerMixed : GLASS_DEBUG_COLORS.innerSolo;
            cloned.color.setHex(dbg.color);
            cloned.opacity = dbg.opacity;
          }

          if (Array.isArray(mesh.material)) {
            const idx = mesh.material.indexOf(original);
            if (idx >= 0) mesh.material[idx] = cloned;
          } else {
            mesh.material = cloned;
          }

          if (glassDebug.length < 24) {
            glassDebug.push(
              `INNER(${role}) ${mesh.name || '(unnamed)'} mat="${matName}" ` +
                `rough→${cloned.roughness?.toFixed(2)} opacity→${cloned.opacity?.toFixed(2)}`,
            );
          }
          transparentFixed++;
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
    if (floorFixed > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Poppyseed3D] floor shadow meshes fixed: ${floorFixed}`);
    }

    let wheelsAttached = 0;
    let wheelMode: 'anchor' | 'fallback' | 'none' = 'none';
    if (wheelsAvailable) {
      const anchorsFound = WHEEL_ANCHORS.filter((a) => anchors[a.name]).length;
      wheelMode = anchorsFound === 4 ? 'anchor' : 'fallback';

      if (wheelMode === 'anchor') {
        // Anchor mode is idempotent because Three appends the wheel
        // clone to a node that already exists in the GLB hierarchy —
        // re-running would attach a SECOND clone on top of the first,
        // hence the one-shot flag. Anchors don't move at runtime so
        // there's nothing to re-update.
        const ANCHOR_DONE = '__teslahub_wheels_anchored';
        if (!(scene as unknown as Record<string, boolean>)[ANCHOR_DONE]) {
          for (const { name, mirror } of WHEEL_ANCHORS) {
            const anchor = anchors[name];
            const wheelClone = SkeletonUtils.clone(wheelGltf.scene);
            if (mirror) wheelClone.rotation.y = Math.PI;
            anchor.add(wheelClone);
            wheelsAttached++;
          }
          (scene as unknown as Record<string, boolean>)[ANCHOR_DONE] = true;
        } else {
          wheelsAttached = 4;
        }
      } else {
        // Fallback mode: keep a Map<cornerId, wrapper> on the scene so
        // re-runs of this memo (triggered by Showroom slider drags that
        // mutate `cfg.wheelFallbackPositions`) UPDATE the existing
        // wrappers' position instead of stacking new ones on top. The
        // wheel mesh itself is heavy to clone (skinned, possibly with
        // alloy texture maps) so we keep the same clone forever.
        type WheelStash = Map<string, THREE.Group>;
        const STASH_KEY = '__teslahub_wheel_wrappers';
        const sceneAny = scene as unknown as Record<string, unknown>;
        let stash = sceneAny[STASH_KEY] as WheelStash | undefined;
        if (!stash) {
          stash = new Map();
          sceneAny[STASH_KEY] = stash;
        }

        for (const pos of WHEEL_FALLBACK_POSITIONS) {
          let wrapper = stash.get(pos.id);
          if (!wrapper) {
            // First time we see this corner — clone + re-center on bbox.
            const wheelClone = SkeletonUtils.clone(wheelGltf.scene);
            wheelClone.updateMatrixWorld(true);
            const wheelBox = new THREE.Box3().setFromObject(wheelClone);
            const wheelCenter = wheelBox.getCenter(new THREE.Vector3());
            const wheelSize = wheelBox.getSize(new THREE.Vector3());
            wheelClone.position.sub(wheelCenter);
            wrapper = new THREE.Group();
            wrapper.name = `WheelWrapper_${pos.id}`;
            wrapper.add(wheelClone);
            scene.add(wrapper);
            stash.set(pos.id, wrapper);
            if (stash.size === 1) {
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
          // Always (re-)apply position + rotation + flipZ. This is what
          // makes Showroom sliders actually move/orient the wheel in
          // realtime — drag a slider → cfg rebuilt → memo re-runs →
          // wrapper transform updated in place.
          wrapper.position.set(pos.x, pos.y, pos.z);
          wrapper.rotation.set(0, THREE.MathUtils.degToRad(pos.rotY ?? 0), 0);
          wrapper.scale.set(1, 1, pos.flipZ ? -1 : 1);
          wheelsAttached++;
        }
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
        `paintFixed=${paintFixed} | floorFixed=${floorFixed} | ` +
        `bbox=${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} ` +
        `center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`,
    );
    return scene;
    // cfg drives bodyPaintColor + materialPatterns (paint/glass regex)
    // and is the source of every destructured constant above. When the
    // VIN changes the new GLB has a different `scene` reference too,
    // but cfg is added explicitly to make the multi-model coupling
    // visible to readers.
  }, [scene, wheelGltf.scene, wheelsAvailable, cfg, debugGlass]);

  // Click handler intentionally OMITTED. The 3D viewer is read-only on Home:
  // - State reflects live MQTT/TeslaMate signals via <useVehicleVisualSync>
  // - Action affordances are surfaced as floating callouts (<VehicleCallouts>)
  //   that route through the real Tesla command pipeline (useControlMutation)
  // - The previous "click a door to open it locally" UX caused too many
  //   accidental clicks (user dragging the orbit camera) and could not safely
  //   coexist with the 3-state Tesla charge_port_door endpoint that doubles
  //   as cable unlock when plugged in. See `VehicleCallouts` for the rebuilt
  //   Tesla Car Browser-style UI.

  // ── Custom body wrap (PNG overlay) ────────────────────────────────
  // Applies the active wrap URL (from WrapUrlContext) as the
  // baseColorTexture of the `Paint` material — and ONLY `Paint`, not
  // `PaintRough` (the latter covers low-sheen plastic-y body parts
  // that look terrible wrapped; matches Tesla's own configurator).
  //
  // Restoration is deliberate: when the URL clears we re-color the
  // material with `cfg.bodyPaintColor` so the GLB returns to its
  // solid-paint look. Reusing `mat.color.setHex` rather than
  // snapshotting the original `mat.color` keeps a single source of
  // truth (cfg.bodyPaintColor) — the Showroom paint picker already
  // writes there, so the swap is symmetric.
  const wrapUrl = useContext(WrapUrlContext);
  useEffect(() => {
    const targets: THREE.MeshStandardMaterial[] = [];
    cleanedScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        const matName = (std as { name?: string }).name ?? '';
        // STRICT: exact match on `Paint` only. `PaintRough`, `Paint_Inner`
        // and similar variants are skipped on purpose.
        if (matName === 'Paint') targets.push(std);
      }
    });

    if (targets.length === 0) return;

    if (!wrapUrl) {
      // No wrap → clear any previously-applied map and restore solid colour.
      for (const mat of targets) {
        if (mat.map) {
          mat.map.dispose();
          mat.map = null;
        }
        mat.color.setHex(cfg.bodyPaintColor);
        mat.needsUpdate = true;
      }
      return;
    }

    // Load the PNG through an Image + Canvas so we can FLATTEN any
    // transparent regions onto a white background BEFORE handing the
    // bytes to three.js. This matters because Tesla's official wrap
    // PNGs are RGBA with `alpha = 0` on every non-livery pixel — when
    // sampled by a `MeshStandardMaterial` whose `alphaMode = OPAQUE`,
    // the alpha channel is ignored and the underlying RGB on those
    // pixels is (0, 0, 0). The car would then render almost
    // completely BLACK with only the livery islands showing colour.
    // Pre-multiplying onto white sidesteps the issue entirely and
    // makes the body read as solid white where the wrap is empty,
    // matching Tesla's in-car configurator behaviour.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let cancelled = false;
    let loadedTex: THREE.Texture | null = null;
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // eslint-disable-next-line no-console
        console.warn('[Wrap] 2D context unavailable, aborting wrap');
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);

      const tex = new THREE.CanvasTexture(canvas);
      // PNG image convention is origin = top-left; three.js wants
      // bottom-left for shaders → flipY = true (the default for
      // CanvasTexture, set explicitly here for documentation).
      tex.flipY = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      loadedTex = tex;

      for (const mat of targets) {
        if (mat.map && mat.map !== tex) mat.map.dispose();
        mat.map = tex;
        // Neutral white tint so the PNG colours render unmodified.
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }
    };
    img.onerror = (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[Wrap] failed to load ${wrapUrl}:`, err);
    };
    img.src = wrapUrl;

    return () => {
      cancelled = true;
      if (loadedTex) {
        for (const mat of targets) {
          if (mat.map === loadedTex) {
            mat.map = null;
            mat.color.setHex(cfg.bodyPaintColor);
            mat.needsUpdate = true;
          }
        }
        loadedTex.dispose();
      }
    };
  }, [cleanedScene, wrapUrl, cfg.bodyPaintColor]);

  return (
    <>
      <primitive object={cleanedScene} />
      <VehicleOpeningsAnimator scene={cleanedScene} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Live charging cable - driven by the live VehicleStatus (chargingState +
// pluggedIn) via useVehicleVisualSync. The legacy showroom-style cycle
// button now lives in ShowroomControls.tsx for the upcoming Settings tab.
// ---------------------------------------------------------------------------

interface LiveChargingCableProps {
  mode: CableMode;
  handleAvailable: boolean;
}

/**
 * Reads the Charge_Cap_Spatial world position from the loaded Poppyseed scene
 * and renders the <ChargingCable /> connected to it. Falls back to a hardcoded
 * Model 3 Highland position if the anchor is not found (e.g. older Tesla
 * scene names). Re-resolves whenever the openings change so the cable end
 * tracks the charge port trapdoor when it opens.
 */
function LiveChargingCable({ mode, handleAvailable }: LiveChargingCableProps) {
  const { scene } = useThree();
  const { targets } = useOpeningsContext();
  const chargePortOpenness = targets.charge_port ?? 0;
  const {
    CHARGE_PORT_NODE,
    CHARGE_PORT_ALT_NAMES,
    CHARGE_PORT_FALLBACK_WORLD,
    PORT_FROM_PIVOT_OFFSET,
    PLUG_DIRECTION,
    CABLE_GROUND_WORLD,
  } = useModelConsts();

  const endWorld = useMemo(() => {
    // Try the main name then several known alternates in order.
    // Different Godot exports keep different parent pivots intact.
    // See vehicleModelConfig.ts for the per-model overrides.
    const candidates = [CHARGE_PORT_NODE, ...CHARGE_PORT_ALT_NAMES];
    let anchor: THREE.Object3D | undefined;
    let usedName = '';
    for (const name of candidates) {
      const obj = scene.getObjectByName(name);
      if (obj) {
        anchor = obj;
        usedName = name;
        break;
      }
    }
    if (!anchor) {
      // eslint-disable-next-line no-console
      console.warn(
        `[Vehicle3D] charge port anchor not found (tried: ${candidates.join(', ')}) - ` +
          'falling back to per-model world position.',
      );
      return CHARGE_PORT_FALLBACK_WORLD.clone();
    }
    // CRITICAL: matrixWorld is stale until the first render. Force-update
    // up the parent chain BEFORE reading getWorldPosition, otherwise we
    // get the local origin (0,0,0) of an un-rendered scene.
    anchor.updateWorldMatrix(true, false);
    const pivotWorld = new THREE.Vector3();
    anchor.getWorldPosition(pivotWorld);
    // Offset from the hinge pivot to the actual plug socket.
    const w = pivotWorld.clone().add(PORT_FROM_PIVOT_OFFSET);
    // eslint-disable-next-line no-console
    console.log(
      `[Vehicle3D] charge port anchor: "${usedName}" pivot=(${pivotWorld.x.toFixed(3)}, ${pivotWorld.y.toFixed(3)}, ${pivotWorld.z.toFixed(3)}) ` +
        `plug=(${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)})`,
    );
    return w;
    // chargePortOpenness intentionally re-runs the effect when the trapdoor
    // animates open/closed - the anchor world position changes with it.
    // CHARGE_PORT_*/PORT_FROM_PIVOT_OFFSET only change on VIN swap.
  }, [
    scene,
    chargePortOpenness,
    CHARGE_PORT_NODE,
    CHARGE_PORT_ALT_NAMES,
    CHARGE_PORT_FALLBACK_WORLD,
    PORT_FROM_PIVOT_OFFSET,
  ]);

  if (mode === 'off') return null;

  // Enable visual debug helpers by appending ?debug=cable to the URL.
  // Renders two small markers: green=ground start, red=charge port end.
  const debugCable =
    typeof window !== 'undefined' && window.location.search.includes('debug=cable');

  return (
    <>
      <ChargingCable
        startWorld={CABLE_GROUND_WORLD}
        endWorld={endWorld}
        plugDirection={PLUG_DIRECTION}
        charging={mode === 'charging'}
        handleUrl={handleAvailable ? HANDLE_URL : undefined}
      />
      {debugCable && (
        <>
          <mesh position={CABLE_GROUND_WORLD}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshBasicMaterial color="#22c55e" />
          </mesh>
          <mesh position={endWorld}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <axesHelper args={[2]} />
        </>
      )}
    </>
  );
}

function Loader() {
  return (
    <Html center>
      <div className="text-[#9ca3af] text-xs">Loading 3D model...</div>
    </Html>
  );
}

// Probes a 3D asset URL once when it changes. Returns:
//   - `null` while the probe is in flight (or the URL has just changed
//     and we haven't probed the new one yet — the "stale-protect").
//   - `true` once the asset is confirmed available.
//   - `false` once the asset is confirmed missing/text.
//
// The stale-protect is critical for the wheel picker in Showroom:
// without it, when the user swaps wheel GLB, this hook would return
// the PREVIOUS URL's `true` for ~1 render while the new probe runs.
// During that render, the upstream `<PoppyseedModel wheelsAvailable={true}>`
// would call `useGLTF(NEW_URL)` and Three.js would throw if NEW_URL
// returns 404, crashing the whole viewer instead of just hiding the
// wheels. We tie the state to the probed URL so a URL mismatch always
// reads as null and the consumer unmounts safely until we know.
/**
 * Yellow banner that overlays the top of the viewer when the active
 * model's GLB couldn't be loaded. Three cases handled:
 *   1. VIN reads Model Y (char#4 === 'Y') but `bayberry_e41.glb`
 *      404s → "Y détecté, GLB manquant" + tells the user where to
 *      drop the file.
 *   2. No VIN at all → "Aucun véhicule détecté"; we still render the
 *      default M3 scene so the Showroom is usable for visual setup.
 *   3. Generic "GLB indisponible" for any other model resolution
 *      failure (rare — usually a typo in `cfg.modelUrl`).
 *
 * The banner sits ABOVE the Canvas (absolutely positioned at the
 * top-left), so it doesn't interfere with OrbitControls drag or the
 * floating callouts. It auto-hides when the probe succeeds.
 */
function ModelAvailabilityBanner({ vin }: { vin: string | null | undefined }) {
  const cfg = useActiveModel();
  const available = useAssetAvailable(cfg.modelUrl);

  // Still probing or available — nothing to show.
  if (available === null || available === true) return null;

  const fileName = cfg.modelUrl.split('/').pop() ?? cfg.modelUrl;
  const code = vin?.toUpperCase().charAt(3);
  const isY = code === 'Y';

  let message: string;
  if (!vin) {
    message =
      `Aucun véhicule détecté — rendu avec le modèle par défaut (${fileName} indisponible).`;
  } else if (isY) {
    message =
      `Model Y détecté (VIN …${vin.slice(-4)}) — le fichier ${fileName} ` +
      `est introuvable. Dépose-le dans /public/models/ pour activer le rendu Y.`;
  } else {
    message =
      `Modèle introuvable : ${fileName}. Vérifie qu'il est bien présent dans /public/models/.`;
  }

  return (
    <div className="absolute top-2 left-2 right-2 z-10 px-3 py-2 bg-yellow-500/10 border border-yellow-500/40 rounded-md text-yellow-200 text-[11px] leading-snug">
      <span className="font-semibold text-yellow-100">3D · </span>
      {message}
    </div>
  );
}

function useAssetAvailable(url: string): boolean | null {
  const [state, setState] = useState<{ url: string; available: boolean } | null>(null);
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
        setState({ url, available: ok });
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn(`[Poppyseed3D] probe ${url} failed:`, err);
        setState({ url, available: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state && state.url === url ? state.available : null;
}

interface Props {
  vehicle: VehicleStatus;
  /** In-flight Showroom edits, only set by the Settings → Showroom
   *  page. When defined, takes precedence over the backend-stored
   *  override blob so the user sees live preview as they drag
   *  sliders / gizmos. Other consumers (Home, etc.) leave this
   *  undefined and get the saved overrides. */
  localOverrides?: ShowroomOverrides;
  /** Render the viewer in CONFIGURATOR mode — no API commands fire on
   *  any click, callouts are visual-only. Used by the Settings →
   *  Showroom page so the user can play with the model without
   *  accidentally opening their actual trunk or unlocking the car.
   *  When omitted (Home, cards…) the viewer runs in LIVE mode and
   *  callouts hit the Tesla Fleet API as before. */
  showroomMode?: boolean;
  /** Showroom-only ephemeral debug toggles (glass coloration, etc.).
   *  Not persisted in the override blob — passed straight through the
   *  Provider to the scene-processing code. */
  debugMode?: ShowroomDebugFlags;
}

/**
 * Builds an optimistic patch for the TeslaMate-fed `['vehicle', carId]`
 * cache. Same pattern as HomeQuickActions — Tesla command endpoints
 * never echo post-command state and TeslaMate MQTT lags 30-60s, so we
 * patch the local cache immediately. Patches roll back on error.
 */
function vehiclePatch<TBody = void>(
  carId: number | undefined,
  update: (prev: VehicleStatus, body: TBody) => Partial<VehicleStatus>,
): OptimisticPatch<TBody, VehicleStatus> | undefined {
  if (!carId) return undefined;
  return {
    queryKey: ['vehicle', carId],
    update: (prev, body) => (prev ? { ...prev, ...update(prev, body) } : prev),
  };
}

export default function VehicleTopView3D({ vehicle, localOverrides, showroomMode, debugMode }: Props) {
  // Resolve the per-model config from the live carId + VIN. This is the
  // SINGLE place where the picker fires — every descendant reads the
  // result via `useActiveModel()` (or `useModelConsts()`) through the
  // Provider below, so swapping between his Model 3 and her Model Y is
  // just a re-render. The hook also merges per-car overrides stored
  // server-side (Settings → Showroom), so the same model can be
  // hand-calibrated per car and the calibration follows it everywhere.
  const {
    config: modelConfig,
    extras,
    wrapExists,
    updatedAt,
  } = useResolvedModelConfig(vehicle.carId, vehicle.vin, localOverrides);

  // Resolve the wrap PNG URL once at this layer so every descendant
  // (PoppyseedModel inside the Canvas, future inspector panels, etc.)
  // reads the same source via WrapUrlContext. Priority:
  //   1. `wraps.paintTextureUrl` override (Tesla template preset or
  //      remote test PNG) — wins for previews.
  //   2. Server-uploaded wrap if `wrapExists` is true — keyed by the
  //      config `updatedAt` so a freshly-uploaded PNG busts the
  //      browser cache automatically.
  //   3. null — render solid paint via `cfg.bodyPaintColor`.
  const wrapOverride = extras.wraps?.paintTextureUrl;
  const wrapUrl = useMemo<string | null>(() => {
    if (wrapOverride) return wrapOverride;
    if (wrapExists && vehicle.carId) {
      return wrapPngUrl(vehicle.carId, updatedAt ?? undefined);
    }
    return null;
  }, [wrapOverride, wrapExists, vehicle.carId, updatedAt]);

  return (
    <VehicleModelContext.Provider value={modelConfig}>
      <WrapUrlContext.Provider value={wrapUrl}>
        <ShowroomDebugContext.Provider value={debugMode ?? DEFAULT_DEBUG_FLAGS}>
          <VehicleTopView3DInner vehicle={vehicle} showroomMode={!!showroomMode} />
        </ShowroomDebugContext.Provider>
      </WrapUrlContext.Provider>
    </VehicleModelContext.Provider>
  );
}

function VehicleTopView3DInner({ vehicle, showroomMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const cfg = useActiveModel();
  const wheelsAvailable = useAssetAvailable(cfg.wheelUrl);
  const handleAvailable = useAssetAvailable(HANDLE_URL);
  // Auto-rotate OFF by default — was distracting and made clicking on
  // a moving target frustrating. Toggle in top-right corner.
  const [autoRotate, setAutoRotate] = useState(false);
  // Cable mode is now driven by the live VehicleStatus through
  // <useVehicleVisualSync>. We keep it in local state so the cable
  // mount/unmount is a fast local re-render rather than re-deriving in
  // every effect downstream.
  const [cableMode, setCableMode] = useState<CableMode>('off');

  // --- Fleet API wiring for callouts ---------------------------------------
  // Same gating logic as HomeQuickActions: callouts surface action buttons
  // only when MQTT + Fleet API + virtual key are ALL ready. Without that,
  // the 3D viewer is purely observational (no callouts, animations only).
  const { data: availability } = useControlAvailability();
  const teslaVehicle = useMemo(() => {
    if (!availability?.vehicles?.length || !vehicle.vin) return undefined;
    const matches = availability.vehicles.filter((v) => v.vin === vehicle.vin);
    return matches.find((v) => v.keyPaired) ?? matches[0];
  }, [availability, vehicle.vin]);
  const vehicleId = teslaVehicle?.id;
  const carId = vehicle.carId;

  // All mutations instantiated unconditionally to satisfy rules-of-hooks.
  // When vehicleId is undefined they are noop-disabled (mutation throws,
  // caught by useControlMutation, never shows a toast in `silent` mode).
  const trunk = useControlMutation<{ which: string }>(vehicleId, 'access/trunk', {
    optimistic: vehiclePatch<{ which: string }>(carId, (prev, body) =>
      body.which === 'front'
        ? { frunkOpen: !(prev.frunkOpen ?? false) }
        : { trunkOpen: !(prev.trunkOpen ?? false) },
    ),
  });
  const windowCmd = useControlMutation<{ command: string }>(vehicleId, 'access/window', {
    optimistic: vehiclePatch<{ command: string }>(carId, (_prev, body) =>
      body.command === 'close' ? { windowsOpen: false } : { windowsOpen: true },
    ),
  });
  // charge/port-door is THE TRICKY ONE — same endpoint does three things:
  //   - on:true  + port closed + not plugged → opens trapdoor
  //   - on:false + port open   + not plugged → closes trapdoor
  //   - on:true  + plugged                   → releases cable latch
  // The callouts split this into two intents (closeChargePort / unlockCable)
  // and pass the right `on` value depending on the source button.
  const chargePort = useControlMutation<{ on: boolean }>(vehicleId, 'charge/port-door', {
    optimistic: vehiclePatch<{ on: boolean }>(carId, (_prev, body) => ({
      chargePortDoorOpen: body.on,
    })),
  });

  // Callouts gated on the same trinity HomeQuickActions uses. When any
  // condition is missing we pass null → callouts render nothing at all.
  // We deliberately MIRROR HomeQuickActions' gating exactly so the two
  // surfaces (top quick actions row + 3D callouts) appear or disappear
  // together — if the user can tap a button in Quick Actions, the same
  // button must be reachable from the 3D, and vice versa.
  const fleetReady = !!availability?.configured && !!availability?.connected;
  const paired = !!teslaVehicle?.keyPaired;
  const mqttAvailable = !!vehicle.mqttConnected;
  const caps = teslaVehicle?.capabilities;

  // One-shot debug log on each gating change, so we can diagnose why
  // callouts don't appear (missing Fleet API config, virtual key not
  // paired, MQTT disconnected, VIN mismatch between TeslaMate and Fleet).
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[VehicleTopView3D] callouts gating:', {
      vin: vehicle.vin,
      vehicleId,
      fleetReady,
      paired,
      mqttAvailable,
      availabilityConfigured: availability?.configured,
      availabilityConnected: availability?.connected,
      mqttConnected: vehicle.mqttConnected,
      teslaVehicleFound: !!teslaVehicle,
      callouts: vehicleId && fleetReady && paired && mqttAvailable ? 'ACTIVE' : 'DISABLED',
    });
  }, [
    vehicle.vin,
    vehicleId,
    fleetReady,
    paired,
    mqttAvailable,
    availability?.configured,
    availability?.connected,
    vehicle.mqttConnected,
    teslaVehicle,
  ]);
  const showChargePortCallout = presumeSupported(caps, caps?.motorizedChargePort ?? false);
  const showTrunkCallouts =
    !caps?.carType || caps.canActuateTrunks; // permissive when capabilities not loaded yet

  // `access/trunk` toggles whichever lid you ask for. We split into
  // 4 logical actions (open/close × frunk/trunk) but they all map to
  // the same endpoint with `which: front|rear`. The optimistic patch
  // already flips the boolean so the 3D anim runs the right direction
  // regardless of which logical action triggered it.
  const trunkFrontPending =
    trunk.isPending &&
    (trunk.variables as { which?: string } | undefined)?.which === 'front';
  const trunkRearPending =
    trunk.isPending &&
    (trunk.variables as { which?: string } | undefined)?.which === 'rear';
  const portClosing =
    chargePort.isPending &&
    (chargePort.variables as { on?: boolean } | undefined)?.on === false;
  const portOpening =
    chargePort.isPending &&
    (chargePort.variables as { on?: boolean } | undefined)?.on === true;
  const windowVenting =
    windowCmd.isPending &&
    (windowCmd.variables as { command?: string } | undefined)?.command === 'vent';
  const windowClosing =
    windowCmd.isPending &&
    (windowCmd.variables as { command?: string } | undefined)?.command === 'close';

  const actions: CalloutsActions | null = useMemo(() => {
    // SAFETY: in Showroom (configurator) mode we MUST NOT expose any
    // handler that could fire a Tesla command. Returning null hides
    // the callouts entirely so a click can't even reach the mutation
    // functions. The Showroom page provides its own visual-only
    // action buttons in the right-hand panel.
    if (showroomMode) return null;
    if (!vehicleId || !fleetReady || !paired || !mqttAvailable) return null;
    return {
      openFrunk: {
        onClick: () => trunk.mutate({ which: 'front' }),
        loading: trunkFrontPending,
      },
      openTrunk: {
        onClick: () => trunk.mutate({ which: 'rear' }),
        loading: trunkRearPending,
      },
      closeTrunk: {
        onClick: () => trunk.mutate({ which: 'rear' }),
        loading: trunkRearPending,
      },
      openChargePort: {
        onClick: () => chargePort.mutate({ on: true }),
        loading: portOpening,
      },
      closeChargePort: {
        onClick: () => chargePort.mutate({ on: false }),
        loading: portClosing,
      },
      unlockCable: {
        // Same endpoint as openChargePort but semantically different —
        // when plugged in, `on:true` releases the cable latch instead
        // of toggling the trapdoor.
        onClick: () => chargePort.mutate({ on: true }),
        loading: portOpening,
      },
      ventWindows: {
        onClick: () => windowCmd.mutate({ command: 'vent' }),
        loading: windowVenting,
      },
      closeWindows: {
        onClick: () => windowCmd.mutate({ command: 'close' }),
        loading: windowClosing,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showroomMode,
    vehicleId,
    fleetReady,
    paired,
    mqttAvailable,
    trunkFrontPending,
    trunkRearPending,
    portClosing,
    portOpening,
    windowVenting,
    windowClosing,
  ]);

  // Strip individual actions when capabilities tell us they don't apply.
  const filteredActions = useMemo(() => {
    if (!actions) return null;
    const out = { ...actions };
    const noop: CalloutAction = { onClick: () => {}, loading: false };
    if (!showChargePortCallout) {
      out.openChargePort = noop;
      out.closeChargePort = noop;
      out.unlockCable = noop;
    }
    if (!showTrunkCallouts) {
      out.openFrunk = noop;
      out.openTrunk = noop;
      out.closeTrunk = noop;
    }
    return out;
  }, [actions, showChargePortCallout, showTrunkCallouts]);

  return (
    <OpeningsProvider>
      <div className="relative w-full" style={{ height: 360 }}>
        <ModelAvailabilityBanner vin={vehicle.vin} />
        <Canvas
          ref={canvasRef}
          camera={{ position: cfg.cameraPose.position, fov: cfg.cameraPose.fov }}
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
            {/* IMPORTANT — keyed by the model key so a runtime swap
                (Showroom: Model 3 → Model Y, or Home: switching cars
                between a 3 and a Y) FORCES every model-bound component
                to remount. Without this, the per-instance caches that
                live in useRef (VehicleOpeningsAnimator.restCache,
                VehicleLightEffects emissive snapshots, callout anchor
                lookups…) keep stale references to nodes from the
                previous scene graph and the new model just sits
                inanimate until the page is refreshed.
                The Canvas itself stays mounted so the WebGL context
                and OrbitControls (camera pose) survive — only the
                scene-bound subtree resets. */}
            <group key={cfg.key}>
              {/* Wait until the wheel probe completes before mounting the
                  chassis. Otherwise the chassis loads twice via Suspense when
                  the wheel state flips from unknown → available. */}
              {wheelsAvailable !== null && (
                <PoppyseedModel wheelsAvailable={wheelsAvailable} />
              )}
              {/* Cable mounts only when the live state says we're plugged or
                  charging. Animated colour switches between grey-pulse and
                  green-flow inside <ChargingCable>. */}
              {cableMode !== 'off' && handleAvailable !== null && (
                <LiveChargingCable mode={cableMode} handleAvailable={handleAvailable} />
              )}
              {/* Callouts mounted inside Canvas so they can read the scene
                  graph (anchor positions) via useThree.scene. They render
                  nothing when actions=null (Fleet API not ready). */}
              <VehicleCallouts vehicle={vehicle} actions={filteredActions} />
              {/* Phase 7 light effects: lock flash, brake/reverse lights,
                  sentry-mode camera pulses. Reads vehicle.* live state
                  and mutates scene nodes directly (no React props/state
                  churn). */}
              <VehicleLightEffects vehicle={vehicle} />
            </group>
          </Suspense>

          {/* Read MQTT/TeslaMate state → drive openings + cableMode. */}
          <VehicleStateSync vehicle={vehicle} onCableModeChange={setCableMode} />

          {/* Push camera/target/FOV from cfg into the live WebGL camera
              so Showroom sliders actually move the framing in realtime.
              Idempotent in normal viewer (cfg is stable). */}
          <CameraPoseSync />

          <OrbitControls
            target={cfg.cameraPose.target}
            enablePan={false}
            enableZoom
            minDistance={4}
            maxDistance={20}
            autoRotate={autoRotate}
            autoRotateSpeed={0.6}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2.1}
            makeDefault
          />
        </Canvas>

        {/* Top-right overlay: status badges + auto-rotate toggle. */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {vehicle.sentryMode && <SentryBadge />}
          {vehicle.isLocked != null && <LockBadge locked={vehicle.isLocked} />}
          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            title={autoRotate ? 'Stopper la rotation' : 'Lancer la rotation'}
            className={
              'w-8 h-8 rounded-full text-sm flex items-center justify-center ' +
              'border border-white/15 backdrop-blur-md transition-colors ' +
              (autoRotate
                ? 'bg-blue-500/80 text-white'
                : 'bg-black/50 text-white/70 hover:text-white hover:bg-black/70')
            }
          >
            ↻
          </button>
        </div>
      </div>
    </OpeningsProvider>
  );
}

// Small DOM badges that mirror the live vehicle state. Kept out of the
// Canvas so they render at full resolution (no distanceFactor scaling)
// and aren't subject to the 3D depth buffer.

function SentryBadge() {
  return (
    <div
      title="Mode Sentinelle actif"
      className={
        'h-8 px-2.5 flex items-center gap-1.5 rounded-full backdrop-blur-md ' +
        'bg-red-500/80 border border-red-300/40 text-white text-[10px] font-semibold ' +
        'animate-pulse'
      }
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span>SENTINELLE</span>
    </div>
  );
}

function LockBadge({ locked }: { locked: boolean }) {
  return (
    <div
      title={locked ? 'Voiture verrouillée' : 'Voiture déverrouillée'}
      className={
        'w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-md border ' +
        (locked
          ? 'bg-emerald-500/70 border-emerald-300/40 text-white'
          : 'bg-amber-500/70 border-amber-300/40 text-black')
      }
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        {locked ? <path d="M8 11V7a4 4 0 0 1 8 0v4" /> : <path d="M8 11V7a4 4 0 0 1 7-1" />}
      </svg>
    </div>
  );
}

/**
 * Push the active model's camera pose (position + target + fov) into
 * the WebGL camera / OrbitControls in realtime.
 *
 * Why this exists:
 *   The `<Canvas camera={...}>` prop is only read on FIRST mount; after
 *   that, R3F leaves the perspective camera alone. That's fine in the
 *   normal viewer (the pose comes from a stable config) but BREAKS the
 *   Showroom calibration page where the user drags FOV / Position
 *   sliders and expects the framing to update instantly.
 *
 *   This component watches the resolved config and writes any change
 *   straight to the live camera + OrbitControls.target. It runs INSIDE
 *   the <Canvas> tree so it can read both via `useThree`.
 *
 * Safety: the effect runs only when the cfg references actually change
 * (the config object is memoised in `useResolvedModelConfig`), so
 * orbiting the camera with the mouse during the in-between renders
 * doesn't get stomped on.
 */
function CameraPoseSync() {
  const pose = useActiveModel().cameraPose;
  const camera = useThree((s) => s.camera);
  // drei's OrbitControls registers itself on the store via `makeDefault`.
  // The store typing in @react-three/fiber narrows `controls` to
  // EventManager which doesn't surface the .target shape — runtime-check
  // before touching it.
  const controls = useThree((s) => s.controls) as unknown as {
    target?: { fromArray: (a: ArrayLike<number>) => void };
    update?: () => void;
  } | null;

  useEffect(() => {
    camera.position.fromArray(pose.position);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera;
      pc.fov = pose.fov;
      pc.updateProjectionMatrix();
    }
    if (controls?.target && controls.update) {
      controls.target.fromArray(pose.target);
      controls.update();
    }
  }, [camera, controls, pose.position, pose.target, pose.fov]);

  return null;
}

// Tiny child component whose sole job is to call the sync hook inside the
// <OpeningsProvider> + <Canvas> tree. The hook can't be called from
// VehicleTopView3D directly because that one renders ABOVE the provider.
function VehicleStateSync({
  vehicle,
  onCableModeChange,
}: {
  vehicle: VehicleStatus;
  onCableModeChange: (mode: CableMode) => void;
}) {
  useVehicleVisualSync({ vehicle, onCableModeChange });
  return null;
}

// Preload the most-likely default chassis so the very first paint after
// login isn't blocked by a network round-trip. Per-model preload happens
// implicitly on first useGLTF call inside <PoppyseedModel>.
useGLTF.preload(PoppyseedConfig.modelUrl);
