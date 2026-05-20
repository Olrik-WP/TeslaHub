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
  /** Pulsing speed of the flow when charging. */
  flowSpeed?: number;
}

// Tesla-app colors (eye-balled from screenshots):
//   * Idle  : neutral cool grey, faint pulse barely visible.
//   * Active: vivid charging green, strong pulse.
const IDLE_COLOR = new THREE.Color('#6c7480');
const CHARGE_COLOR = new THREE.Color('#39d96a');

// Flowing-gradient shader applied to the cable tube. UV.y goes 0 -> 1 along
// the curve length, so we scroll a smooth bright band along it.
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

  void main() {
    // Two thin bright bands traveling along the cable.
    float band = fract(vUv.y * 3.0 - uTime * uFlowSpeed);
    float pulse = smoothstep(0.0, 0.45, band) * smoothstep(1.0, 0.55, band);

    // Base shading: slight rim darkening for cylinder feel.
    float rim = pow(1.0 - abs(vUv.x * 2.0 - 1.0), 0.6);
    vec3 base = uBaseColor * mix(0.55, 1.0, rim);

    // Charging: add bright emissive bands on top.
    vec3 col = base + uBaseColor * pulse * uIntensity * 2.5;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function buildCableCurve(start: THREE.Vector3, end: THREE.Vector3): THREE.CubicBezierCurve3 {
  // CubicBezier control points are TANGENT handles, not points the curve
  // passes through. We want:
  //   * Start tangent pointing straight UP   (cable rises from the floor)
  //   * End tangent pointing AWAY from the car along the horizontal axis
  //     between port and start (cable enters the port horizontally instead
  //     of dropping in from above).
  //
  // This avoids the "loop over the roof" shape that a CatmullRomCurve3
  // produces when both endpoints are at similar height.
  const totalDist = start.distanceTo(end);
  const liftHeight = Math.max(0.30, totalDist * 0.40);
  const horizontalHandle = Math.max(0.25, totalDist * 0.35);

  // Direction "from car back to ground anchor", projected to the horizontal
  // plane. Used to push the end handle out so the cable arrives flat.
  const fromPortToStart = new THREE.Vector3(start.x - end.x, 0, start.z - end.z);
  if (fromPortToStart.lengthSq() < 1e-6) {
    // Degenerate case (start directly below end): pick an arbitrary X
    // direction so the handle isn't a zero vector.
    fromPortToStart.set(-1, 0, 0);
  }
  fromPortToStart.normalize();

  const p0 = start.clone();
  const p1 = start.clone().add(new THREE.Vector3(0, liftHeight, 0));
  const p2 = end.clone().add(fromPortToStart.multiplyScalar(horizontalHandle));
  const p3 = end.clone();

  return new THREE.CubicBezierCurve3(p0, p1, p2, p3);
}

// Real Tesla Charger_Handle is ~21cm long along its native +Z axis.
// We split the trip from the floor to the port into two parts:
//   * Cable spline goes from start → BACK of the plug (port - 21cm)
//   * Handle mesh fills the last 21cm, plug tip touching the port
// This way the geometry is continuous (no gap between cable and plug),
// and the plug doesn't penetrate the car body.
const HANDLE_LENGTH = 0.21;

export function ChargingCable({
  startWorld,
  endWorld,
  charging,
  handleUrl,
  radius = 0.012,
  radialSegments = 12,
  tubularSegments = 48,
  flowSpeed = 0.7,
}: ChargingCableProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Horizontal direction from ground anchor to port. Used both to shorten
  // the cable (so it ends at the back of the plug) and to orient the
  // handle so its +Z axis points straight at the port.
  const approachDir = useMemo(() => {
    const d = new THREE.Vector3(endWorld.x - startWorld.x, 0, endWorld.z - startWorld.z);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    return d.normalize();
  }, [startWorld, endWorld]);

  const cableEndWorld = useMemo(
    () => endWorld.clone().addScaledVector(approachDir, -HANDLE_LENGTH),
    [endWorld, approachDir],
  );

  const curve = useMemo(
    () => buildCableCurve(startWorld, cableEndWorld),
    [startWorld, cableEndWorld],
  );

  const geometry = useMemo(
    () => new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false),
    [curve, tubularSegments, radius, radialSegments],
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
  //   * Position : midway between the cable end and the port (so the handle
  //     spans those exact 21cm with the plug touching the port).
  //   * Orientation : explicit basis matrix with +Z = approachDir (forward)
  //     and +Y = world up. setFromUnitVectors() only constrains one axis
  //     and leaves a roll degree of freedom, which made the handle look
  //     sideways. The basis matrix removes that ambiguity.
  const handleTransform = useMemo(() => {
    const position = cableEndWorld
      .clone()
      .addScaledVector(approachDir, HANDLE_LENGTH / 2);

    const forward = approachDir.clone(); // +Z of the mesh
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, forward);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);

    return { position, quaternion };
  }, [cableEndWorld, approachDir]);

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
