import * as THREE from 'three';
import type { VehicleModelConfig } from './vehicleModelConfig';

/** World position of the Supercharger cable connector. */
export function superchargerCablePortWorld(
  sc: VehicleModelConfig['supercharger'],
): THREE.Vector3 {
  const rotY = THREE.MathUtils.degToRad(sc.rotationY);
  const offset = new THREE.Vector3(...sc.cablePortOffset);
  offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  return new THREE.Vector3(...sc.position).add(offset);
}

/** Horizontal unit vector from the SC port toward the ground anchor. */
export function superchargerToGroundPlugDirection(
  scPort: THREE.Vector3,
  groundAnchor: THREE.Vector3,
): THREE.Vector3 {
  const dir = groundAnchor.clone().sub(scPort);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  return dir.normalize();
}

/** Horizontal unit vector from the ground anchor toward the car port. */
export function groundToCarPlugDirection(
  groundAnchor: THREE.Vector3,
  carPort: THREE.Vector3,
): THREE.Vector3 {
  const dir = carPort.clone().sub(groundAnchor);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  return dir.normalize();
}
