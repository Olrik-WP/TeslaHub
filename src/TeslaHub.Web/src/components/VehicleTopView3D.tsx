import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
import { SuperchargerModelSafe } from './SuperchargerModel';
import {
  groundToCarPlugDirection,
  superchargerCablePortWorld,
} from './superchargerUtils';
import { useVehicleVisualSync } from './VehicleVisualSync';
import {
  VehicleCallouts,
  LiveChargeInfoCallout,
  type CalloutAction,
  type CalloutsActions,
  type LiveChargeInfo,
} from './VehicleCallouts';
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

// Verbose showroom / 3D diagnostics. Kept for calibration work but silenced
// in production builds so the browser console stays clean.
// eslint-disable-next-line no-console
const dbg3d: typeof console.log = (...args) => { if (import.meta.env.DEV) console.info(...args); };

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
  /** Render geometry-anchor helpers: green sphere at cableGroundAnchor,
   *  red sphere at chargePort.fallbackWorld, cyan cube at the live plug
   *  socket, one coloured sphere per wheel (LF=green, RF=red, LR=yellow,
   *  RR=blue), white wireframe around the body GLB. All overlaid via
   *  `depthTest=false` so they're visible through the car. Lets the user
   *  SEE the otherwise-invisible calibration values they're dragging. */
  anchors: boolean;
}
const DEFAULT_DEBUG_FLAGS: ShowroomDebugFlags = { glass: false, anchors: false };
const ShowroomDebugContext = createContext<ShowroomDebugFlags>(DEFAULT_DEBUG_FLAGS);
// URL of the custom body wrap PNG to apply on top of the `Paint`
// material (NOT `PaintRough`). `null` = no wrap, render solid paint
// via `bodyPaintColor`. Resolved in the outer VehicleTopView3D from
// the override blob + per-car upload existence flag, then consumed
// by `PoppyseedModel` to load + apply the texture.
interface WrapContextValue {
  url: string | null;
  /** Rotation in 90° steps (counter-clockwise) applied around the UV
   *  centre. Lets the user re-orient a PNG whose intended axis doesn't
   *  match Tesla's body UV unwrap. */
  rotationDeg: 0 | 90 | 180 | 270;
  /** Live-tunable finish (brightness / roughness / metalness /
   *  envMapIntensity). Defaults are baked into the shader; any field
   *  passed here overrides the corresponding default uniform value. */
  finish?: WrapFinishOverride;
}
const WrapUrlContext = createContext<WrapContextValue>({
  url: null,
  rotationDeg: 0,
});

// ---------------------------------------------------------------------------
// Tesla in-car wrap pipeline — faithful port of `opaque_skybox.shader`
// (Tesla-APK-Android/recover/godot/shaders/opaque_skybox.shader).
//
// Reference shader (Godot 3):
//   vec4 custom_color = texture(custom_albedo_texture, UV2);
//   vec3 final_color  = mix(color.rgb, custom_color.rgb / 10.0, custom_color.a);
//   ROUGHNESS = mix(ROUGHNESS, 0.9, custom_color.a);
//   METALLIC  = mix(METALLIC,  0.0, custom_color.a);
//   ALBEDO    = final_color;
//
// Key points faithfully reproduced below:
// - UV2 in Godot == TEXCOORD_1 in glTF == `uv1` in three.js r184. We feed it
//   via `mat.map.channel = 1` so three.js wires `vMapUv` to the second UV set.
// - `/ 10.0` is Tesla's HDR tonemap compensation — the wrap PNG is authored
//   for the Godot mobile pipeline which renders into a 10x-overbright buffer.
//   We respect it via a `wrapBrightness = 0.1` uniform applied in the shader.
// - Roughness lerps to 0.9 (matte) where the wrap is opaque; metallic to 0.
// - Meshes WITHOUT TEXCOORD_1 (Y's `Static_Door_Exterior`, `Underhood_Piece`)
//   still carry the PaintSkybox material in Tesla's scene (BayberryE41.tscn).
//   In Godot they sample UV2=(0,0) → wrap PNG corner pixel, which on every
//   Tesla template is transparent → mesh stays at body paint colour.
//   We replicate this by injecting a zeroed uv1 BufferAttribute on those
//   meshes so three.js samples the same corner pixel (same result).
// ---------------------------------------------------------------------------

/**
 * Tunable wrap finish — sent to the shader as uniforms so the user
 * can dial it in live from the Showroom (Esthétique → Wrap →
 * Finition) without triggering a shader recompile.
 *
 * Defaults are tuned for a brilliant car-paint look in three.js:
 *  - brightness 0.3 : Tesla's reference shader uses `/10.0 = 0.1`
 *      because they reinject HDR skybox brightness via an explicit
 *      EMISSION term we don't have in MeshStandardMaterial. 0.3
 *      compensates so the wrap reads as the color the user authored
 *      instead of looking 90 % darker on screen.
 *  - roughness  0.25 : modern car paint clear-coat is glossy (0.05–0.25).
 *      0.45 (the old default) looked like a satin matte vinyl.
 *  - metalness  0.5  : Tesla paint defaults to metalness 0.7. The wrap
 *      lerps DOWN to add some matte plastic flavour, but the old 0.2
 *      killed every specular highlight. 0.5 keeps a clear flake.
 *  - envMapIntensity 1.6 : we don't have Tesla's HDR skybox in scope so
 *      we modestly amplify the environment reflection on wrapped Paint
 *      meshes to recover some of the lost specular punch.
 */
export interface WrapFinishOverride {
  brightness?: number;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
}

const DEFAULT_WRAP_BRIGHTNESS = 0.3;
const DEFAULT_WRAP_ROUGHNESS_TARGET = 0.25;
const DEFAULT_WRAP_METALNESS_TARGET = 0.5;
const DEFAULT_WRAP_ENVMAP_INTENSITY = 1.6;

type WrapShaderUniforms = {
  wrapBrightness: { value: number };
  wrapRoughnessTarget: { value: number };
  wrapMetalnessTarget: { value: number };
};

type WrapMatHookState = {
  priorOnBeforeCompile: THREE.MeshStandardMaterial['onBeforeCompile'];
  priorCacheKey: (() => string) | undefined;
  priorMap: THREE.Texture | null;
  priorMapChannel: number;
  priorRoughness: number;
  priorMetalness: number;
  priorEnvMapIntensity: number;
  /** Refs to the live uniforms — kept so a finish change updates the
   *  shader without forcing a recompile / cacheKey bust. */
  wrapUniforms?: WrapShaderUniforms;
};

const WRAP_MAT_HOOK_KEY = '__teslahubWrapHook';
const WRAP_UV1_PATCHED_KEY = '__teslahubWrapUv1Patched';

// Faithful port of opaque_skybox.shader's body — adapted to three.js
// MeshStandardMaterial's chunk system. The three tunable knobs
// (brightness / roughness target / metalness target) are passed as
// uniforms so Showroom sliders can mutate them live without burning a
// new shader program.
const MAP_FRAGMENT_REPLACE = `#ifdef USE_MAP
	vec4 wrapSample = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		wrapSample = sRGBTransferEOTF( wrapSample );
	#endif
	diffuseColor.rgb = mix( diffuseColor.rgb, wrapSample.rgb * wrapBrightness, wrapSample.a );
#endif`;

const ROUGHNESS_FRAGMENT_REPLACE = `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif
#ifdef USE_MAP
	roughnessFactor = mix( roughnessFactor, wrapRoughnessTarget, texture2D( map, vMapUv ).a );
#endif`;

const METALNESS_FRAGMENT_REPLACE = `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif
#ifdef USE_MAP
	metalnessFactor = mix( metalnessFactor, wrapMetalnessTarget, texture2D( map, vMapUv ).a );
#endif`;

function meshHasWrapUv(geometry: THREE.BufferGeometry | undefined): boolean {
  if (!geometry) return false;
  const attrs = geometry.attributes;
  // GLTFLoader maps TEXCOORD_1 → `uv1` in three r184; older builds used `uv2`.
  return (attrs.uv1 ?? attrs.uv2)?.itemSize === 2;
}

/**
 * Inject a zero-filled uv1 attribute on a mesh that lacks TEXCOORD_1.
 * Mirrors Godot's default-vec2(0,0) behaviour for missing vertex
 * attributes — the wrap shader will then sample the (0,0) pixel of the
 * wrap PNG, which on every Tesla custom-wrap template is transparent
 * (alpha=0) → the mesh keeps the underlying paint colour exactly like
 * Tesla's in-car renderer does for `Static_Door_Exterior` / `Underhood_Piece`.
 *
 * Idempotent: a flag on the geometry prevents re-allocating on every
 * wrap toggle.
 */
function ensureZeroUv1(geometry: THREE.BufferGeometry): void {
  const tagged = geometry as THREE.BufferGeometry & { [WRAP_UV1_PATCHED_KEY]?: boolean };
  if (tagged[WRAP_UV1_PATCHED_KEY]) return;
  const vertexCount = geometry.attributes.position?.count;
  if (!vertexCount) return;
  const zeros = new Float32Array(vertexCount * 2);
  geometry.setAttribute('uv1', new THREE.BufferAttribute(zeros, 2));
  tagged[WRAP_UV1_PATCHED_KEY] = true;
}

function matWrapHook(mat: THREE.MeshStandardMaterial): WrapMatHookState {
  const bag = mat as THREE.MeshStandardMaterial & { [WRAP_MAT_HOOK_KEY]?: WrapMatHookState };
  if (!bag[WRAP_MAT_HOOK_KEY]) {
    bag[WRAP_MAT_HOOK_KEY] = {
      priorOnBeforeCompile: mat.onBeforeCompile,
      priorCacheKey: mat.customProgramCacheKey,
      priorMap: mat.map,
      priorMapChannel: mat.map?.channel ?? 0,
      priorRoughness: mat.roughness,
      priorMetalness: mat.metalness,
      priorEnvMapIntensity: mat.envMapIntensity,
    };
  }
  return bag[WRAP_MAT_HOOK_KEY]!;
}

function installTeslaWrapShader(
  mat: THREE.MeshStandardMaterial,
  wrapTex: THREE.Texture,
  finish?: WrapFinishOverride,
) {
  const hook = matWrapHook(mat);

  mat.map = wrapTex;
  mat.map.channel = 1;
  // PaintSkybox.tres defaults: metallic=0.7 / roughness=0.1 (glossy painted
  // metal). Match Tesla's baseline so the unwrapped (transparent) regions
  // render with the right finish.
  mat.roughness = 0.1;
  mat.metalness = 0.7;
  mat.envMapIntensity = finish?.envMapIntensity ?? DEFAULT_WRAP_ENVMAP_INTENSITY;

  // Build the uniform objects ONCE per install and keep refs on the
  // hook so subsequent finish changes can mutate `.value` directly
  // without busting the cacheKey / triggering a recompile.
  const uniforms: WrapShaderUniforms = {
    wrapBrightness: { value: finish?.brightness ?? DEFAULT_WRAP_BRIGHTNESS },
    wrapRoughnessTarget: { value: finish?.roughness ?? DEFAULT_WRAP_ROUGHNESS_TARGET },
    wrapMetalnessTarget: { value: finish?.metalness ?? DEFAULT_WRAP_METALNESS_TARGET },
  };
  hook.wrapUniforms = uniforms;

  const priorCompile = hook.priorOnBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    priorCompile?.(shader, renderer);
    shader.uniforms.wrapBrightness = uniforms.wrapBrightness;
    shader.uniforms.wrapRoughnessTarget = uniforms.wrapRoughnessTarget;
    shader.uniforms.wrapMetalnessTarget = uniforms.wrapMetalnessTarget;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float wrapBrightness;
uniform float wrapRoughnessTarget;
uniform float wrapMetalnessTarget;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      MAP_FRAGMENT_REPLACE,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      ROUGHNESS_FRAGMENT_REPLACE,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      METALNESS_FRAGMENT_REPLACE,
    );
  };
  mat.customProgramCacheKey = () => `teslahub-wrap-${wrapTex.uuid}`;
  mat.needsUpdate = true;
}

/**
 * Live-tweak the wrap finish on an already-wrapped material. Cheap:
 * mutates the existing uniform values directly so the renderer picks
 * the new look on the next frame without recompiling the shader.
 * No-op if `installTeslaWrapShader` hasn't run on this material yet.
 */
function updateWrapFinish(
  mat: THREE.MeshStandardMaterial,
  finish: WrapFinishOverride | undefined,
) {
  const bag = mat as THREE.MeshStandardMaterial & { [WRAP_MAT_HOOK_KEY]?: WrapMatHookState };
  const hook = bag[WRAP_MAT_HOOK_KEY];
  if (!hook?.wrapUniforms) return;
  hook.wrapUniforms.wrapBrightness.value =
    finish?.brightness ?? DEFAULT_WRAP_BRIGHTNESS;
  hook.wrapUniforms.wrapRoughnessTarget.value =
    finish?.roughness ?? DEFAULT_WRAP_ROUGHNESS_TARGET;
  hook.wrapUniforms.wrapMetalnessTarget.value =
    finish?.metalness ?? DEFAULT_WRAP_METALNESS_TARGET;
  mat.envMapIntensity = finish?.envMapIntensity ?? DEFAULT_WRAP_ENVMAP_INTENSITY;
}

function clearTeslaWrapShader(mat: THREE.MeshStandardMaterial, paintHex: number) {
  const bag = mat as THREE.MeshStandardMaterial & { [WRAP_MAT_HOOK_KEY]?: WrapMatHookState };
  const hook = bag[WRAP_MAT_HOOK_KEY];
  if (hook) {
    mat.onBeforeCompile = hook.priorOnBeforeCompile ?? (() => {});
    mat.customProgramCacheKey = hook.priorCacheKey ?? (() => '');
    mat.map = hook.priorMap;
    if (mat.map) mat.map.channel = hook.priorMapChannel;
    mat.roughness = hook.priorRoughness;
    mat.metalness = hook.priorMetalness;
    mat.envMapIntensity = hook.priorEnvMapIntensity;
    delete bag[WRAP_MAT_HOOK_KEY];
  } else {
    mat.onBeforeCompile = () => {};
    mat.customProgramCacheKey = () => '';
    mat.map = null;
  }
  mat.color.setHex(paintHex);
  mat.needsUpdate = true;
}

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

// === Wheel material upgrade pipeline ======================================
//
// Why every wheel material is converted to `MeshPhysicalMaterial` AT GLB
// LOAD TIME (before any `SkeletonUtils.clone`):
//
// We tried two earlier approaches and both broke in subtle ways:
//
//   1. Lazy upgrade on first clearcoat>0 tick + slot swap
//      (`mesh.material[i] = phys`). Each wheel clone has its OWN
//      `material[]` array (Three's `Mesh.copy` does `.slice()` on
//      array materials), so the swap only flipped the TEMPLATE's slot;
//      the four visible clones kept rendering the un-upgraded
//      MeshStandardMaterial. User-visible bug: "touching alloy
//      clearcoat freezes every other slider — even the tint — until
//      I refresh".
//
//   2. Same lazy upgrade + post-clone "relink" helper that reassigned
//      `cloneMesh.material = templateMesh.material` to share the array.
//      Worked on paper but still broke in practice (timing? r3f
//      re-mount race? a hidden second clone path inside drei's
//      `<Environment>`/`Suspense` hierarchy?). Hard to reason about.
//
// The robust fix is to NOT swap slots at all. Convert every wheel
// material to MeshPhysicalMaterial UPFRONT, once per GLB. Now every
// `mesh.material[i]` slot — on the template AND on every future clone
// — is a phys from day one. The polish just mutates `phys.clearcoat`,
// `phys.color`, `phys.roughness` etc. on the SHARED instance and the
// change is visible on every clone immediately.
//
// Cost of "always physical": zero. Three's `WebGLPrograms` keys the
// shader cache on `material.clearcoat > 0`, so a phys with clearcoat=0
// compiles to EXACTLY the same shader chunks as a MeshStandardMaterial.
// Bumping clearcoat above 0 triggers a one-off recompile with
// USE_CLEARCOAT — exactly what we want, exactly when we want it.
type WheelMaterialBaseline = {
  roughness: number;
  envMapIntensity: number;
  color: number;
  metalness: number;
};
const WHEEL_UPGRADED_KEY = '__teslahub_wheel_upgraded';
const WHEEL_BASELINE_KEY = '__teslahub_wheel_baselines';

const captureBaseline = (phys: THREE.MeshPhysicalMaterial): WheelMaterialBaseline => ({
  roughness: phys.roughness ?? 0.5,
  envMapIntensity: phys.envMapIntensity ?? 1,
  color: phys.color ? phys.color.getHex() : 0xffffff,
  metalness: phys.metalness ?? 0,
});

const upgradeWheelMaterialsInPlace = (wheelScene: THREE.Object3D): void => {
  const sceneAny = wheelScene as unknown as Record<string, unknown>;
  if (sceneAny[WHEEL_UPGRADED_KEY]) return;

  // Dedup map: a wheel GLB with 5 primitives but only 4 unique
  // materials (D50: Pirelli, m1, m2, m1, m3 — m1 shared between
  // slots 1 and 3) must NOT allocate 5 different phys clones.
  const upgradeCache = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  const baselines = new WeakMap<THREE.MeshPhysicalMaterial, WheelMaterialBaseline>();

  const upgrade = (m: THREE.Material): THREE.Material => {
    if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      const phys = m as THREE.MeshPhysicalMaterial;
      if (!baselines.has(phys)) baselines.set(phys, captureBaseline(phys));
      return phys;
    }
    if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      return m;
    }
    const cached = upgradeCache.get(m);
    if (cached) return cached;
    const original = m as THREE.MeshStandardMaterial;
    const phys = new THREE.MeshPhysicalMaterial();
    // See the comment in the earlier (now-removed) lazy upgrader:
    // NEVER call `phys.copy(original)`. MeshPhysicalMaterial.copy()
    // reads Physical-only fields (`clearcoatNormalScale.x`, …) off
    // the source and crashes when the source is a plain
    // MeshStandardMaterial. Bypass via the parent class's copy.
    THREE.MeshStandardMaterial.prototype.copy.call(phys, original);
    // copy() clobbers `defines` back to `{ STANDARD: '' }`. Restore
    // PHYSICAL so the `lights_physical_*` shader chunks light up and
    // the clearcoat uniform actually reaches the BRDF. clearcoat=0
    // still compiles to the cheap Standard shader (USE_CLEARCOAT
    // define is only set when clearcoat > 0).
    phys.defines = { STANDARD: '', PHYSICAL: '' };
    phys.clearcoat = 0;
    phys.needsUpdate = true;
    phys.name = original.name;
    baselines.set(phys, captureBaseline(phys));
    upgradeCache.set(m, phys);
    return phys;
  };

  wheelScene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      for (let i = 0; i < mesh.material.length; i++) {
        mesh.material[i] = upgrade(mesh.material[i]) as THREE.Material;
      }
    } else if (mesh.material) {
      mesh.material = upgrade(mesh.material);
    }
  });

  sceneAny[WHEEL_UPGRADED_KEY] = true;
  sceneAny[WHEEL_BASELINE_KEY] = baselines;
};

const getWheelBaselines = (
  wheelScene: THREE.Object3D,
): WeakMap<THREE.MeshPhysicalMaterial, WheelMaterialBaseline> | undefined =>
  (wheelScene as unknown as Record<string, unknown>)[WHEEL_BASELINE_KEY] as
    | WeakMap<THREE.MeshPhysicalMaterial, WheelMaterialBaseline>
    | undefined;

const isPlasticByPbrBaseline = (base: WheelMaterialBaseline): boolean =>
  base.metalness < 0.2 && base.roughness > 0.7;

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
      CABLE_SLACK: cfg.cableSlack,
      SUPERCHARGER_PORT_WORLD: superchargerCablePortWorld(cfg.supercharger),
      SUPERCHARGER_MODEL_URL: cfg.supercharger.modelUrl,
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
  // Models whose wheels are baked into the body declare no wheel anchors
  // and no fallback positions. For those we must NEVER load a separate
  // wheel GLB: `WHEEL_URL` may point at the body itself (community model)
  // or, on a transient stale `wheelsAvailable === true` during a model
  // switch, at a now-wrong URL — feeding either to useGLTF risks mutating
  // the body materials or poisoning drei's cache with a 404.
  const hasSeparateWheels =
    WHEEL_ANCHORS.length > 0 || WHEEL_FALLBACK_POSITIONS.length > 0;
  const useSeparateWheels = hasSeparateWheels && wheelsAvailable;
  const { scene: rawScene } = useGLTF(MODEL_URL);
  const wheelGltf = useGLTF(useSeparateWheels ? WHEEL_URL : MODEL_URL);
  // ^ trick: useGLTF must be called unconditionally (hook rule). When the
  //   wheel asset is missing / not applicable we reuse the main URL — its
  //   scene is then ignored by the wheel mounting code below.

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
    // Polish the wheel materials ONCE on the wheelGltf.scene template.
    // Every clone (SkeletonUtils.clone) below shares per-slot refs to
    // the SAME MeshPhysicalMaterial instances, so mutations here
    // propagate to all 4 visible wheels for free — no slot swapping,
    // no per-clone bookkeeping. See upgradeWheelMaterialsInPlace() at
    // module scope for the why-not-lazy explanation.
    if (useSeparateWheels) {
      upgradeWheelMaterialsInPlace(wheelGltf.scene);
      const baselines = getWheelBaselines(wheelGltf.scene);
      if (baselines) {
        const finish = cfg.wheelFinish;
        let alloyCount = 0;
        let plasticCount = 0;
        const seenMats: string[] = [];
        wheelGltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const matsArr: THREE.Material[] = Array.isArray(mesh.material)
            ? (mesh.material as THREE.Material[])
            : [mesh.material as THREE.Material];
          for (const slotMat of matsArr) {
            const phys = slotMat as THREE.MeshPhysicalMaterial;
            if (!phys.isMeshPhysicalMaterial) continue;
            const base = baselines.get(phys);
            if (!base) continue;
            const matName = phys.name ?? '';
            // Classification: named "tire/Pirelli" mats are plastic.
            // Anonymous mats fall back to baseline PBR sniffing — see
            // isPlasticByPbrBaseline(). We read the BASELINE (not the
            // live phys values), otherwise our own roughness/metalness
            // mutations from a previous tick would feed the classifier.
            const isPlastic =
              WHEEL_TIRE_MAT_RE.test(matName) ||
              (matName === '' && isPlasticByPbrBaseline(base));
            const tag = matName || `(unnamed metal=${base.metalness.toFixed(2)} rough=${base.roughness.toFixed(2)})`;
            const label = `${tag}→${isPlastic ? 'plastic' : 'alloy'}`;
            if (seenMats.indexOf(label) === -1) seenMats.push(label);
            if (isPlastic) {
              phys.clearcoat = finish.plasticClearcoat;
              phys.clearcoatRoughness = 0.1;
              phys.metalness = 0;
              phys.roughness = finish.plasticRoughness;
              phys.envMapIntensity = base.envMapIntensity * finish.plasticEnvBoost;
              plasticCount++;
            } else {
              // Alloy / rim path — covers named Tesla rim mats
              // (Helix2_Dark2, GeminiDark3, Arachnid_V2_213,
              // BayberryE41Material…) AND every anonymous wheel mat
              // whose baseline PBR factors say "metal" (D50 inner
              // rim metalness=0.9, chromed bolts, etc.). The
              // alloyClearcoat slider lays a transparent lacquer
              // layer on top — Tesla uses it on D50/E41 hubcaps to
              // turn matte black into "glossy black painted".
              phys.clearcoat = finish.alloyClearcoat;
              phys.clearcoatRoughness = 0.1;
              phys.roughness = Math.max(base.roughness, finish.alloyRoughnessMin);
              phys.envMapIntensity = base.envMapIntensity * finish.alloyEnvBoost;
              if (phys.color) {
                if (finish.alloyTint !== undefined) {
                  phys.color.setHex(finish.alloyTint);
                } else {
                  phys.color.setHex(base.color);
                }
              }
              alloyCount++;
            }
          }
        });
        // eslint-disable-next-line no-console
        dbg3d(
          `[Poppyseed3D] wheel polish: alloy=${alloyCount} plastic=${plasticCount} | ` +
            `materials seen: ${seenMats.join(', ')} | ` +
            `clearcoat alloy=${finish.alloyClearcoat.toFixed(2)} ` +
            `plastic=${finish.plasticClearcoat.toFixed(2)}`,
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
    dbg3d(
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
      dbg3d('[Poppyseed3D] glass meshes:', glassDebug);
    }
    if (paintFixed > 0) {
      // eslint-disable-next-line no-console
      dbg3d('[Poppyseed3D] painted meshes:', paintDebug);
    }
    if (floorFixed > 0) {
      // eslint-disable-next-line no-console
      dbg3d(`[Poppyseed3D] floor shadow meshes fixed: ${floorFixed}`);
    }

    let wheelsAttached = 0;
    let wheelMode: 'anchor' | 'fallback' | 'none' = 'none';
    if (useSeparateWheels) {
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
              dbg3d(
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
    dbg3d(
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
  }, [scene, wheelGltf.scene, wheelsAvailable, useSeparateWheels, cfg, debugGlass]);

  // Click handler intentionally OMITTED. The 3D viewer is read-only on Home:
  // - State reflects live MQTT/TeslaMate signals via <useVehicleVisualSync>
  // - Action affordances are surfaced as floating callouts (<VehicleCallouts>)
  //   that route through the real Tesla command pipeline (useControlMutation)
  // - The previous "click a door to open it locally" UX caused too many
  //   accidental clicks (user dragging the orbit camera) and could not safely
  //   coexist with the 3-state Tesla charge_port_door endpoint that doubles
  //   as cable unlock when plugged in. See `VehicleCallouts` for the rebuilt
  //   Tesla Car Browser-style UI.

  // ── Custom body wrap (Tesla PaintSkybox / opaque_skybox.shader) ───
  const { url: wrapUrl, finish: wrapFinish } = useContext(WrapUrlContext);
  useEffect(() => {
    const targets: THREE.MeshStandardMaterial[] = [];
    const paintMeshes: THREE.Mesh[] = [];
    const paintMeshesWithoutUv1: THREE.Mesh[] = [];

    cleanedScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let isPaintMesh = false;
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if ((std as { name?: string }).name === 'Paint') {
          targets.push(std);
          isPaintMesh = true;
        }
      }
      if (isPaintMesh) {
        paintMeshes.push(mesh);
        if (!meshHasWrapUv(mesh.geometry)) paintMeshesWithoutUv1.push(mesh);
      }
    });

    if (targets.length === 0) {
      console.warn('[Wrap] No `Paint` material found — wrap cannot apply.');
      return;
    }

    if (!wrapUrl) {
      for (const mat of new Set(targets)) clearTeslaWrapShader(mat, cfg.bodyPaintColor);
      return;
    }

    // Patch meshes that lack TEXCOORD_1 with a zero-filled uv1 attribute.
    // This matches Tesla's runtime behaviour: Static_Door_Exterior and
    // Underhood_Piece on the Y carry the PaintSkybox material in the source
    // .tscn scene but ship without UV2 in the GLB. Godot falls back to
    // vec2(0,0) for missing vertex attributes → wrap PNG corner pixel
    // (transparent) → mesh keeps the body paint colour. We replicate.
    if (paintMeshesWithoutUv1.length > 0) {
      for (const mesh of paintMeshesWithoutUv1) {
        if (mesh.geometry) ensureZeroUv1(mesh.geometry);
      }
      dbg3d(
        `[Wrap] Patched ${paintMeshesWithoutUv1.length} Paint mesh(es) lacking ` +
        `TEXCOORD_1 with zero-uv1 fallback (Tesla skybox parity): ` +
        paintMeshesWithoutUv1.map((m) => m.name || '(unnamed)').join(', '),
      );
    }

    dbg3d(
      `[Wrap] Loading wrap → ${targets.length} Paint mat(s), ` +
      `${paintMeshes.length} mesh(es) total ` +
      `(${paintMeshes.length - paintMeshesWithoutUv1.length} native uv1, ` +
      `${paintMeshesWithoutUv1.length} patched).`,
    );

    const img = new Image();
    if (!wrapUrl.startsWith('data:')) img.crossOrigin = 'anonymous';
    let cancelled = false;
    let loadedTex: THREE.Texture | null = null;

    img.onload = () => {
      if (cancelled) return;
      const tex = new THREE.Texture(img);
      // glTF convention: textures expect Y=0 at the top of the image (flipY=false).
      // The Tesla wrap PNG templates (custom-wraps + Skins) follow that convention
      // since the UV1 layout in the GLB was authored against the same orientation.
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      loadedTex = tex;

      const uniqueTargets = [...new Set(targets)];
      for (const mat of uniqueTargets) {
        mat.color.setHex(cfg.bodyPaintColor);
        installTeslaWrapShader(mat, tex, wrapFinish);
      }
      dbg3d(
        `[Wrap] Applied opaque_skybox.shader port on ${uniqueTargets.length} ` +
        `unique Paint material(s) (channel=1, brightness=${(wrapFinish?.brightness ?? DEFAULT_WRAP_BRIGHTNESS).toFixed(2)}, ` +
        `rough→${(wrapFinish?.roughness ?? DEFAULT_WRAP_ROUGHNESS_TARGET).toFixed(2)}, ` +
        `metal→${(wrapFinish?.metalness ?? DEFAULT_WRAP_METALNESS_TARGET).toFixed(2)}).`,
      );
    };
    img.onerror = () => console.warn(`[Wrap] Image load failed: ${wrapUrl.slice(0, 80)}`);
    img.src = wrapUrl;

    return () => {
      cancelled = true;
      if (loadedTex) {
        for (const mat of new Set(targets)) clearTeslaWrapShader(mat, cfg.bodyPaintColor);
        loadedTex.dispose();
      }
    };
    // wrapFinish + bodyPaintColor are intentionally OUT of the deps
    // array: changing a slider or the background paint would otherwise
    // re-fetch the PNG and re-allocate the texture (slow + flicker).
    // Separate effects below mutate uniforms / mat.color in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanedScene, wrapUrl]);

  // Live-sync background paint under the wrap (transparent PNG areas).
  useEffect(() => {
    if (!wrapUrl) return;
    cleanedScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if ((std as { name?: string }).name === 'Paint') {
          std.color.setHex(cfg.bodyPaintColor);
        }
      }
    });
  }, [cleanedScene, wrapUrl, cfg.bodyPaintColor]);

  // Live-sync the wrap finish uniforms. Mutates the existing uniforms
  // on every Paint material — cheap (no texture reload, no shader
  // recompile) so the user can drag the sliders and see the result on
  // the next frame.
  const wrapBrightness = wrapFinish?.brightness;
  const wrapRoughness = wrapFinish?.roughness;
  const wrapMetalness = wrapFinish?.metalness;
  const wrapEnvMapIntensity = wrapFinish?.envMapIntensity;
  useEffect(() => {
    if (!wrapUrl) return;
    cleanedScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if ((std as { name?: string }).name === 'Paint') {
          updateWrapFinish(std, {
            brightness: wrapBrightness,
            roughness: wrapRoughness,
            metalness: wrapMetalness,
            envMapIntensity: wrapEnvMapIntensity,
          });
        }
      }
    });
  }, [
    cleanedScene,
    wrapUrl,
    wrapBrightness,
    wrapRoughness,
    wrapMetalness,
    wrapEnvMapIntensity,
  ]);

  // Optional per-model corrective transform (community / 3rd-party GLBs
  // that ship with a baked unit scale or off-axis forward). Tesla models
  // leave `rootTransform` undefined → identity group, zero behaviour
  // change. The opening animator still mutates the SAME scene object by
  // reference, so wrapping in a group doesn't affect door/hood pivots.
  const rt = cfg.rootTransform;
  const rootScale = rt?.scale ?? 1;
  const rootRotation: [number, number, number] = rt?.rotation
    ? [
        (rt.rotation[0] * Math.PI) / 180,
        (rt.rotation[1] * Math.PI) / 180,
        (rt.rotation[2] * Math.PI) / 180,
      ]
    : [0, 0, 0];
  const rootPosition = rt?.position ?? [0, 0, 0];

  return (
    <>
      <group scale={rootScale} rotation={rootRotation} position={rootPosition}>
        <primitive object={cleanedScene} />
      </group>
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
    CABLE_SLACK,
    SUPERCHARGER_PORT_WORLD,
  } = useModelConsts();

  // Resolved anchor + last-computed plug world position.
  // so the `useFrame` retry below only does work until the anchor is
  // found, after which it's a no-op (no per-frame scene traversal).
  const anchorRef = useRef<THREE.Object3D | null>(null);
  const retriesRef = useRef(0);
  const [endWorld, setEndWorld] = useState<THREE.Vector3 | null>(null);

  // Recompute the plug socket world position from the cached anchor.
  // `chargePortOpenness` is folded in via the effect below so the
  // socket follows the trapdoor as it animates open / closed.
  const recomputeFromAnchor = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    // CRITICAL: matrixWorld is stale until the first render. Force-update
    // up the parent chain BEFORE reading getWorldPosition, otherwise we
    // get the local origin (0,0,0) of an un-rendered scene.
    anchor.updateWorldMatrix(true, false);
    const pivotWorld = new THREE.Vector3();
    anchor.getWorldPosition(pivotWorld);
    return pivotWorld.add(PORT_FROM_PIVOT_OFFSET);
  }, [PORT_FROM_PIVOT_OFFSET]);

  // Re-resolve the anchor when the VIN swaps (different alternate names)
  // or when the user reloads — clears the cached ref so the retry loop
  // below picks up the new scene.
  useEffect(() => {
    anchorRef.current = null;
    retriesRef.current = 0;
    setEndWorld(null);
  }, [CHARGE_PORT_NODE, CHARGE_PORT_ALT_NAMES]);

  // Re-place the plug whenever the trapdoor animates open/closed —
  // the anchor's world position changes with the hinge angle.
  useEffect(() => {
    if (!anchorRef.current) return;
    const w = recomputeFromAnchor();
    if (w) setEndWorld(w);
  }, [chargePortOpenness, recomputeFromAnchor]);

  // Retry-until-found loop. Fixes the race where <LiveChargingCable>
  // mounts BEFORE the GLB is added to the scene (e.g. the user lands
  // on Home with MQTT already saying "plugged" while the lazy-loaded
  // 3D model is still streaming in). useMemo on `scene` couldn't see
  // this because the scene reference is stable — only its children
  // change. We poll the scene graph every frame until the named anchor
  // appears, then fold its world position into `endWorld` and stop
  // doing per-frame work. After ~2s of failure (120 frames @ 60fps)
  // we settle on the per-model fallback world so the cable doesn't
  // stay invisible forever on an unknown GLB.
  useFrame(() => {
    if (anchorRef.current) return;
    const candidates = [CHARGE_PORT_NODE, ...CHARGE_PORT_ALT_NAMES];
    for (const name of candidates) {
      const obj = scene.getObjectByName(name);
      if (obj) {
        anchorRef.current = obj;
        const w = recomputeFromAnchor();
        if (w) {
          setEndWorld(w);
          // eslint-disable-next-line no-console
          dbg3d(
            `[Vehicle3D] charge port anchor "${name}" resolved at world ` +
              `(${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)}) ` +
              `after ${retriesRef.current} frame(s).`,
          );
        }
        return;
      }
    }
    retriesRef.current += 1;
    if (retriesRef.current === 120) {
      // eslint-disable-next-line no-console
      console.warn(
        `[Vehicle3D] charge port anchor not found after 120 frames ` +
          `(tried: ${candidates.join(', ')}) — using per-model fallback.`,
      );
      setEndWorld(CHARGE_PORT_FALLBACK_WORLD.clone());
    }
  });

  const groundToCarDir = useMemo(
    () =>
      groundToCarPlugDirection(
        CABLE_GROUND_WORLD,
        endWorld ?? CHARGE_PORT_FALLBACK_WORLD,
      ),
    [CABLE_GROUND_WORLD, endWorld, CHARGE_PORT_FALLBACK_WORLD],
  );

  if (mode === 'off') return null;
  // Hide the cable for at most a couple of frames while we wait for
  // the GLB anchor — much better than rendering it at (0,0,0) under
  // the car for the user to see for ~1 second.
  if (!endWorld) return null;

  // Enable visual debug helpers by appending ?debug=cable to the URL.
  // Renders two small markers: green=ground start, red=charge port end.
  const debugCable =
    typeof window !== 'undefined' && window.location.search.includes('debug=cable');

  const charging = mode === 'charging';
  // `groundToCarDir` is recomputed inside <ChargingCable> via `viaWorld`;
  // keep the variable referenced so eslint doesn't strip it.
  void groundToCarDir;

  return (
    <>
      {/* Single continuous cable: SC port → ground drape → car port. The
          ground waypoint forces the curve to touch the floor mid-span
          without splitting the tube in two — no visible junction. */}
      <ChargingCable
        startWorld={SUPERCHARGER_PORT_WORLD}
        viaWorld={CABLE_GROUND_WORLD}
        endWorld={endWorld}
        plugDirection={PLUG_DIRECTION}
        charging={charging}
        handleUrl={handleAvailable ? HANDLE_URL : undefined}
        slackStart={CABLE_SLACK.post}
        slackEnd={CABLE_SLACK.car}
      />
      {debugCable && (
        <>
          <mesh position={SUPERCHARGER_PORT_WORLD}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
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

// ---------------------------------------------------------------------------
// ShowroomAnchorMarkers — visual debug helpers for the 3 "blind" geometry
// inputs that have NO live preview tied to them by default. Without these
// the user can drag the sliders and silently break the rig because the
// only visible effect is conditional (the fallback only appears if the
// GLB anchor goes missing, the cable ground only matters when plugged in,
// the plug-socket offset is invisible unless you mentally subtract the
// anchor world position). Mounted ONLY when `showroomMode === true`
// (the Showroom passes it, Home doesn't) so it has zero impact in prod.
//
//   GREEN sphere : cableGroundAnchor — where the cable touches the floor
//   RED   sphere : chargePort.fallbackWorld — invisible in prod IF the
//                  GLB anchor is found; this marker tells you so AND warns
//                  if it's parked dangerously close to the origin (which
//                  is why users land on a cable glued under the car when
//                  they swap a GLB or hit the race condition)
//   CYAN  cube   : computed plug socket (anchor world + pivotToSocketOffset)
//                  — the actual point the cable's plug attaches to
// ---------------------------------------------------------------------------
function ShowroomAnchorMarkers() {
  const { scene } = useThree();
  const cfg = useActiveModel();
  const {
    CHARGE_PORT_NODE,
    CHARGE_PORT_ALT_NAMES,
    CHARGE_PORT_FALLBACK_WORLD,
    PORT_FROM_PIVOT_OFFSET,
    CABLE_GROUND_WORLD,
    SUPERCHARGER_PORT_WORLD,
  } = useModelConsts();
  const scPosition = useMemo(
    () => new THREE.Vector3(...cfg.supercharger.position),
    [cfg.supercharger.position],
  );

  const anchorRef = useRef<THREE.Object3D | null>(null);
  const plugSocketGroupRef = useRef<THREE.Group>(null);
  const [anchorFound, setAnchorFound] = useState(false);

  // Reset the cached anchor on model swap so we re-resolve against
  // the new scene (different node names possible per family).
  useEffect(() => {
    anchorRef.current = null;
    setAnchorFound(false);
  }, [CHARGE_PORT_NODE, CHARGE_PORT_ALT_NAMES]);

  // Live-update the plug socket marker every frame so dragging the
  // pivotToSocketOffset sliders moves the cyan cube in realtime. We
  // mutate the wrapper group's position imperatively to avoid the
  // React state churn that would come from setState-per-frame.
  useFrame(() => {
    if (!anchorRef.current) {
      const candidates = [CHARGE_PORT_NODE, ...CHARGE_PORT_ALT_NAMES];
      for (const name of candidates) {
        const obj = scene.getObjectByName(name);
        if (obj) {
          anchorRef.current = obj;
          setAnchorFound(true);
          break;
        }
      }
    }
    const group = plugSocketGroupRef.current;
    const anchor = anchorRef.current;
    if (anchor && group) {
      anchor.updateWorldMatrix(true, false);
      const pivot = new THREE.Vector3();
      anchor.getWorldPosition(pivot);
      group.position.copy(pivot.add(PORT_FROM_PIVOT_OFFSET));
    }
  });

  // "Dangerously close to origin" check — same heuristic that traps the
  // bug where the user drags the fallbackWorld sliders to ~(0,0,0)
  // without noticing because nothing on screen moves.
  const fallbackBroken =
    CHARGE_PORT_FALLBACK_WORLD.length() < 0.5;

  const labelStyle = (color: string): React.CSSProperties => ({
    background: 'rgba(0,0,0,0.78)',
    color,
    padding: '3px 7px',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transform: 'translateY(-1.4em)',
  });

  return (
    <>
      {/* Green sphere — cable ground anchor (where cable touches floor) */}
      <group position={CABLE_GROUND_WORLD}>
        <mesh renderOrder={999}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#22c55e" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <Html distanceFactor={6} center>
          <div style={labelStyle('#22c55e')}>
            cableGroundAnchor
            <div style={{ fontSize: 9, opacity: 0.7 }}>
              [{CABLE_GROUND_WORLD.x.toFixed(2)}, {CABLE_GROUND_WORLD.y.toFixed(2)},{' '}
              {CABLE_GROUND_WORLD.z.toFixed(2)}]
            </div>
          </div>
        </Html>
      </group>

      {/* Orange sphere — Supercharger cable port (SC → ground segment start) */}
      <group position={SUPERCHARGER_PORT_WORLD}>
        <mesh renderOrder={999}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#f59e0b" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <Html distanceFactor={6} center>
          <div style={labelStyle('#f59e0b')}>
            supercharger.cablePortOffset
            <div style={{ fontSize: 9, opacity: 0.7 }}>
              [{SUPERCHARGER_PORT_WORLD.x.toFixed(2)}, {SUPERCHARGER_PORT_WORLD.y.toFixed(2)},{' '}
              {SUPERCHARGER_PORT_WORLD.z.toFixed(2)}]
            </div>
          </div>
        </Html>
      </group>

      {/* Amber wireframe — Supercharger base origin */}
      <group position={scPosition}>
        <mesh renderOrder={998}>
          <boxGeometry args={[0.35, 2.1, 0.35]} />
          <meshBasicMaterial
            color="#f59e0b"
            wireframe
            depthTest={false}
            transparent
            opacity={0.55}
          />
        </mesh>
        <Html distanceFactor={6} center>
          <div style={labelStyle('#f59e0b')}>
            supercharger.position
            <div style={{ fontSize: 9, opacity: 0.7 }}>
              [{scPosition.x.toFixed(2)}, {scPosition.y.toFixed(2)}, {scPosition.z.toFixed(2)}]
              {' · rotY '}
              {cfg.supercharger.rotationY}°
            </div>
          </div>
        </Html>
      </group>

      {/* Red sphere — charge port fallback (only used when anchor missing) */}
      <group position={CHARGE_PORT_FALLBACK_WORLD}>
        <mesh renderOrder={999}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <Html distanceFactor={6} center>
          <div style={labelStyle('#ef4444')}>
            chargePort.fallbackWorld
            <div style={{ fontSize: 9, opacity: 0.8 }}>
              [{CHARGE_PORT_FALLBACK_WORLD.x.toFixed(2)},{' '}
              {CHARGE_PORT_FALLBACK_WORLD.y.toFixed(2)},{' '}
              {CHARGE_PORT_FALLBACK_WORLD.z.toFixed(2)}]
              {anchorFound ? ' — INACTIF (anchor trouvé)' : ' — ACTIF (anchor introuvable!)'}
            </div>
            {fallbackBroken && (
              <div style={{ fontSize: 10, color: '#f97316', marginTop: 2 }}>
                ⚠ Trop proche du centre du monde — risque de câble sous le modèle
              </div>
            )}
          </div>
        </Html>
      </group>

      {/* Cyan cube — actual plug socket world position (live) */}
      <group ref={plugSocketGroupRef}>
        <mesh renderOrder={999}>
          <boxGeometry args={[0.06, 0.06, 0.06]} />
          <meshBasicMaterial color="#06b6d4" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <Html distanceFactor={6} center>
          <div style={labelStyle('#06b6d4')}>
            plug socket (live)
            <div style={{ fontSize: 9, opacity: 0.7 }}>
              anchor + pivotToSocketOffset
              {!anchorFound && ' — anchor introuvable'}
            </div>
          </div>
        </Html>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// WheelMarkers — one coloured sphere per wheel position with its world
// coordinates printed underneath. The colours match the cardinal corner
// (LF=green, RF=red, LR=yellow, RR=blue) so the user can identify which
// slider moves which sphere without reading the label. Reads
// WHEEL_FALLBACK_POSITIONS directly — these are the EXACT world coords
// the runtime feeds to `wrapper.position.set(x, y, z)` (line ~1349 in
// PoppyseedModel), so what you see here is what the wheel renderer sees.
// ---------------------------------------------------------------------------
function WheelMarkers() {
  const { WHEEL_FALLBACK_POSITIONS } = useModelConsts();
  const cornerColours: Record<string, string> = {
    LF: '#22c55e',
    RF: '#ef4444',
    LR: '#facc15',
    RR: '#3b82f6',
  };
  return (
    <>
      {WHEEL_FALLBACK_POSITIONS.map((w) => (
        <group key={w.id} position={[w.x, w.y, w.z]}>
          <mesh renderOrder={999}>
            <sphereGeometry args={[0.06, 14, 14]} />
            <meshBasicMaterial
              color={cornerColours[w.id] ?? '#ffffff'}
              depthTest={false}
              transparent
              opacity={0.9}
            />
          </mesh>
          <Html distanceFactor={6} center>
            <div
              style={{
                background: 'rgba(0,0,0,0.78)',
                color: cornerColours[w.id] ?? '#ffffff',
                padding: '3px 7px',
                borderRadius: 4,
                fontSize: 11,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                transform: 'translateY(-1.4em)',
              }}
            >
              {w.id}
              <div style={{ fontSize: 9, opacity: 0.7 }}>
                [{w.x.toFixed(2)}, {w.y.toFixed(2)}, {w.z.toFixed(2)}]
              </div>
            </div>
          </Html>
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// BodyBoundingBoxWire — wireframe box around the loaded body GLB to make
// the actual rendered body dimensions visible to the user. Useful when
// the wheel positions look right "by eye" but the absolute numbers don't
// match the real-car spec (typical sign that the GLB has a scale factor
// baked into a parent transform — the wireframe shows the in-scene size
// vs the real-world spec the user can mentally compare to).
//
// We can't compute bbox of the whole scene (it'd include the floor +
// wheels which are added separately). Instead we look for one of the
// known body root nodes per family. Falls back to the entire model GLB
// scene minus floor meshes if no body root is found.
// ---------------------------------------------------------------------------
function BodyBoundingBoxWire() {
  const { scene } = useThree();
  const { FLOOR_NODE_NAMES } = useModelConsts();
  const [bbox, setBbox] = useState<{ size: THREE.Vector3; center: THREE.Vector3 } | null>(null);
  const triesRef = useRef(0);

  // Retry until something useful shows up in the scene graph. Same
  // pattern as LiveChargingCable — the body GLB streams in async via
  // Suspense and isn't necessarily present on the first frame.
  useFrame(() => {
    if (bbox) return;
    triesRef.current += 1;
    // Look for known body root node names first (cheaper + tighter box).
    const candidates = ['Body', 'Static_Exterior'];
    let target: THREE.Object3D | undefined;
    for (const name of candidates) {
      const obj = scene.getObjectByName(name);
      if (obj) {
        target = obj;
        break;
      }
    }
    // Fallback: union bbox of every visible mesh NOT in the floor set
    // and NOT a wheel wrapper. Heavier but always something.
    let box: THREE.Box3;
    if (target) {
      box = new THREE.Box3().setFromObject(target);
    } else {
      box = new THREE.Box3();
      let collected = 0;
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!obj.visible) return;
        if (FLOOR_NODE_NAMES.has(obj.name)) return;
        if (obj.parent?.name?.startsWith('WheelWrapper_')) return;
        box.expandByObject(obj);
        collected++;
      });
      if (collected === 0) box.makeEmpty();
    }
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      setBbox({ size, center });
    } else if (triesRef.current > 240) {
      // 4 seconds of failure — give up so we don't poll forever.
      setBbox({ size: new THREE.Vector3(), center: new THREE.Vector3() });
    }
  });

  if (!bbox || bbox.size.length() === 0) return null;
  const { size, center } = bbox;
  return (
    <group position={center}>
      <mesh renderOrder={998}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial
          color="#ffffff"
          wireframe
          depthTest={false}
          transparent
          opacity={0.35}
        />
      </mesh>
      <Html distanceFactor={6} center position={[0, size.y / 2 + 0.15, 0]}>
        <div
          style={{
            background: 'rgba(0,0,0,0.78)',
            color: '#ffffff',
            padding: '3px 7px',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          body bbox
          <div style={{ fontSize: 9, opacity: 0.7 }}>
            X={size.x.toFixed(2)}m · Y={size.y.toFixed(2)}m · Z={size.z.toFixed(2)}m
          </div>
          <div style={{ fontSize: 8, opacity: 0.5 }}>
            (compare au Y r\u00e9el : 1.94 \u00d7 1.62 \u00d7 4.79 m)
          </div>
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// DebugAnchorOverlay — single gate that mounts (or unmounts) all geometry
// debug helpers in one shot based on the `anchors` debug flag. Reading
// the context HERE (instead of inside each marker sub-component) lets
// the entire subtree stay unmounted when the toggle is off — zero scene
// graph cost when the user isn't calibrating.
// ---------------------------------------------------------------------------
function DebugAnchorOverlay() {
  const debug = useContext(ShowroomDebugContext);
  if (!debug.anchors) return null;
  return (
    <>
      <ShowroomAnchorMarkers />
      <WheelMarkers />
      <BodyBoundingBoxWire />
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

async function probeAssetUrl(url: string): Promise<boolean> {
  const isUsable = (status: number, contentType: string): boolean =>
    (status === 200 || status === 206) &&
    !contentType.startsWith('text/') &&
    !contentType.includes('text/html');

  // Never cache probes — a stale 404 from before the file was added would
  // otherwise block the Supercharger forever until a hard refresh.
  const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  const headCt = head.headers.get('content-type') ?? '';
  if (isUsable(head.status, headCt)) return true;

  // Caddy / some proxies mishandle HEAD — fall back to a tiny ranged GET.
  const get = await fetch(url, {
    headers: { Range: 'bytes=0-15' },
    cache: 'no-store',
  });
  const getCt = get.headers.get('content-type') ?? '';
  return isUsable(get.status, getCt);
}

function useAssetAvailable(url: string): boolean | null {
  const [state, setState] = useState<{ url: string; available: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    probeAssetUrl(url)
      .then((ok) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        dbg3d(`[Poppyseed3D] probe ${url} → available=${ok}`);
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
  /** Canvas pixel height. Defaults to 360 (legacy VehicleTopView pane).
   *  The Home hero pushes this to 380/480 so the 3D car becomes the
   *  visual centrepiece. Width is always 100% of the parent. */
  height?: number;
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

export default function VehicleTopView3D({ vehicle, localOverrides, showroomMode, debugMode, height = 360 }: Props) {
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
  const wrapRotation = extras.wraps?.rotationDeg ?? 0;
  const wrapFinish = extras.wraps?.finish;
  // Destructure to scalar deps so useMemo doesn't rebuild when the
  // user re-saves an unrelated override (e.g. wheel offsets).
  const wrapBrightness = wrapFinish?.brightness;
  const wrapRoughness = wrapFinish?.roughness;
  const wrapMetalness = wrapFinish?.metalness;
  const wrapEnvMapIntensity = wrapFinish?.envMapIntensity;
  const wrapValue = useMemo<WrapContextValue>(() => {
    const finish: WrapFinishOverride | undefined =
      wrapBrightness !== undefined ||
      wrapRoughness !== undefined ||
      wrapMetalness !== undefined ||
      wrapEnvMapIntensity !== undefined
        ? {
            brightness: wrapBrightness,
            roughness: wrapRoughness,
            metalness: wrapMetalness,
            envMapIntensity: wrapEnvMapIntensity,
          }
        : undefined;
    if (wrapOverride) return { url: wrapOverride, rotationDeg: wrapRotation, finish };
    if (wrapExists && vehicle.carId) {
      return {
        url: wrapPngUrl(vehicle.carId, updatedAt ?? undefined),
        rotationDeg: wrapRotation,
        finish,
      };
    }
    return { url: null, rotationDeg: wrapRotation, finish };
  }, [
    wrapOverride,
    wrapRotation,
    wrapExists,
    vehicle.carId,
    updatedAt,
    wrapBrightness,
    wrapRoughness,
    wrapMetalness,
    wrapEnvMapIntensity,
  ]);

  return (
    <VehicleModelContext.Provider value={modelConfig}>
      <WrapUrlContext.Provider value={wrapValue}>
        <ShowroomDebugContext.Provider value={debugMode ?? DEFAULT_DEBUG_FLAGS}>
          <VehicleTopView3DInner vehicle={vehicle} showroomMode={!!showroomMode} height={height} />
        </ShowroomDebugContext.Provider>
      </WrapUrlContext.Provider>
    </VehicleModelContext.Provider>
  );
}

function VehicleTopView3DInner({ vehicle, showroomMode, height = 360 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const cfg = useActiveModel();
  const wheelsAvailable = useAssetAvailable(cfg.wheelUrl);
  const handleAvailable = useAssetAvailable(HANDLE_URL);
  const superchargerAvailable = useAssetAvailable(cfg.supercharger.modelUrl);
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

  // PR-4 mutations — lock/sentry/climate. Same endpoints as HomeQuickActions
  // so the two surfaces share optimistic patches and rollback semantics.
  // Lock + unlock are split into two endpoints (Tesla quirk: no
  // `access/lock-toggle`) so we keep them as two hooks and pick the
  // right one at click time based on the current `isLocked` state.
  const lockMut = useControlMutation(vehicleId, 'access/lock', {
    optimistic: vehiclePatch(carId, () => ({ isLocked: true })),
  });
  const unlockMut = useControlMutation(vehicleId, 'access/unlock', {
    optimistic: vehiclePatch(carId, () => ({ isLocked: false })),
  });
  const sentryMut = useControlMutation<{ on: boolean }>(vehicleId, 'access/sentry', {
    optimistic: vehiclePatch<{ on: boolean }>(carId, (_prev, body) => ({
      sentryMode: body.on,
    })),
  });
  // Climate uses two endpoints; the path string is picked from the live
  // `isClimateOn` snapshot at hook-build time. When that flips, the hook
  // rebuilds on the next render — mirrors ClimateCard / HomeQuickActions.
  const isClimateOn = vehicle.isClimateOn ?? false;
  const climateMut = useControlMutation(
    vehicleId,
    isClimateOn ? 'climate/stop' : 'climate/start',
    {
      optimistic: vehiclePatch(carId, () => ({ isClimateOn: !isClimateOn })),
    },
  );
  // PR-9 extras — defrost / flash / honk. Endpoints match HomeQuickActions
  // exactly so the two surfaces stay perfectly in sync.
  //  - defrost  = climate/precondition (Tesla "set_preconditioning_max")
  //  - flash    = access/flash-lights (one-shot)
  //  - honk     = access/honk-horn    (one-shot)
  // Defrost is the only one with persistent state worth optimistic patching:
  // we mirror HomeQuickActions' triple-write (defrostMode + front+rear
  // defroster) so the variant flag flips immediately and survives the
  // post-command 5s refresh.
  const defrostActive = (vehicle.defrostMode ?? 0) === 2;
  const defrostMut = useControlMutation<{ on: boolean }>(vehicleId, 'climate/precondition', {
    optimistic: vehiclePatch<{ on: boolean }>(carId, (_prev, body) => ({
      defrostMode: body.on ? 2 : 0,
      isFrontDefrosterOn: body.on,
      isRearDefrosterOn: body.on,
    })),
  });
  const flashMut = useControlMutation(vehicleId, 'access/flash-lights');
  const honkMut = useControlMutation(vehicleId, 'access/honk-horn');

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
    dbg3d('[VehicleTopView3D] callouts gating:', {
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
      // PR-4 — lock/sentry/climate. Same endpoint behaviour as
      // HomeQuickActions so the two surfaces stay perfectly in sync.
      lockVehicle: {
        onClick: () => lockMut.mutate(undefined as never),
        loading: lockMut.isPending,
      },
      unlockVehicle: {
        onClick: () => unlockMut.mutate(undefined as never),
        loading: unlockMut.isPending,
      },
      sentryToggle: {
        onClick: () => sentryMut.mutate({ on: !(vehicle.sentryMode ?? false) }),
        loading: sentryMut.isPending,
      },
      climateToggle: {
        onClick: () => climateMut.mutate(undefined as never),
        loading: climateMut.isPending,
      },
      // PR-9 extras — defrost / flash / honk.
      defrostToggle: {
        onClick: () => defrostMut.mutate({ on: !defrostActive }),
        loading: defrostMut.isPending,
      },
      flashLights: {
        onClick: () => flashMut.mutate(undefined as never),
        loading: flashMut.isPending,
      },
      honkHorn: {
        onClick: () => honkMut.mutate(undefined as never),
        loading: honkMut.isPending,
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
    lockMut.isPending,
    unlockMut.isPending,
    sentryMut.isPending,
    climateMut.isPending,
    defrostMut.isPending,
    flashMut.isPending,
    honkMut.isPending,
    defrostActive,
    vehicle.sentryMode,
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
      <div className="relative w-full" style={{ height }}>
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
                <>
                  {/* Try loading while the probe is in flight (null); skip only
                      after a confirmed 404 so a fresh Docker rebuild / volume
                      mount is picked up without a stale cached HEAD miss. */}
                  {superchargerAvailable !== false && <SuperchargerModelSafe />}
                  <LiveChargingCable mode={cableMode} handleAvailable={handleAvailable} />
                </>
              )}
              {/* Callouts mounted inside Canvas so they can read the scene
                  graph (anchor positions) via useThree.scene. They render
                  nothing when actions=null (Fleet API not ready). */}
              <VehicleCallouts
                vehicle={vehicle}
                actions={filteredActions}
                showroomPreview={showroomMode}
              />
              {/* Live charge info — anchored on the chargePort, only
                  while a session is active. Independent from the Fleet
                  API gating: even a user without virtual key paired
                  can still see kW / SOC / ETA while the car charges. */}
              {cableMode === 'charging' && !showroomMode && (
                <LiveChargeInfoCallout
                  info={{
                    powerKw: vehicle.chargerPower ?? null,
                    socPct: vehicle.batteryLevel ?? null,
                    targetSocPct: vehicle.chargeLimitSoc ?? null,
                    minutesRemaining:
                      vehicle.timeToFullCharge != null && vehicle.timeToFullCharge > 0
                        ? vehicle.timeToFullCharge * 60
                        : null,
                  } satisfies LiveChargeInfo}
                />
              )}
              {/* Phase 7 light effects: lock flash, brake/reverse lights,
                  sentry-mode camera pulses. Reads vehicle.* live state
                  and mutates scene nodes directly (no React props/state
                  churn). */}
              <VehicleLightEffects vehicle={vehicle} />
              {/* Visual debug helpers for the otherwise-invisible
                  geometry inputs (cableGroundAnchor, fallbackWorld,
                  plug socket, wheel positions, body bbox). Wrapped in
                  a debug-flag gate so the user can toggle the whole
                  set on/off from the Showroom UI without clutter when
                  not calibrating. Mounted ONLY in Showroom — Home/
                  cards stay completely clean. */}
              {showroomMode && <DebugAnchorOverlay />}
            </group>
          </Suspense>

          {/* Read MQTT/TeslaMate state → drive openings + cableMode. */}
          <VehicleStateSync vehicle={vehicle} onCableModeChange={setCableMode} />

          {/* Push camera/target/FOV from cfg into the live WebGL camera
              so Showroom sliders actually move the framing in realtime.
              Idempotent in normal viewer (cfg is stable). */}
          <CameraPoseSync activeMode={cableMode} />
          <CameraPoseCapture />

          <OrbitControls
            target={cfg.cameraPose.target}
            enablePan
            enableZoom
            minDistance={2.5}
            maxDistance={30}
            autoRotate={autoRotate}
            autoRotateSpeed={0.6}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 2.1}
            makeDefault
          />
        </Canvas>

        {/* Top-right overlay: floating action bar + auto-rotate toggle.
            The action bar mirrors the 3D callouts (Lock, Sentry,
            Climate, Frunk, Vent) but stays anchored to the viewport
            so it remains reachable regardless of zoom level / car
            size on screen — fixes the old static "SENTINELLE" badge
            that looked clickable but wasn't.
            Hidden in Showroom mode (Showroom has its own control
            surfaces in the right panel). */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {!showroomMode && filteredActions && (
            <TopRightActionBar vehicle={vehicle} actions={filteredActions} />
          )}
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

// ─────────────────────────────────────────────────────────────────────
// Top-right action bar — clickable, viewport-anchored shortcuts that
// duplicate the most-used 3D callouts (Lock, Sentry, Climate, Frunk,
// Vent). Always visible, regardless of zoom level — solves the case
// where the in-3D callouts shrink too small to tap when the car is
// rendered small on screen. Uses the SAME mutations as VehicleCallouts
// (filteredActions) so optimistic patches and toast feedback work
// identically.
// ─────────────────────────────────────────────────────────────────────

function TopRightActionBar({
  vehicle,
  actions,
}: {
  vehicle: VehicleStatus;
  actions: CalloutsActions;
}) {
  // PR-tweak 2026-05: user's preferred top-bar layout =
  //   Lock · Sentry · Presence · Climate · Defrost · Honk · Flash
  // Frunk + Vent dropped from the bar (still reachable as 3D callouts).
  // Presence is RENDERED here as a status indicator only — clicking it
  // is a no-op, but seeing "someone in the cabin" at a glance is what
  // the user wanted to keep from the legacy VehicleTopView pills now
  // that the SVG view is gone in 3D mode.
  //
  // Defrost has 3 logical states from Tesla:
  //   - off               (defrostMode = 0)
  //   - on but not max    (defrostMode = 1, rare)
  //   - max defrost on    (defrostMode = 2) ← what HomeQuickActions toggles
  // We only flip between OFF and MAX (mirrors HomeQuickActions exactly).
  const defrostActive = (vehicle.defrostMode ?? 0) === 2;
  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      {/* Lock — green when locked (good), red when unlocked (urgent). */}
      {vehicle.isLocked != null && (
        <TopRightActionButton
          title={vehicle.isLocked ? 'Verrouillée — toucher pour déverrouiller' : 'Déverrouillée — toucher pour verrouiller'}
          state={vehicle.isLocked ? 'secure' : 'danger'}
          onClick={
            vehicle.isLocked
              ? actions.unlockVehicle.onClick
              : actions.lockVehicle.onClick
          }
          loading={actions.lockVehicle.loading || actions.unlockVehicle.loading}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            {vehicle.isLocked
              ? <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              : <path d="M8 11V7a4 4 0 0 1 7-1" />}
          </svg>
        </TopRightActionButton>
      )}
      {/* Sentry — blue pulsing when ON, neutral when OFF. */}
      {vehicle.sentryMode != null && (
        <TopRightActionButton
          title={vehicle.sentryMode ? 'Sentinelle active — toucher pour désactiver' : 'Sentinelle inactive — toucher pour activer'}
          state={vehicle.sentryMode ? 'info' : 'neutral'}
          onClick={actions.sentryToggle.onClick}
          loading={actions.sentryToggle.loading}
          pulse={vehicle.sentryMode === true}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </TopRightActionButton>
      )}
      {/* Presence — read-only indicator. Green = someone in the cabin,
          neutral = empty / unknown. Tap does nothing on purpose. */}
      {vehicle.isUserPresent != null && (
        <TopRightActionButton
          title={vehicle.isUserPresent ? 'Conducteur à bord' : 'Cabine vide'}
          state={vehicle.isUserPresent ? 'secure' : 'neutral'}
          onClick={() => { /* read-only — presence isn't actionable */ }}
          loading={false}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="7" r="4" />
            <path d="M4 21c.5-5 4-7 8-7s7.5 2 8 7" />
          </svg>
        </TopRightActionButton>
      )}
      {/* Climate — green when active, neutral otherwise. */}
      {vehicle.isClimateOn != null && (
        <TopRightActionButton
          title={vehicle.isClimateOn ? 'Climatisation active — toucher pour arrêter' : 'Toucher pour démarrer la clim'}
          state={vehicle.isClimateOn ? 'secure' : 'neutral'}
          onClick={actions.climateToggle.onClick}
          loading={actions.climateToggle.loading}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18M5 7l14 10M5 17 19 7" />
            <path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2" />
          </svg>
        </TopRightActionButton>
      )}
      {/* Defrost — amber pulsing when MAX is engaged, neutral otherwise. */}
      <TopRightActionButton
        title={defrostActive ? 'Dégivrage max — toucher pour arrêter' : 'Toucher pour activer le dégivrage max'}
        state={defrostActive ? 'warning' : 'neutral'}
        onClick={actions.defrostToggle.onClick}
        loading={actions.defrostToggle.loading}
        pulse={defrostActive}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Tesla-style 3-arrow wavy defrost glyph */}
          <path d="M3 19h18" />
          <path d="M6 16c0-2 2-2 2-4s-2-2-2-4" />
          <path d="M12 16c0-2 2-2 2-4s-2-2-2-4" />
          <path d="M18 16c0-2 2-2 2-4s-2-2-2-4" />
        </svg>
      </TopRightActionButton>
      {/* Honk — one-shot, no persistent state. */}
      <TopRightActionButton
        title="Klaxonner"
        state="neutral"
        onClick={actions.honkHorn.onClick}
        loading={actions.honkHorn.loading}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10v4l5 1 7 4V5L8 9 3 10z" />
          <path d="M18 8a4 4 0 0 1 0 8" />
        </svg>
      </TopRightActionButton>
      {/* Flash — one-shot, no persistent state. */}
      <TopRightActionButton
        title="Appels de phares"
        state="neutral"
        onClick={actions.flashLights.onClick}
        loading={actions.flashLights.loading}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Headlight half-circle with beams */}
          <path d="M3 6h6a5 5 0 0 1 0 10H3z" />
          <path d="M14 8h2M14 12h3M14 16h2" />
        </svg>
      </TopRightActionButton>
    </div>
  );
}

type TopRightActionState = 'neutral' | 'secure' | 'danger' | 'info' | 'warning';

function TopRightActionButton({
  title,
  state,
  onClick,
  loading,
  pulse,
  children,
}: {
  title: string;
  state: TopRightActionState;
  onClick: () => void;
  loading: boolean;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  // Same colour vocabulary as `ControlButton.tsx` so the language is
  // consistent across the app — green = "secure / on", red = "danger",
  // blue = "info", amber = "warning / open", neutral grey otherwise.
  const stateClass =
    state === 'secure'
      ? 'bg-emerald-500/75 border-emerald-300/40 text-white hover:bg-emerald-500/90'
      : state === 'danger'
        ? 'bg-red-500/80 border-red-300/40 text-white hover:bg-red-500/95'
        : state === 'info'
          ? 'bg-blue-500/80 border-blue-300/40 text-white hover:bg-blue-500/95'
          : state === 'warning'
            ? 'bg-amber-500/85 border-amber-300/40 text-black hover:bg-amber-500/95'
            : 'bg-black/55 border-white/15 text-white/80 hover:text-white hover:bg-black/75';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={title}
      aria-label={title}
      className={
        // 7 buttons on mobile = tight squeeze. Bump back up on small+
        // (≥640px) where there's room. Same hit area as before on
        // desktop (32x32) but a touch tighter on phones.
        'w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full ' +
        'border backdrop-blur-md transition-all ' +
        'active:scale-95 disabled:opacity-50 ' +
        (pulse ? 'animate-pulse ' : '') +
        stateClass
      }
    >
      {children}
    </button>
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
// Listens for a custom DOM event dispatched from the Showroom camera
// section ("⟲ Vue courante" button) and replies with the current
// OrbitControls pose. Lets the user save the framing they orbited to
// without having to read the slider values back manually.
function CameraPoseCapture() {
  const { gl } = useThree();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target?: { toArray: () => [number, number, number] };
  } | null;

  useEffect(() => {
    const canvas = gl.domElement;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        onPose: (pose: {
          position: [number, number, number];
          target: [number, number, number];
          fov: number;
        }) => void;
      } | undefined;
      if (!detail?.onPose || !controls?.target) return;
      const pc = camera as THREE.PerspectiveCamera;
      detail.onPose({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: controls.target.toArray(),
        fov: pc.isPerspectiveCamera ? pc.fov : 45,
      });
    };
    canvas.addEventListener('teslahub:capture-camera-pose', handler);
    return () => canvas.removeEventListener('teslahub:capture-camera-pose', handler);
  }, [gl, camera, controls]);

  return null;
}

function CameraPoseSync({ activeMode }: { activeMode: CableMode }) {
  const cfg = useActiveModel();
  const idlePose = cfg.cameraPose;
  const chargingPose = cfg.chargingCameraPose;
  // Pose dictated by the current cable mode. Off → idle, anything else
  // → charging (when the model has one). The user can override via the
  // `teslahub:set-camera-pose` event below.
  const autoPose =
    activeMode !== 'off' && chargingPose ? chargingPose : idlePose;

  const { gl } = useThree();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target?: THREE.Vector3;
    update?: () => void;
    addEventListener?: (e: string, cb: () => void) => void;
    removeEventListener?: (e: string, cb: () => void) => void;
  } | null;

  // Optional override pose dispatched from the Showroom UI. While set,
  // it wins over the cable-mode pose; cleared automatically when the
  // user grabs the camera or when the cable mode changes.
  const [forcedPose, setForcedPose] = useState<typeof idlePose | null>(null);
  const pose = forcedPose ?? autoPose;

  // We only animate to the target pose for a short budget after the
  // pose changes — once the budget runs out (or the user starts
  // orbiting), we leave the camera alone so it can be moved freely.
  const animBudgetRef = useRef(0);
  const userActiveRef = useRef(false);

  // Reset the user-active flag and rearm the animation whenever the
  // target pose changes (cable mode switch or a forced pose request).
  useEffect(() => {
    animBudgetRef.current = 1.0;
    userActiveRef.current = false;
  }, [pose.position, pose.target, pose.fov]);

  // OrbitControls `start` event fires when the user grabs the camera
  // (mouse-down). From that moment we stop pulling toward the target.
  useEffect(() => {
    if (!controls?.addEventListener) return;
    const onStart = () => {
      userActiveRef.current = true;
      animBudgetRef.current = 0;
    };
    controls.addEventListener('start', onStart);
    return () => controls.removeEventListener?.('start', onStart);
  }, [controls]);

  // External "set camera pose" requests (Showroom preview buttons).
  // Each event always wins: even if the new pose is identical to the
  // current one, we force the anim budget back up and clear the
  // user-active flag so the next frames will (re)apply it. Without
  // that, clicking "Aller à la vue de charge" right after a 📸 capture
  // would do nothing because the camera was already there AND a prior
  // orbit might still hold the lock.
  useEffect(() => {
    const canvas = gl.domElement;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        pose?: typeof idlePose | null;
      } | undefined;
      setForcedPose(detail?.pose ?? null);
      animBudgetRef.current = 1.0;
      userActiveRef.current = false;
    };
    canvas.addEventListener('teslahub:set-camera-pose', handler);
    return () => canvas.removeEventListener('teslahub:set-camera-pose', handler);
  }, [gl]);

  // Clear forcedPose when the cable mode changes — the natural cable-
  // mode-driven pose takes over again.
  useEffect(() => {
    setForcedPose(null);
  }, [activeMode]);

  const targetPos = useMemo(() => new THREE.Vector3(...pose.position), [pose.position]);
  const targetTgt = useMemo(() => new THREE.Vector3(...pose.target), [pose.target]);

  useFrame((_, dt) => {
    if (userActiveRef.current || animBudgetRef.current <= 0) return;
    animBudgetRef.current -= dt;
    const k = Math.min(1, dt * 4);
    camera.position.lerp(targetPos, k);
    if (controls?.target && controls.update) {
      const t = controls.target as THREE.Vector3;
      t.lerp(targetTgt, k);
      controls.update();
    }
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera && Math.abs(pc.fov - pose.fov) > 0.05) {
      pc.fov = THREE.MathUtils.damp(pc.fov, pose.fov, 4, dt);
      pc.updateProjectionMatrix();
    }
  });

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
// NOTE: do NOT `useGLTF.preload` the supercharger here. Optional assets
// served from a bind-mounted volume may legitimately 404 on first page
// load (e.g. file dropped in /srv/models AFTER the app opened). drei's
// suspend-react cache stores the rejected promise and `useGLTF` then
// keeps returning the cached failure even after the file becomes
// available. Loading lazily on first render keeps the cache clean.
