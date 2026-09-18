import { memo, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { storySections, type SceneId } from '../data/landingData';

interface OrbSceneProps {
  scene: SceneId;
  sceneProgress: number;
  scrollProgress: number;
  reducedMotion: boolean;
}

const sceneTargets: Record<SceneId, { x: number; y: number; scale: number; energy: number; color: string; accent: string; speed: number }> = {
  hero: { x: 0, y: 0, scale: 1, energy: 0.9, color: '#67e8f9', accent: '#2563eb', speed: 0.18 },
  os: { x: 1, y: 0, scale: 0.86, energy: 0.76, color: '#93c5fd', accent: '#22d3ee', speed: 0.15 },
  voice: { x: -1, y: 0.12, scale: 0.94, energy: 1.22, color: '#5eead4', accent: '#38bdf8', speed: 0.28 },
  capabilities: { x: 1, y: 0, scale: 0.8, energy: 1, color: '#bae6fd', accent: '#2563eb', speed: 0.21 },
  memory: { x: -1, y: 0.1, scale: 0.88, energy: 1.08, color: '#c4b5fd', accent: '#22d3ee', speed: 0.17 },
  action: { x: 1, y: -0.1, scale: 0.84, energy: 0.94, color: '#e0f2fe', accent: '#0ea5e9', speed: 0.2 },
  crypto: { x: -1, y: 0, scale: 0.84, energy: 1.16, color: '#7dd3fc', accent: '#14b8a6', speed: 0.24 },
  personas: { x: 1, y: 0.05, scale: 0.88, energy: 0.95, color: '#f8fafc', accent: '#38bdf8', speed: 0.19 },
  trust: { x: -1, y: 0, scale: 0.8, energy: 0.66, color: '#dbeafe', accent: '#67e8f9', speed: 0.1 },
  finale: { x: 0, y: 0, scale: 1.08, energy: 1.3, color: '#e0f2fe', accent: '#67e8f9', speed: 0.24 },
};

const sceneOrder = storySections.map((section) => section.id);

function interpolateScene(progress: number) {
  const lower = Math.min(Math.floor(progress), sceneOrder.length - 1);
  const upper = Math.min(lower + 1, sceneOrder.length - 1);
  const raw = Math.max(0, Math.min(1, progress - lower));
  const blend = raw * raw * (3 - 2 * raw);
  const from = sceneTargets[sceneOrder[lower]];
  const to = sceneTargets[sceneOrder[upper]];
  return {
    x: THREE.MathUtils.lerp(from.x, to.x, blend),
    y: THREE.MathUtils.lerp(from.y, to.y, blend),
    scale: THREE.MathUtils.lerp(from.scale, to.scale, blend),
    energy: THREE.MathUtils.lerp(from.energy, to.energy, blend),
    speed: THREE.MathUtils.lerp(from.speed, to.speed, blend),
    color: new THREE.Color(from.color).lerp(new THREE.Color(to.color), blend),
    accent: new THREE.Color(from.accent).lerp(new THREE.Color(to.accent), blend),
  };
}

function createSphereParticles(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorA = new THREE.Color('#67e8f9');
  const colorB = new THREE.Color('#2563eb');

  for (let i = 0; i < count; i += 1) {
    const radius = 1.15 + Math.random() * 1.1;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);

    const mixed = colorA.clone().lerp(colorB, Math.random());
    colors[i * 3] = mixed.r;
    colors[i * 3 + 1] = mixed.g;
    colors[i * 3 + 2] = mixed.b;
  }

  return { positions, colors };
}

function createTunnelParticles(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const cyan = new THREE.Color('#67e8f9');
  const blue = new THREE.Color('#2563eb');
  const white = new THREE.Color('#e0f2fe');

  for (let i = 0; i < count; i += 1) {
    const z = -Math.random() * 80 + 2;
    const angle = Math.random() * Math.PI * 2;
    const lane = Math.floor(Math.random() * 14);
    const radius = 5 + lane * 0.8 + Math.random() * 2.8;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius * 0.68;
    positions[i * 3 + 2] = z;
    const c = Math.random() > 0.82 ? white : cyan.clone().lerp(blue, Math.random());
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    phases[i] = Math.random() * Math.PI * 2;
  }

  return { positions, colors, phases };
}

function createConstellationLines(count: number) {
  const positions = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i += 1) {
    const z = -Math.random() * 80 + 2;
    const a = Math.random() * Math.PI * 2;
    const radius = 6 + Math.random() * 9;
    const len = 0.6 + Math.random() * 1.8;
    positions[i * 6] = Math.cos(a) * radius;
    positions[i * 6 + 1] = Math.sin(a) * radius * 0.65;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = Math.cos(a + 0.08) * (radius + len);
    positions[i * 6 + 4] = Math.sin(a + 0.08) * (radius + len) * 0.65;
    positions[i * 6 + 5] = z - Math.random() * 10;
  }
  return positions;
}

function NeuralField({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const lines = useMemo(() => {
    return Array.from({ length: 34 }, (_, index) => {
      const start = Math.random() * Math.PI * 2;
      const radius = 1.35 + Math.random() * 1.45;
      const z = (Math.random() - 0.5) * 1.1;
      const points = Array.from({ length: 4 }, (_unused, segment) => {
        const angle = start + segment * (0.12 + Math.random() * 0.18);
        const localRadius = radius + Math.sin(segment) * 0.15;
        return new THREE.Vector3(Math.cos(angle) * localRadius, Math.sin(angle) * localRadius * 0.82, z + segment * 0.05);
      });
      return {
        geometry: new THREE.BufferGeometry().setFromPoints(points),
        color: index % 3 === 0 ? '#e0f2fe' : '#67e8f9',
        opacity: 0.18 + Math.random() * 0.2,
      };
    });
  }, []);

  useFrame((_, delta) => {
    if (!ref.current || reducedMotion) return;
    ref.current.rotation.z += delta * 0.045;
    ref.current.rotation.y -= delta * 0.025;
  });

  return (
    <group ref={ref}>
      {lines.map((line, index) => (
        <line key={index}>
          <primitive object={line.geometry} attach="geometry" />
          <lineBasicMaterial color={line.color} transparent opacity={line.opacity} blending={THREE.AdditiveBlending} />
        </line>
      ))}
    </group>
  );
}

function TunnelField({ scene, scrollProgress, reducedMotion }: OrbSceneProps) {
  const target = sceneTargets[scene];
  const tunnelRef = useRef<THREE.Points>(null);
  const lineRef = useRef<THREE.LineSegments>(null);
  const tunnelCount = typeof window !== 'undefined' && window.innerWidth < 760 ? 1600 : 4200;
  const tunnel = useMemo(() => createTunnelParticles(tunnelCount), [tunnelCount]);
  const lines = useMemo(() => createConstellationLines(typeof window !== 'undefined' && window.innerWidth < 760 ? 90 : 210), []);

  useFrame(({ clock }, delta) => {
    const motion = reducedMotion ? 0.08 : 1;
    const time = clock.elapsedTime;
    if (tunnelRef.current) {
      tunnelRef.current.position.z += (scrollProgress * 6 - tunnelRef.current.position.z) * 0.04;
      tunnelRef.current.rotation.z = Math.sin(time * 0.06) * 0.025 + scrollProgress * 0.08;
      tunnelRef.current.rotation.y += delta * 0.006 * motion;

      const attr = tunnelRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const original = tunnel.positions;
      for (let i = 0; i < tunnelCount; i += 1) {
        const pulse = Math.sin(time * 0.7 + tunnel.phases[i]) * 0.035 * target.energy * motion;
        arr[i * 3] = original[i * 3] * (1 + pulse);
        arr[i * 3 + 1] = original[i * 3 + 1] * (1 + pulse);
      }
      attr.needsUpdate = true;
    }
    if (lineRef.current) {
      lineRef.current.position.z += (scrollProgress * 5 - lineRef.current.position.z) * 0.035;
      lineRef.current.rotation.z -= delta * 0.006 * motion;
    }
  });

  return (
    <group>
      <points ref={tunnelRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[tunnel.positions.slice(), 3]} />
          <bufferAttribute attach="attributes-color" args={[tunnel.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.045} sizeAttenuation vertexColors transparent opacity={0.58} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <lineSegments ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#67e8f9" transparent opacity={0.12} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </group>
  );
}

function GlassShards({ scrollProgress, reducedMotion }: OrbSceneProps) {
  const ref = useRef<THREE.Group>(null);
  const shards = useMemo(() => {
    return Array.from({ length: typeof window !== 'undefined' && window.innerWidth < 760 ? 10 : 22 }, () => ({
      position: new THREE.Vector3((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 10, -Math.random() * 55 - 8),
      rotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
      scale: 0.22 + Math.random() * 0.62,
    }));
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const motion = reducedMotion ? 0.06 : 1;
    ref.current.position.z += (scrollProgress * 4 - ref.current.position.z) * 0.03;
    ref.current.rotation.z += delta * 0.008 * motion;
  });

  return (
    <group ref={ref}>
      {shards.map((shard, index) => (
        <mesh key={index} position={shard.position} rotation={shard.rotation} scale={shard.scale}>
          <planeGeometry args={[0.75, 2.7]} />
          <meshPhysicalMaterial color="#dff7ff" transparent opacity={0.045} roughness={0.08} metalness={0.2} transmission={0.65} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

function Core({ sceneProgress, reducedMotion }: OrbSceneProps) {
  const target = useMemo(() => interpolateScene(sceneProgress), [sceneProgress]);
  const groupRef = useRef<THREE.Group>(null);
  const particleRef = useRef<THREE.Points>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const innerMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const shellMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const knotMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const rings = useRef<Array<THREE.Mesh | null>>([]);
  const particleCount = typeof window !== 'undefined' && window.innerWidth < 760 ? 850 : 1900;
  const particles = useMemo(() => createSphereParticles(particleCount), [particleCount]);

  useFrame(({ clock, pointer, camera, size }, delta) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    const motion = reducedMotion ? 0.1 : 1;
    const compact = size.width <= 1024;
    const cameraDistance = camera.position.z - groupRef.current.position.z;
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2)) * cameraDistance;
    const visibleWidth = visibleHeight * (size.width / size.height);
    const x = compact ? 0 : visibleWidth * 0.23 * target.x;
    const y = compact ? visibleHeight * 0.24 : target.y;
    const scale = target.scale * (compact ? 0.57 : 1);
    groupRef.current.position.x += (x - groupRef.current.position.x) * 0.055;
    groupRef.current.position.y += (y - groupRef.current.position.y) * 0.055;
    groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x, scale, 0.055));
    groupRef.current.rotation.y += delta * target.speed * motion;
    groupRef.current.rotation.x = Math.sin(t * 0.28) * 0.08 * motion + pointer.y * 0.045;
    groupRef.current.rotation.z = pointer.x * 0.05;

    if (particleRef.current) {
      particleRef.current.rotation.y -= delta * 0.06 * motion;
      particleRef.current.rotation.z += delta * 0.035 * motion;
    }

    if (innerRef.current) {
      innerRef.current.scale.setScalar(1 + Math.sin(t * (1.3 + target.energy)) * 0.045 * target.energy * motion);
    }
    if (lightRef.current) {
      lightRef.current.color.copy(target.color);
      lightRef.current.intensity = 2.2 + target.energy * 2.2;
    }
    if (innerMaterialRef.current) {
      innerMaterialRef.current.color.copy(target.color);
      innerMaterialRef.current.emissive.copy(target.color);
      innerMaterialRef.current.emissiveIntensity = 1.35 + target.energy;
    }
    if (shellMaterialRef.current) shellMaterialRef.current.color.copy(target.accent);
    if (knotMaterialRef.current) knotMaterialRef.current.color.copy(target.color);

    rings.current.forEach((ring, index) => {
      if (!ring) return;
      ring.rotation.z += delta * (0.1 + index * 0.035) * motion;
      ring.rotation.x += delta * (0.035 + index * 0.01) * motion;
      (ring.material as THREE.MeshBasicMaterial).color.copy(index % 2 ? target.color : target.accent);
    });

  });

  return (
    <group ref={groupRef}>
      <pointLight ref={lightRef} color={target.color} intensity={2.2 + target.energy * 2.2} distance={9} />
      <mesh ref={innerRef}>
        <sphereGeometry args={[0.72, 64, 64]} />
        <meshStandardMaterial ref={innerMaterialRef} color={target.color} emissive={target.color} emissiveIntensity={1.35 + target.energy} roughness={0.18} metalness={0.18} transparent opacity={0.38} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.25, 3]} />
        <meshBasicMaterial ref={shellMaterialRef} color={target.accent} transparent opacity={0.16} wireframe blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI / 2.3, 0.2, 0.1]}>
        <torusKnotGeometry args={[1.45, 0.018, 160, 8, 2, 5]} />
        <meshBasicMaterial ref={knotMaterialRef} color={target.color} transparent opacity={0.25} blending={THREE.AdditiveBlending} />
      </mesh>
      {[0, 1, 2, 3].map((ring) => (
        <mesh
          key={ring}
          ref={(node) => {
            rings.current[ring] = node;
          }}
          rotation={[Math.PI / (2.2 + ring * 0.12), ring * 0.52, ring * 0.28]}
        >
          <torusGeometry args={[1.18 + ring * 0.22, 0.008 + ring * 0.002, 10, 160]} />
          <meshBasicMaterial color={ring % 2 ? target.color : target.accent} transparent opacity={0.34 - ring * 0.045} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <points ref={particleRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particles.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[particles.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.022} sizeAttenuation vertexColors transparent opacity={0.72} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <NeuralField reducedMotion={reducedMotion} />
    </group>
  );
}

function CameraRig({ reducedMotion }: OrbSceneProps) {
  useFrame(({ camera, pointer }) => {
    const motion = reducedMotion ? 0 : 1;
    const compact = window.innerWidth <= 1024;
    camera.position.z += ((compact ? 16 : 14) - camera.position.z) * 0.035;
    camera.position.x += (pointer.x * 0.12 * motion - camera.position.x) * 0.025;
    camera.position.y += (-pointer.y * 0.12 * motion - camera.position.y) * 0.025;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

export const OrbScene = memo(function OrbScene({ scene, sceneProgress, scrollProgress, reducedMotion }: OrbSceneProps) {
  return (
    <div className="orb-canvas" aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 14], fov: 35 }} dpr={[1, 1.65]} gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}>
        <color attach="background" args={['#020617']} />
        <fogExp2 attach="fog" args={['#020617', 0.012]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 2, 4]} intensity={1.1} color="#dbeafe" />
        <CameraRig scene={scene} sceneProgress={sceneProgress} scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
        <TunnelField scene={scene} sceneProgress={sceneProgress} scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
        <GlassShards scene={scene} sceneProgress={sceneProgress} scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
        <Core scene={scene} sceneProgress={sceneProgress} scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
});
