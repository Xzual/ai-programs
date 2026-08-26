import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AiState } from '../../types';

interface ParticleCoreProps {
  aiState: AiState;
  quality?: 'low' | 'medium' | 'high';
  audioAnalyser?: AnalyserNode | null;
  className?: string;
  onClick?: () => void;
  theme?: {
    primary: string;
    secondary: string;
    accent: string;
    name: string;
  };
}

export const ParticleCore: React.FC<ParticleCoreProps> = ({
  aiState,
  quality = 'high',
  audioAnalyser,
  className = '',
  onClick,
  theme,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(18);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const [fps, setFps] = useState<number>(60);
  const [activeParticleCount, setActiveParticleCount] = useState<number>(
    quality === 'low' ? 2000 : quality === 'medium' ? 3600 : 5600
  );

  useEffect(() => {
    const baseCount = quality === 'low' ? 2000 : quality === 'medium' ? 3600 : 5600;
    setActiveParticleCount(baseCount);
  }, [quality]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 400;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    camera.position.z = zoomRef.current;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 2. Geometry & Particles
    const count = activeParticleCount;
    const positions = new Float32Array(count * 3);
    const originalPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    // Create a spherical particle cloud with layered internal shell
    const assistantName = (theme?.name ?? '').toLowerCase();
    const isUltron = assistantName.includes('ultron');
    const colorIdle1 = new THREE.Color(theme?.primary ?? (isUltron ? '#ff9d00' : '#22d3ee'));
    const colorIdle2 = new THREE.Color(theme?.secondary ?? (isUltron ? '#ff5a00' : '#2563eb'));
    const colorListening = new THREE.Color(theme?.accent ?? (isUltron ? '#ffd36a' : '#67e8f9'));
    const colorThinking = new THREE.Color(isUltron ? '#ffb000' : (theme?.primary ?? '#38bdf8'));
    const colorSpeaking = new THREE.Color(isUltron ? '#fff0a6' : (theme?.accent ?? '#5eead4'));
    const colorError = new THREE.Color('#ef4444'); // Red
    const themeLuminance =
      colorIdle1.r * 0.2126 + colorIdle1.g * 0.7152 + colorIdle1.b * 0.0722;
    const isBrightTheme = themeLuminance > 0.78;
    const coreScale = isUltron ? 1.14 : (isBrightTheme ? 0.98 : 1.08);
    const particleSize = isUltron ? 0.18 : (isBrightTheme ? 0.27 : 0.34);
    const lightIntensity = isUltron ? 7.5 : (isBrightTheme ? 1.75 : 3.15);

    const colorToRgba = (color: THREE.Color, alpha: number) => {
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const thetaBase = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      const ringBias = Math.random();
      const circuitLayer = Math.floor(Math.random() * 22);
      const radius = ringBias < 0.7
        ? 0.9 + circuitLayer * 0.31 + (Math.random() - 0.5) * 0.16
        : 1.0 + Math.random() * 7.2;
      const radialShard = Math.random() < 0.18;
      const shardStretch = radialShard ? 1 + Math.random() * 0.42 : 1;
      const spokeSnap = Math.PI / 56;
      const theta = ringBias < 0.76
        ? Math.round(thetaBase / spokeSnap) * spokeSnap + (Math.random() - 0.5) * 0.012
        : thetaBase;

      const x = Math.cos(theta) * radius * shardStretch;
      const y = Math.sin(theta) * radius * (0.72 + Math.random() * 0.28) * shardStretch;
      const z = (Math.random() - 0.5) * (ringBias < 0.7 ? 0.46 : 2.1) + Math.cos(phi) * 0.28;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      originalPositions[i * 3] = x;
      originalPositions[i * 3 + 1] = y;
      originalPositions[i * 3 + 2] = z;

      // Initial color mix
      const mixRatio = Math.random();
      const c = colorIdle1.clone().lerp(colorIdle2, mixRatio);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      sizes[i] = 0.08 + Math.random() * (ringBias < 0.7 ? 0.18 : 0.28);
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Custom Canvas Circular Glow Texture
    const createParticleTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, colorToRgba(colorListening, isBrightTheme ? 0.9 : 1));
        grad.addColorStop(0.34, colorToRgba(colorIdle1, isBrightTheme ? 0.5 : 0.74));
        grad.addColorStop(0.72, colorToRgba(colorIdle2, isBrightTheme ? 0.14 : 0.22));
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
      }
      const texture = new THREE.CanvasTexture(canvas);
      return texture;
    };

    const material = new THREE.PointsMaterial({
      size: particleSize,
      map: createParticleTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    const particleSystem = new THREE.Points(geometry, material);
    particleSystem.scale.setScalar(coreScale);
    scene.add(particleSystem);

    const lineGroup = new THREE.Group();
    for (let i = 0; i < (isUltron ? 38 : 11); i++) {
      const r = (isUltron ? 1.25 : 4.55) + i * (isUltron ? 0.16 : 0.2);
      const start = isUltron ? (Math.PI * 2 * i) / 38 + Math.random() * 0.35 : 0;
      const end = isUltron ? start + Math.PI * (0.18 + Math.random() * 0.68) : Math.PI * 2;
      const curve = new THREE.EllipseCurve(0, 0, r, isUltron ? r * (0.86 + Math.random() * 0.08) : 2.15 + i * 0.13, start, end);
      const points = curve.getPoints(180).map((p) => new THREE.Vector3(p.x, p.y, 0));
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: i % 2 ? colorIdle1 : colorIdle2,
        transparent: true,
        opacity: isUltron ? 0.2 + Math.random() * 0.28 : 0.3 + i * 0.018,
        blending: THREE.AdditiveBlending,
      });
      const line = isUltron ? new THREE.Line(lineGeometry, lineMaterial) : new THREE.LineLoop(lineGeometry, lineMaterial);
      line.rotation.x = isUltron ? 0 : Math.random() * Math.PI;
      line.rotation.y = isUltron ? 0 : Math.random() * Math.PI;
      line.rotation.z = Math.random() * Math.PI;
      lineGroup.add(line);
    }
    lineGroup.scale.setScalar(coreScale);
    scene.add(lineGroup);

    const atomGroup = new THREE.Group();
    for (let i = 0; i < (isUltron ? 18 : 7); i++) {
      const rr = (isUltron ? 1.6 : 6.3) + i * (isUltron ? 0.23 : 0.18);
      const st = isUltron ? (Math.PI * 2 * i) / 18 + Math.random() * 0.5 : 0;
      const en = isUltron ? st + Math.PI * (0.42 + Math.random() * 0.78) : Math.PI * 2;
      const curve = new THREE.EllipseCurve(0, 0, rr, isUltron ? rr * (0.82 + Math.random() * 0.12) : 2.35 + (i % 3) * 0.22, st, en);
      const points = curve.getPoints(220).map((p) => new THREE.Vector3(p.x, p.y, 0));
      const orbitGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const orbitMaterial = new THREE.LineBasicMaterial({
        color: isUltron ? (i % 3 === 0 ? '#ffd36a' : i % 2 ? '#ff9d00' : '#ff5a00') : (i % 2 ? '#67e8f9' : '#38bdf8'),
        transparent: true,
        opacity: isUltron ? 0.18 + Math.random() * 0.26 : 0.32,
        blending: THREE.AdditiveBlending,
      });
      const orbit = isUltron ? new THREE.Line(orbitGeometry, orbitMaterial) : new THREE.LineLoop(orbitGeometry, orbitMaterial);
      orbit.rotation.x = isUltron ? 0 : Math.PI * (0.16 + i * 0.085);
      orbit.rotation.y = isUltron ? 0 : Math.PI * (0.08 + i * 0.12);
      orbit.rotation.z = Math.PI * (i * 0.19);
      atomGroup.add(orbit);
    }
    atomGroup.scale.setScalar(coreScale * 1.02);
    scene.add(atomGroup);

    

    // ULTRON-specific fractured neural/circuit pathways
    const ultronCircuitGroup = new THREE.Group();
    const ultronSparkGroup = new THREE.Group();
    if (isUltron) {
      const pathCount = quality === 'low' ? 90 : quality === 'medium' ? 150 : 220;
      for (let i = 0; i < pathCount; i++) {
        const pts: THREE.Vector3[] = [];
        const segs = 3 + Math.floor(Math.random() * 6);
        let theta = Math.round((Math.random() * Math.PI * 2) / (Math.PI / 64)) * (Math.PI / 64);
        let radius = 0.95 + Math.random() * 7.05;
        const angularPath = Math.random() < 0.72;
        const direction = Math.random() < 0.5 ? -1 : 1;
        const radialDirection = Math.random() < 0.5 ? -1 : 1;
        const z = (Math.random() - 0.5) * 1.3;
        for (let s = 0; s < segs; s++) {
          if (angularPath) {
            theta += direction * (0.035 + Math.random() * 0.13);
            if (s % 3 === 0) radius += radialDirection * (0.08 + Math.random() * 0.22);
          } else {
            theta += direction * (s % 2 === 0 ? 0.018 : 0.085);
            radius += radialDirection * (0.16 + Math.random() * 0.38);
          }
          radius = Math.max(0.72, Math.min(8.55, radius));
          pts.push(new THREE.Vector3(
            radius * Math.cos(theta),
            radius * Math.sin(theta) * (0.76 + Math.random() * 0.2),
            z + (Math.random() - 0.5) * 0.18,
          ));
        }
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({
          color: i % 4 === 0 ? '#ffd36a' : i % 2 === 0 ? '#ff9d00' : '#ff5a00',
          transparent: true,
          opacity: 0.14 + Math.random() * 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        ultronCircuitGroup.add(new THREE.Line(g, m));

        if (Math.random() < 0.32) {
          const end = pts[pts.length - 1];
          const spark = new THREE.Mesh(
            new THREE.SphereGeometry(0.025 + Math.random() * 0.045, 8, 6),
            new THREE.MeshBasicMaterial({
              color: Math.random() < 0.25 ? '#fff4bf' : '#ff9d00',
              transparent: true,
              opacity: 0.9,
              blending: THREE.AdditiveBlending,
            })
          );
          spark.position.copy(end);
          ultronSparkGroup.add(spark);
        }
      }

      for (let i = 0; i < 52; i++) {
        const theta = Math.random() * Math.PI * 2;
        const inner = 0.75 + Math.random() * 2.7;
        const outer = inner + 1.2 + Math.random() * 4.8;
        const pts = [
          new THREE.Vector3(Math.cos(theta) * inner, Math.sin(theta) * inner * 0.82, (Math.random() - 0.5) * 0.4),
          new THREE.Vector3(Math.cos(theta) * outer, Math.sin(theta) * outer * 0.82, (Math.random() - 0.5) * 0.8),
        ];
        const ray = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: i % 4 === 0 ? '#fff1a8' : '#ff8a00',
            transparent: true,
            opacity: 0.1 + Math.random() * 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        ultronCircuitGroup.add(ray);
      }
      scene.add(ultronCircuitGroup);
      scene.add(ultronSparkGroup);
    }

    const ultronCoreGroup = new THREE.Group();
    if (isUltron) {
      const coreMaterials = [
        new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
        new THREE.MeshBasicMaterial({ color: '#fff0a6', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      ];
      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.48 + i * 0.34, 0.018 + i * 0.006, 6, 96, Math.PI * (1.25 + Math.random() * 0.65)),
          coreMaterials[i % coreMaterials.length]
        );
        ring.rotation.z = Math.random() * Math.PI * 2;
        ring.position.z = 0.06 * i;
        ultronCoreGroup.add(ring);
      }
      const coreSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 32, 18),
        new THREE.MeshBasicMaterial({ color: '#fff2bc', transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending })
      );
      ultronCoreGroup.add(coreSphere);
      scene.add(ultronCoreGroup);
    }

    // Add central core light
    const pointLight = new THREE.PointLight(colorIdle1, lightIntensity, 20);
    scene.add(pointLight);

    // Audio frequency array buffer
    const audioDataArray = new Uint8Array(64);

    // Animation Loop
    let animationFrameId: number;
    let clock = new THREE.Clock();
    let lastFpsTime = performance.now();
    let frameCount = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();
      frameCount++;

      // FPS Monitor
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        const currentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        setFps(currentFps);
        // Auto-scale down particle count if performance drops
        if (currentFps < 28 && activeParticleCount > 1800) {
          setActiveParticleCount((prev) => Math.max(1500, prev - 1000));
        }
        frameCount = 0;
        lastFpsTime = now;
      }

      // Audio frequency input processing
      let audioFactor = 0;
      if (audioAnalyser) {
        try {
          audioAnalyser.getByteFrequencyData(audioDataArray);
          let sum = 0;
          for (let i = 0; i < 16; i++) {
            sum += audioDataArray[i];
          }
          audioFactor = sum / (16 * 255); // 0 to 1
        } catch (e) {
          audioFactor = 0;
        }
      }

      // State-dependent target color & speeds
      let targetColor1 = colorIdle1;
      let targetColor2 = colorIdle2;
      let rotationSpeed = 0.2;
      let pulseSpeed = 1.5;
      let waveAmplitude = 0.25;

      switch (aiState) {
        case 'listening':
          targetColor1 = colorListening;
          targetColor2 = new THREE.Color(theme?.secondary ?? '#3b82f6');
          rotationSpeed = 0.4;
          pulseSpeed = 3.0;
          waveAmplitude = 0.6;
          break;

        case 'thinking':
          targetColor1 = colorThinking;
          targetColor2 = colorSpeaking;
          rotationSpeed = 1.2;
          pulseSpeed = 5.0;
          waveAmplitude = 0.8;
          break;

        case 'speaking':
          targetColor1 = colorSpeaking;
          targetColor2 = colorListening;
          rotationSpeed = 0.6;
          pulseSpeed = 4.0;
          waveAmplitude = 0.5 + audioFactor * 1.5;
          break;

        case 'error':
          targetColor1 = colorError;
          targetColor2 = new THREE.Color(theme?.accent ?? '#f59e0b');
          rotationSpeed = 0.1;
          pulseSpeed = 6.0;
          waveAmplitude = 0.4;
          break;

        case 'idle':
        default:
          targetColor1 = colorIdle1;
          targetColor2 = colorIdle2;
          rotationSpeed = 0.2;
          pulseSpeed = 1.2;
          waveAmplitude = 0.2;
          break;
      }

      // Rotate whole core
      camera.position.z += (zoomRef.current - camera.position.z) * 0.12;
      particleSystem.rotation.y = elapsedTime * rotationSpeed * 0.35 + rotationRef.current.y;
      particleSystem.rotation.x = Math.sin(elapsedTime * 0.3) * 0.12 + rotationRef.current.x;
      lineGroup.rotation.y = -elapsedTime * rotationSpeed * 0.22 + rotationRef.current.y * 0.8;
      lineGroup.rotation.x = rotationRef.current.x * 0.8;
      atomGroup.rotation.y = elapsedTime * rotationSpeed * 0.18 + rotationRef.current.y * 0.6;
      atomGroup.rotation.x = Math.sin(elapsedTime * 0.16) * 0.1 + rotationRef.current.x * 0.55;
      if (isUltron) {
        ultronCircuitGroup.rotation.y = -elapsedTime * rotationSpeed * 0.11 + rotationRef.current.y * 0.35;
        ultronCircuitGroup.rotation.z = Math.sin(elapsedTime * 0.08) * 0.08;
        ultronSparkGroup.rotation.copy(ultronCircuitGroup.rotation);
        ultronCoreGroup.rotation.z = elapsedTime * 0.42;
        ultronCoreGroup.scale.setScalar(1 + Math.sin(elapsedTime * 2.6) * 0.04);
      }

      // Animate individual particles
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = geometry.attributes.color as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      const colArr = colAttr.array as Float32Array;

      const pulse = Math.sin(elapsedTime * pulseSpeed) * waveAmplitude;

      for (let i = 0; i < count; i++) {
        const ox = originalPositions[i * 3];
        const oy = originalPositions[i * 3 + 1];
        const oz = originalPositions[i * 3 + 2];

        const phase = phases[i];
        const dist = Math.sqrt(ox * ox + oy * oy + oz * oz);

        // Calculate wave displacement
        const wave = Math.sin(elapsedTime * pulseSpeed + dist * 0.8 + phase) * waveAmplitude;
        const scaleFactor = 1 + wave * 0.15 + (aiState === 'speaking' ? audioFactor * 0.4 : 0);

        posArr[i * 3] = ox * scaleFactor;
        posArr[i * 3 + 1] = oy * scaleFactor;
        posArr[i * 3 + 2] = oz * scaleFactor;

        // Smooth color interpolation
        const mixVal = (Math.sin(elapsedTime + phase) + 1) * 0.5;
        const curColor = targetColor1.clone().lerp(targetColor2, mixVal);

        colArr[i * 3] += (curColor.r - colArr[i * 3]) * 0.05;
        colArr[i * 3 + 1] += (curColor.g - colArr[i * 3 + 1]) * 0.05;
        colArr[i * 3 + 2] += (curColor.b - colArr[i * 3 + 2]) * 0.05;
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      // Light glow modulation
      pointLight.color.copy(targetColor1);
      pointLight.intensity =
        lightIntensity +
        Math.sin(elapsedTime * pulseSpeed) * (isBrightTheme ? 0.45 : 1.1) +
        (aiState === 'speaking' ? audioFactor * (isBrightTheme ? 1.8 : 4) : 0);

      renderer.render(scene, camera);
    };

    animate();

    // Handle Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 400;
      const h = container.clientHeight || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomRef.current = Math.min(30, Math.max(15, zoomRef.current + event.deltaY * 0.018));
    };
    const handlePointerDown = (event: PointerEvent) => {
      dragRef.current = { active: true, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      rotationRef.current.y += dx * 0.01;
      rotationRef.current.x += dy * 0.01;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
    };
    const handlePointerUp = () => {
      dragRef.current.active = false;
    };

    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      lineGroup.children.forEach((child) => {
        const line = child as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      ultronCircuitGroup.children.forEach((child) => {
        const line = child as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      ultronSparkGroup.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      ultronCoreGroup.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      atomGroup.children.forEach((child) => {
        const line = child as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      renderer.dispose();
    };
  }, [aiState, activeParticleCount, audioAnalyser, theme]);

  return (
    <div
      onClick={onClick}
      className={`relative flex items-center justify-center cursor-pointer select-none group ${className}`}
    >
      {/* Background Neon Ambient Aura */}
      <div
        className={`absolute inset-0 rounded-full filter blur-3xl opacity-30 transition-all duration-700 ${
          aiState === 'listening'
            ? 'bg-[var(--edith-accent)] opacity-50 scale-110'
            : aiState === 'thinking'
            ? 'bg-[var(--edith-primary)] opacity-60 scale-125 animate-pulse'
            : aiState === 'speaking'
            ? 'bg-[var(--edith-secondary)] opacity-50 scale-115'
            : aiState === 'error'
            ? 'bg-red-500 opacity-60'
            : 'bg-[var(--edith-primary)]/40 group-hover:opacity-50'
        }`}
      />

      {/* 3D WebGL Canvas */}
      <div ref={mountRef} className="w-full h-full min-h-[280px] sm:min-h-[380px] z-10" />
    </div>
  );
};
