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

function buildCableCurve(start: THREE.Vector3, end: THREE.Vector3): THREE.CatmullRomCurve3 {
  // Bezier-ish 4-point spline: rises straight up from the floor, then curves
  // gracefully over to the charge port. The two intermediate control points
  // are placed at 35% / 70% of the way to give the typical Tesla "S" shape
  // visible in the in-app vehicle view.
  const totalDist = start.distanceTo(end);
  const liftHeight = Math.max(0.35, totalDist * 0.45);

  const p0 = start.clone();
  const p1 = start.clone().add(new THREE.Vector3(0, liftHeight, 0));
  const p2 = end.clone().add(new THREE.Vector3(0, liftHeight * 0.5, 0));
  const p3 = end.clone();

  return new THREE.CatmullRomCurve3([p0, p1, p2, p3], false, 'catmullrom', 0.5);
}

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

  const curve = useMemo(
    () => buildCableCurve(startWorld, endWorld),
    [startWorld, endWorld],
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

  // Compute the handle transform from the curve's endpoint + tangent.
  const handleTransform = useMemo(() => {
    const t = 1;
    const position = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    // Make the handle face along the tangent (Z-forward by glTF convention).
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      tangent,
    );
    return { position, quaternion };
  }, [curve]);

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
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={scene} position={position} quaternion={quaternion} />;
}
