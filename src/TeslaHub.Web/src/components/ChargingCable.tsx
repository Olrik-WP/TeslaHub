import { useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three-stdlib';
import * as THREE from 'three';

// =============================================================================
// <ChargingCable />
// =============================================================================
//
// Procedural live charging cable, mimicking the look of the Tesla mobile app
// vehicle view: a thin cable rising from the ground up to the car's charge
// port, with a flowing color (green when charging, neutral grey otherwise).
//
// Why procedural vs. a static .glb mesh?
//   * Tesla itself composes this cable at runtime - there is no ready-to-use
//     asset in their APK (we checked: `.obj-*.mesh` files contain only the
//     individual parts, no pre-assembled cable scene).
//   * Each Tesla vehicle has its charge port in a different location (Model 3
//     rear-left, Model S rear-left taillight, Cybertruck mid-rear, etc.).
//     A procedural cable adapts automatically to any anchor position.
//   * Color/intensity become a single shader uniform - no texture swap.
//
// Three.js anatomy:
//   * Cable        : THREE.TubeGeometry along a CatmullRomCurve3 between the
//                    floor anchor and the charge port. Sleeve material is a
//                    custom ShaderMaterial doing a flowing emissive gradient
//                    along the V axis when charging=true.
//   * Plug (handle): Real Tesla mesh extracted from the APK as charger_handle.glb,
//                    positioned at the curve's end and rotated along its tangent.
//                    Renders as plain PBR (no shader override).
//
// Usage (typical Phase 2 wiring):
//
//   <ChargingCable
//     // start point: ground level, ~50cm behind the rear-left tire
//     startWorld={new THREE.Vector3(-1.5, 0, -0.9)}
//     // end point: read once from the vehicle's <Chargeport_Spatial> world matrix
//     endWorld={chargePortWorldPosition}
//     charging={vehicle.chargingState === 'Charging'}
//     handleUrl="/models/charger_handle.glb"   // optional
//   />
//
// The component is currently NOT mounted in <VehicleTopView3D /> by default.
// It will be enabled in Phase 2 once we wire vehicle.chargingState and read
// the chargeport anchor world-position from the Poppyseed model. See
// docs/3d-viewer-spec.md section "Charging cable (procedural)".
// =============================================================================

export interface ChargingCableProps {
  /** World position where the cable rises from the floor. */
  startWorld: THREE.Vector3;
  /** World position of the charge port socket on the car. */
  endWorld: THREE.Vector3;
  /** Optional ground waypoint — when provided the curve is a single
   *  continuous tube that touches the ground at this point before
   *  rising to the car. Used to chain a Supercharger post → ground
   *  drape → car port without visible junction. */
  viaWorld?: THREE.Vector3;
  /**
   * Unit vector pointing FROM the plug INTO the port (i.e. perpendicular to
   * the car's body where the port sits). For a Model 3 / Model Y the port
   * is on the rear-LEFT fender, so this defaults to (0, 0, +1) in world
   * space — assuming the car is at its default rotation. Phase 2 will read
   * this from the per-model config (Cybertruck plug points differently).
   */
  plugDirection?: THREE.Vector3;
  /** True when the car is actively charging - drives color + flow intensity. */
  charging: boolean;
  /** Optional path to charger_handle.glb (extracted via export_meshes.gd). */
  handleUrl?: string;
  /** Cable tube radius in meters. Tesla cable ≈ 12mm. */
  radius?: number;
  /** Number of radial segments around the tube (8 = cheap, 16 = smooth). */
  radialSegments?: number;
  /** Number of segments along the tube length (32 = smooth curve). */
  tubularSegments?: number;
  /** Speed of the electrical flow when charging. The three traveling
   *  pulses complete one full pass of the cable every `1/flowSpeed`
   *  seconds — so `1.0` makes a pulse arrive at the car port every
   *  ~0.33 s, which reads as "active fast-charging" without feeling
   *  frantic. */
  flowSpeed?: number;
  /** Slack multiplier for the FIRST segment (start → via). 1.0 = default
   *  drape, &lt;1 = taut/short cable, &gt;1 = more slack. Only used when
   *  `viaWorld` is set. */
  slackStart?: number;
  /** Slack multiplier for the SECOND segment (via → end). Same scale as
   *  `slackStart`. When `viaWorld` is absent, applied to the single
   *  segment instead so the slider also tightens the standalone curve. */
  slackEnd?: number;
}

const DEFAULT_PLUG_DIRECTION = new THREE.Vector3(0, 0, 1);

// Tesla-app colors (eye-balled from screenshots):
//   * Idle  : neutral cool grey, faint pulse barely visible.
//   * Active: vivid charging green, strong pulse.
const IDLE_COLOR = new THREE.Color('#6c7480');
const CHARGE_COLOR = new THREE.Color('#39d96a');

// Flowing-energy shader applied to the cable tube. UV.v goes 0 → 1 along
// the curve length (start → end). Three narrow Gaussian pulses race down
// the V axis at evenly spaced phases, giving a clear "current flows from
// the Supercharger toward the car" reading at a glance.
const CABLE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CABLE_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFlowSpeed;
  uniform vec3  uBaseColor;

  // IMPORTANT: in three.js TubeGeometry, UV.x runs ALONG the length of
  // the tube (0 = start = SC port, 1 = end = car port), and UV.y runs
  // AROUND the radius. So flow direction lives on vUv.x.

  // Narrow Gaussian centred on \`centre\` along a periodic [0,1] axis.
  // \`tightness\` controls the pulse width — bigger = sharper band.
  float pulseAt(float u, float centre, float tightness) {
    float d = u - centre;
    // Wrap d into [-0.5, 0.5] so the pulse crossing the u=1↔0 seam stays
    // continuous (no dark spot).
    d -= floor(d + 0.5);
    return exp(-d * d * tightness);
  }

  void main() {
    float u = vUv.x;
    float t = uTime * uFlowSpeed;

    // Three thin pulses chasing each other from u=0 (SC) → u=1 (car port).
    // Tightness 220 ≈ pulse width ~5% of the cable length.
    float p1 = pulseAt(u, fract(t),         220.0);
    float p2 = pulseAt(u, fract(t + 0.333), 220.0);
    float p3 = pulseAt(u, fract(t + 0.667), 220.0);
    float pulse = p1 + p2 + p3;

    // Cylinder rim darkening — vUv.y goes 0..1 around the tube.
    float rim = pow(1.0 - abs(vUv.y * 2.0 - 1.0), 0.6);

    // Permanent baseline glow — soft when idle, brighter when charging.
    float baseGlow = mix(0.35, 0.75, uIntensity);
    vec3 base = uBaseColor * mix(0.55, 1.1, rim) * baseGlow;

    // Hot saturated bands traveling along the length.
    vec3 hot = uBaseColor * pulse * uIntensity * 3.4;
    // White-hot core for the "electric arc" feel.
    vec3 core = vec3(1.0, 1.0, 0.92) * pulse * uIntensity * 0.6;

    gl_FragColor = vec4(base + hot + core, 1.0);
  }
`;

/**
 * Three-point cable curve: start → via (ground drape) → end (car port).
 *
 * Built as a CurvePath of two cubic Beziers sharing a TANGENT at `via`,
 * which produces a single continuous tube with no visible junction —
 * unlike rendering two independent ChargingCable instances which always
 * "kink" because each segment computes its own tangent.
 */
function buildViaCableCurve(
  start: THREE.Vector3,
  via: THREE.Vector3,
  end: THREE.Vector3,
  plugDir: THREE.Vector3,
  slackStart: number,
  slackEnd: number,
): THREE.Curve<THREE.Vector3> {
  // Shared tangent at the ground point: horizontal direction toward the car
  // port. Both segments leave the junction along this vector, so the tube
  // has G1 continuity (no visible break in slope).
  const tangent = new THREE.Vector3(end.x - via.x, 0, end.z - via.z);
  if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
  tangent.normalize();

  const dist1 = start.distanceTo(via);
  const dist2 = via.distanceTo(end);

  // Segment 1: SC port → ground via.
  //   - p1 leaves the SC head pointing down + forward (cable falls naturally)
  //   - p2 approaches the ground OPPOSITE to `tangent` so the curve arrives
  //     tangent to it at `via`.
  const downForward = tangent.clone().multiplyScalar(0.3 * dist1 * slackStart).add(
    new THREE.Vector3(0, -Math.min(0.4, start.y * 0.4) * slackStart, 0),
  );
  const seg1P1 = start.clone().add(downForward);
  const seg1P2 = via.clone().addScaledVector(
    tangent,
    -Math.max(0.3, dist1 * 0.35) * slackStart,
  );
  const seg1 = new THREE.CubicBezierCurve3(
    start.clone(),
    seg1P1,
    seg1P2,
    via.clone(),
  );

  // Segment 2: ground via → car port.
  //   - p1 leaves the ground along `tangent` (same direction as seg1 arrived)
  //     so the slope is continuous through the junction.
  //   - p2 aligns the curve with `plugDir` at the port end (same logic as
  //     the legacy two-point curve).
  const seg2P1 = via.clone().addScaledVector(
    tangent,
    Math.max(0.3, dist2 * 0.35) * slackEnd,
  );
  const seg2P2 = end.clone().addScaledVector(
    plugDir,
    -Math.max(0.4, dist2 * 0.45) * slackEnd,
  );
  const seg2 = new THREE.CubicBezierCurve3(via.clone(), seg2P1, seg2P2, end.clone());

  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(seg1);
  path.add(seg2);
  return path;
}

function buildCableCurve(
  start: THREE.Vector3,
  end: THREE.Vector3,
  plugDir: THREE.Vector3,
  slack: number,
): THREE.CubicBezierCurve3 {
  // CubicBezier control points are TANGENT handles, not waypoints.
  //
  // Start tangent: HORIZONTAL towards the port. This makes the cable lay
  // flat on the floor for a brief stretch, mimicking the Tesla app where
  // the cable "drapes" on the ground for ~30-50cm before rising.
  //
  // End tangent: pointing OUT of the port along -plugDir. The cable arrives
  // already aligned with the plug socket, so the rigid handle continues
  // seamlessly through to the port.
  const totalDist = start.distanceTo(end);

  // Horizontal direction from start to end (cable approach in plan view).
  const horizontalToEnd = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
  if (horizontalToEnd.lengthSq() < 1e-6) horizontalToEnd.set(1, 0, 0);
  horizontalToEnd.normalize();

  // p1 sits FAR out horizontally (60% of the way) and well below ground
  // (-25cm). This pulls the curve down hard so the first half of the cable
  // actually drapes on the floor, mimicking the Tesla app vehicle view
  // where the cable looks "thrown on the ground" before rising to the port.
  // The Y < 0 trick works because the curve is a Bezier - it doesn't have
  // to pass through p1, just be pulled toward it. The actual minimum Y of
  // the curve stays around 0 (floor level).
  const p1 = start
    .clone()
    .addScaledVector(horizontalToEnd, totalDist * 0.60 * slack)
    .add(new THREE.Vector3(0, -0.25 * slack, 0));

  // p2 is pushed AWAY from the port along the plug direction so that the
  // curve's final tangent aligns with plugDir. This is what makes the cable
  // arrive perpendicular to the car body instead of from a random angle.
  const p2 = end
    .clone()
    .addScaledVector(plugDir, -Math.max(0.4, totalDist * 0.45) * slack);

  return new THREE.CubicBezierCurve3(start.clone(), p1, p2, end.clone());
}

// Real Tesla Charger_Handle is ~21cm long along its native +Z axis.
// We split the trip from the floor to the port into two parts:
//   * Cable spline goes from start → BACK of the plug (port - 21cm)
//   * Handle mesh fills the last 21cm, plug tip touching the port
// This way the geometry is continuous (no gap between cable and plug),
// and the plug doesn't penetrate the car body.
const HANDLE_LENGTH = 0.21;

// The handle mesh's actual back face isn't exactly at its bbox extreme
// (Tesla left a few mm of empty space). To hide the resulting micro-gap
// between the tube end and the plug back, we extend the cable 2cm INTO
// the handle so they always visually overlap.
const CABLE_HANDLE_OVERLAP = 0.02;

export function ChargingCable({
  startWorld,
  endWorld,
  viaWorld,
  plugDirection = DEFAULT_PLUG_DIRECTION,
  charging,
  handleUrl,
  radius = 0.012,
  radialSegments = 12,
  tubularSegments = 48,
  flowSpeed = 1.0,
  slackStart = 1,
  slackEnd = 1,
}: ChargingCableProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Plug direction (perpendicular to the car's body where the port sits).
  // The handle is oriented strictly along this axis - independently of
  // where the cable is coming from - so it always looks "straight into
  // the port", never tilted along the cable's approach angle.
  const plugDir = useMemo(() => plugDirection.clone().normalize(), [plugDirection]);

  // The cable physically ends 2cm INSIDE the handle so there's a small
  // overlap that hides any micro-gap due to the mesh's back-face position.
  const cableEndWorld = useMemo(
    () => endWorld.clone().addScaledVector(plugDir, -(HANDLE_LENGTH - CABLE_HANDLE_OVERLAP)),
    [endWorld, plugDir],
  );

  const curve = useMemo(
    () =>
      viaWorld
        ? buildViaCableCurve(
            startWorld,
            viaWorld,
            cableEndWorld,
            plugDir,
            slackStart,
            slackEnd,
          )
        : buildCableCurve(startWorld, cableEndWorld, plugDir, slackEnd),
    [startWorld, viaWorld, cableEndWorld, plugDir, slackStart, slackEnd],
  );

  // When a waypoint is present the tube is longer (two bezier segments) so
  // bump the tessellation up to keep it smooth.
  const effectiveTubular = viaWorld ? tubularSegments * 2 : tubularSegments;

  const geometry = useMemo(
    () => new THREE.TubeGeometry(curve, effectiveTubular, radius, radialSegments, false),
    [curve, effectiveTubular, radius, radialSegments],
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: charging ? 1 : 0.05 },
      uFlowSpeed: { value: flowSpeed },
      uBaseColor: { value: charging ? CHARGE_COLOR.clone() : IDLE_COLOR.clone() },
    }),
    [],
  );

  // Smoothly interpolate color + intensity when charging state changes (avoid
  // a jarring flash when the user starts/stops charging mid-view).
  useFrame((_, dt) => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.uTime.value += dt;

    const targetIntensity = charging ? 1 : 0.05;
    u.uIntensity.value = THREE.MathUtils.damp(
      u.uIntensity.value,
      targetIntensity,
      4,
      dt,
    );

    const targetColor = charging ? CHARGE_COLOR : IDLE_COLOR;
    (u.uBaseColor.value as THREE.Color).lerp(targetColor, Math.min(1, dt * 4));
  });

  // Handle transform:
  //   * Position : midway between cableEnd and port along plugDir (so the
  //     handle spans those exact 21cm with the plug touching the port).
  //   * Orientation : explicit basis matrix with +Z = plugDir (forward into
  //     port) and +Y = world up. Using plugDir instead of the cable's
  //     tangent guarantees the handle is perpendicular to the car body,
  //     even when the cable approaches from a diagonal angle.
  const handleTransform = useMemo(() => {
    const position = endWorld.clone().addScaledVector(plugDir, -HANDLE_LENGTH / 2);

    const forward = plugDir.clone(); // +Z of the mesh aims at the port
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, forward);
    if (right.lengthSq() < 1e-6) {
      // Degenerate: plug points straight up/down. Pick an arbitrary right
      // axis to avoid NaN quaternion.
      right.set(1, 0, 0);
    }
    right.normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, forward);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);

    return { position, quaternion };
  }, [endWorld, plugDir]);

  return (
    <group>
      <mesh geometry={geometry}>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={CABLE_VERTEX_SHADER}
          fragmentShader={CABLE_FRAGMENT_SHADER}
          transparent={false}
        />
      </mesh>

      {handleUrl ? (
        <ChargingHandle
          url={handleUrl}
          position={handleTransform.position}
          quaternion={handleTransform.quaternion}
        />
      ) : null}
    </group>
  );
}

// Separate component so the GLTFLoader hook can suspend without breaking the
// cable rendering when handleUrl is undefined.
function ChargingHandle({
  url,
  position,
  quaternion,
}: {
  url: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}) {
  const gltf = useLoader(GLTFLoader, url);

  // Tesla's Charger_Handle mesh ships with an internal pivot offset (the
  // geometry sits around (0, +0.83, +0.66) in local space, not at origin).
  // Without recentering, attaching the scene to a world position drops the
  // mesh ~83cm above and 66cm forward of where we asked. We sub the AABB
  // center from the mesh once, then wrap in a group so the outer position /
  // quaternion props can safely overwrite the group's transform every render
  // without losing the recentering offset.
  const centered = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const center = box.getCenter(new THREE.Vector3());
    cloned.position.sub(center);
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [gltf.scene]);

  return (
    <group position={position} quaternion={quaternion}>
      <primitive object={centered} />
    </group>
  );
}
