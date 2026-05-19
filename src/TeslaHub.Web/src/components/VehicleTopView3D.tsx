import { Suspense, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  useGLTF,
  OrbitControls,
  Bounds,
  Environment,
  ContactShadows,
  Html,
} from '@react-three/drei';
import type { VehicleStatus } from '../api/queries';

const MODEL_URL = '/models/poppyseed.glb';

function PoppyseedModel() {
  const { scene } = useGLTF(MODEL_URL);
  return <primitive object={scene} />;
}

function Loader() {
  return (
    <Html center>
      <div className="text-[#9ca3af] text-xs">Loading 3D model...</div>
    </Html>
  );
}

interface Props {
  vehicle: VehicleStatus;
}

export default function VehicleTopView3D({ vehicle: _vehicle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null!);

  return (
    <div className="relative w-full" style={{ height: 360 }}>
      <Canvas
        ref={canvasRef}
        camera={{ position: [10, 6, 14], fov: 30 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[10, 15, 10]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-8, 6, -8]} intensity={0.4} />

        <Suspense fallback={<Loader />}>
          <Environment preset="city" />
          <Bounds fit clip observe margin={1.3}>
            <PoppyseedModel />
          </Bounds>
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.45}
            scale={20}
            blur={2.4}
            far={5}
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
