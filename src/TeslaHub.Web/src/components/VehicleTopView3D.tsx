import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
  pickModelForVin,
  useActiveModel,
  type VehicleModelConfig,
} from './vehicleModelConfig';

// Charging handle is universal across Tesla models — same physical part
// regardless of which car it's plugged into. Not in the per-model config.
const HANDLE_URL = '/models/charger_handle.glb';

// ---- Wheel polish ---------------------------------------------------------
// The D50 base wheel set on the Highland is actually a BLACK PLASTIC
// hubcap (Photon-style cover), not an alloy. So most of our wheel meshes
// use Plastic_Black_D50 / Rubber_D50 materials. Polished alloy treatment
// stays in this file for later when we add real alloy variants (Glider,
// Helix_19, Wishbone, ZeroG, etc). Tesla reuses these material names
// (`Aluminum_*`, `Plastic_Black_*`, `Rubber_*`) verbatim across every
// Godot scene we've inspected, hence file-level regex.
//
//   ALLOY    → mat the brushed-aluminum look, boost env reflections so
//              the dark chrome doesn't render as flat black.
//   PLASTIC  → keep the matte-black plastic feel, but lift envMap a bit
//              so the spoke design stays readable instead of pitch black.
const WHEEL_ALLOY_MAT_RE = /^(aluminum|aluminium|chrome|metal_anodized|silver)/i;
const WHEEL_ALLOY_ROUGHNESS_MIN = 0.35;
const WHEEL_ALLOY_ENVMAP_BOOST = 1.6;
const WHEEL_PLASTIC_MAT_RE = /^(plastic_black|rubber)/i;
const WHEEL_PLASTIC_ROUGHNESS = 0.55;
const WHEEL_PLASTIC_ENVMAP_BOOST = 1.5;

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
    CONDITIONALLY_HIDDEN_NODE_NAMES,
    FLOOR_NODE_NAMES,
    WHEEL_ANCHORS,
    WHEEL_FALLBACK_POSITIONS,
  } = useModelConsts();
  const { scene } = useGLTF(MODEL_URL);
  const wheelGltf = useGLTF(wheelsAvailable ? WHEEL_URL : MODEL_URL);
  // ^ trick: useGLTF must be called unconditionally (hook rule). When the
  //   wheel asset is missing we reuse the main URL — its scene is then
  //   ignored by the wheel mounting code below.

  const cleanedScene = useMemo(() => {
    // Polish the wheel materials ONCE, on the original wheelGltf.scene.
    // SkeletonUtils.clone preserves material references, so tweaks made
    // here propagate to all 4 cloned wheels for free.
    if (wheelsAvailable) {
      const FLAG = '__teslahub_wheel_polished';
      const wheelSceneRef = wheelGltf.scene as unknown as Record<string, boolean>;
      if (!wheelSceneRef[FLAG]) {
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
            if (WHEEL_ALLOY_MAT_RE.test(matName)) {
              mat.roughness = Math.max(mat.roughness ?? 0.5, WHEEL_ALLOY_ROUGHNESS_MIN);
              mat.envMapIntensity = (mat.envMapIntensity ?? 1) * WHEEL_ALLOY_ENVMAP_BOOST;
              alloyCount++;
            } else if (WHEEL_PLASTIC_MAT_RE.test(matName)) {
              mat.metalness = 0;
              mat.roughness = WHEEL_PLASTIC_ROUGHNESS;
              mat.envMapIntensity = (mat.envMapIntensity ?? 1) * WHEEL_PLASTIC_ENVMAP_BOOST;
              plasticCount++;
            }
          }
        });
        wheelSceneRef[FLAG] = true;
        // eslint-disable-next-line no-console
        console.log(
          `[Poppyseed3D] wheel polish: alloy=${alloyCount} plastic=${plasticCount} | ` +
            `materials seen: ${seenMats.join(', ')}`,
        );
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
      } else if (CONDITIONALLY_HIDDEN_NODE_NAMES.has(obj.name)) {
        // Keep in the graph but invisible — Light effects will toggle
        // visibility on lock/shift events at runtime.
        obj.visible = false;
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
    // OUTER_GLASS_MAT matches Tesla's outer glass materials.
    // INNER_GLASS_MAT matches the cabin-side pane that Tesla layers
    // behind every windshield/door window — those have rough≈0.01 and
    // act as perfect mirrors, ruining the outer tint by reflecting
    // the HDR sky.
    // All three come from `cfg.materialPatterns` because Tesla renamed
    // nodes and materials between M3 (`Window_LF` / `*_Skybox`) and Y
    // (`Window_FL` / `Glass_Windows`).
    const OUTER_GLASS_NODE = cfg.materialPatterns.outerGlassNode;
    const OUTER_GLASS_MAT = cfg.materialPatterns.outerGlassMaterial;
    const INNER_GLASS_MAT = cfg.materialPatterns.innerGlassMaterial;
    const isInsideOuterGlass = (start: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = start;
      while (cur) {
        if (OUTER_GLASS_NODE.test(cur.name)) return true;
        cur = cur.parent;
      }
      return false;
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
const ROOF_TINT = 0.15; // very dark (panoramic roof)
const WINDOW_TINT = 0.45; // moderate (side windows / windshields)

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
      const existing = groupFlags.get(group) ?? { hasOuter: false, hasInner: false };
      if (hasOuterMat || isInsideOuterGlass(m)) existing.hasOuter = true;
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
      const ROOF_GLASS_NODE = cfg.materialPatterns.roofGlassNode;
      const isRoof = (() => {
        let cur: THREE.Object3D | null = mesh;
        while (cur) {
          if (ROOF_GLASS_NODE.test(cur.name)) return true;
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
        if (isGltfDefaultMat) {
          const glass = new THREE.MeshStandardMaterial({
            name: '__TeslaHub_NoMat_Glass',
            color: 0x111111,
            metalness: 0,
            roughness: 0.45,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            side: THREE.DoubleSide,
            envMapIntensity: 0.25,
          });
          if (Array.isArray(mesh.material)) {
            const idx = mesh.material.indexOf(mat as THREE.Material);
            if (idx >= 0) mesh.material[idx] = glass;
          } else {
            mesh.material = glass;
          }
          mesh.renderOrder = Math.max(mesh.renderOrder ?? 0, 2);
          if (glassDebug.length < 24) {
            glassDebug.push(`NOMAT→glass ${pathOf(mesh)}`);
          }
          transparentFixed++;
          continue;
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

        const matIsOuter = isOuter || OUTER_GLASS_MAT.test(matName);
        if (matIsOuter) {
          const std = mat as THREE.MeshStandardMaterial;

          // CRUCIAL: Tesla marks many opaque materials as
          // `alphaMode=BLEND` with alpha=1.0 in the source GLTF (see
          // Bayberry's Fade mesh: Interior_Fade, Trim_Fade, Cover_Fade,
          // Interior_Fade2 — all alpha=1.0 but BLEND). GLTFLoader sets
          // mat.transparent=true on them, then everything in the
          // transparent pass gets depth-sorted by camera distance,
          // causing flicker between near-coplanar surfaces (panoramic
          // roof + windshield, headliner + roof glass) as the orbit
          // changes the sort order. We override BLEND-but-opaque
          // materials back to actually-opaque so they go through the
          // depth-tested opaque pass and don't participate in the
          // transparent sort.
          const effectiveOpacity = std.opacity ?? 1;
          const isEffectivelyOpaque = effectiveOpacity >= 0.95;

          if (isEffectivelyOpaque) {
            std.transparent = false;
            std.depthWrite = true;
            std.side = THREE.DoubleSide;
            // Do NOT change renderOrder — let the opaque pass handle
            // depth sort naturally (renderOrder defaults to 0).
          } else {
            std.transparent = true;
            std.depthWrite = false;
            std.side = THREE.DoubleSide;
            // Stable draw order between TRULY transparent layers only.
            // Higher renderOrder draws later (= on top); panoramic
            // roof sits above other glass to avoid the windshield/roof
            // flicker at the pavilion seam.
            mesh.renderOrder = isRoof ? 3 : 2;
            // Tesla ships `Glass` material with alpha=0.16 — the
            // windshield ends up so transparent that the HDR sky shines
            // straight through and we never see the tint. Bump opacity
            // up to the dark-glass range so the colour is visible.
            if (std.opacity !== undefined && std.opacity < 0.4) {
              std.opacity = isRoof ? 0.90 : 0.55;
            }
          }

          // Dampen environment reflections on ALL outer glass (opaque
          // or transparent). With three.js's `Environment preset="city"`
          // the HDR sky bounces hard off the glass and tints it bright
          // white, which is exactly what the user reported on the Y
          // windshield. Scaling envMapIntensity by 0.3 keeps a hint of
          // chrome-ish realism without washing the tint away.
          if ('envMapIntensity' in std) {
            std.envMapIntensity = (std.envMapIntensity ?? 1) * 0.3;
          }

          // Diffuse colour tint. For materials with near-black baseColor
          // (Tesla's `Glass` = 0.01 grey, `Glass_Windows` = 0 black)
          // multiplyScalar is a no-op (anything × 0.45 ≈ 0), so set
          // an explicit visible dark-glass colour instead. Otherwise
          // multiply to preserve any pre-existing tint texture intent.
          if (std.color) {
            const c = std.color;
            if (c.r < 0.05 && c.g < 0.05 && c.b < 0.05) {
              const baseV = isRoof ? 0.05 : 0.10;
              c.setRGB(baseV, baseV, baseV);
            } else {
              c.multiplyScalar(isRoof ? ROOF_TINT : WINDOW_TINT);
            }
          }

          if (isRoof) roofFixed++;
          else windowFixed++;
          if (glassDebug.length < 16) {
            glassDebug.push(
              `${isRoof ? 'ROOF' : 'WIN'} ${mesh.name || '(unnamed)'} mat="${matName}" ` +
                `opacity=${effectiveOpacity.toFixed(2)}→${isEffectivelyOpaque ? 'OPAQUE' : (std.opacity ?? 1).toFixed(2)}`,
            );
          }
        } else if (INNER_GLASS_MAT.test(matName)) {
          // Tesla's `Glass_Interior` (rough=0.01, alpha=0.78, black) is
          // a SHARED material reused across meshes with very different
          // physical meaning. We must treat it per-mesh, which means
          // we clone it here so mutations don't bleed across meshes.
          const original = mat as THREE.MeshStandardMaterial;
          const cloned = original.clone();
          const role = meshGlassRole.get(mesh) ?? 'none';

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
              cloned.envMapIntensity = (cloned.envMapIntensity ?? 1) * 0.02;
            }
            cloned.opacity = 0.08;
            mesh.renderOrder = 1;
          } else {
            // SOLO pane: Tesla modeled the rear door windows with only
            // `Glass_Interior` (no outer Glass_Windows layer). Killing
            // the reflection here turns them into flat black panels —
            // the mirror IS what reads as "tinted glass". Keep a
            // softened reflection and the factory opacity so they look
            // like the heavily tinted rear windows that ship on the Y.
            cloned.roughness = Math.max(cloned.roughness ?? 0.5, 0.25);
            if ('envMapIntensity' in cloned) {
              cloned.envMapIntensity = (cloned.envMapIntensity ?? 1) * 0.6;
            }
            mesh.renderOrder = 2;
          }

          cloned.transparent = true;
          cloned.depthWrite = false;
          cloned.side = THREE.DoubleSide;

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
  }, [scene, wheelGltf.scene, wheelsAvailable, cfg]);

  // Click handler intentionally OMITTED. The 3D viewer is read-only on Home:
  // - State reflects live MQTT/TeslaMate signals via <useVehicleVisualSync>
  // - Action affordances are surfaced as floating callouts (<VehicleCallouts>)
  //   that route through the real Tesla command pipeline (useControlMutation)
  // - The previous "click a door to open it locally" UX caused too many
  //   accidental clicks (user dragging the orbit camera) and could not safely
  //   coexist with the 3-state Tesla charge_port_door endpoint that doubles
  //   as cable unlock when plugged in. See `VehicleCallouts` for the rebuilt
  //   Tesla Car Browser-style UI.

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

export default function VehicleTopView3D({ vehicle }: Props) {
  // Resolve the per-model config from the live VIN. This is the SINGLE
  // place where the picker fires — every descendant reads the result via
  // `useActiveModel()` (or `useModelConsts()`) through the Provider below,
  // so swapping between his Model 3 and her Model Y is just a re-render.
  const modelConfig = useMemo<VehicleModelConfig>(
    () => pickModelForVin(vehicle.vin),
    [vehicle.vin],
  );

  return (
    <VehicleModelContext.Provider value={modelConfig}>
      <VehicleTopView3DInner vehicle={vehicle} />
    </VehicleModelContext.Provider>
  );
}

function VehicleTopView3DInner({ vehicle }: Props) {
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
          </Suspense>

          {/* Read MQTT/TeslaMate state → drive openings + cableMode. */}
          <VehicleStateSync vehicle={vehicle} onCableModeChange={setCableMode} />

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
