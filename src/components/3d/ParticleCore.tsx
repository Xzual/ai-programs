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
  const zoomRef = useRef(20);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const [fps, setFps] = useState<number>(60);
  const [activeParticleCount, setActiveParticleCount] = useState<number>(
    quality === 'low' ? 1800 : quality === 'medium' ? 3800 : 6000
  );

  useEffect(() => {
    let baseCount = quality === 'low' ? 1800 : quality === 'medium' ? 3800 : 6000;
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
    const colorIdle1 = new THREE.Color(theme?.primary ?? '#38bdf8');
    const colorIdle2 = new THREE.Color(theme?.secondary ?? '#2563eb');
    const colorListening = new THREE.Color(theme?.accent ?? '#67e8f9');
    const colorThinking = new THREE.Color(theme?.primary ?? '#38bdf8');
    const colorSpeaking = new THREE.Color(theme?.accent ?? '#67e8f9');
    const colorError = new THREE.Color('#ef4444'); // Red
    const themeLuminance =
      colorIdle1.r * 0.2126 + colorIdle1.g * 0.7152 + colorIdle1.b * 0.0722;
    const isBrightTheme = themeLuminance > 0.78;
    const coreScale = isBrightTheme ? 0.9 : 1;
    const particleSize = isBrightTheme ? 0.26 : 0.33;
    const lightIntensity = isBrightTheme ? 1.35 : 2.4;

    const colorToRgba = (color: THREE.Color, alpha: number) => {
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      const ringBias = Math.random();
      const radius = ringBias < 0.62
        ? 5.0 + Math.sin(theta * 5) * 0.25 + Math.random() * 0.25
        : 2.0 + Math.random() * 5.8;

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = ringBias < 0.62
        ? (Math.random() - 0.5) * 0.75
        : radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

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

      sizes[i] = 0.12 + Math.random() * 0.22;
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
    for (let i = 0; i < 9; i++) {
      const curve = new THREE.EllipseCurve(0, 0, 4.2 + i * 0.28, 4.2 + i * 0.28, 0, Math.PI * 2);
      const points = curve.getPoints(180).map((p) => new THREE.Vector3(p.x, p.y, 0));
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: i % 2 ? colorIdle1 : colorIdle2,
        transparent: true,
        opacity: 0.18 + i * 0.025,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.LineLoop(lineGeometry, lineMaterial);
      line.rotation.x = Math.random() * Math.PI;
      line.rotation.y = Math.random() * Math.PI;
      line.rotation.z = Math.random() * Math.PI;
      lineGroup.add(line);
    }
    lineGroup.scale.setScalar(coreScale);
    scene.add(lineGroup);

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
          targetColor2 = new THREE.Color('#3b82f6');
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
          targetColor2 = new THREE.Color('#f59e0b');
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
      zoomRef.current = Math.min(32, Math.max(18, zoomRef.current + event.deltaY * 0.018));
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

      {/* Overlay Status Badge */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950/80 backdrop-blur-md border border-[var(--edith-primary)]/30 text-xs text-slate-200 shadow-xl">
        <span
          className={`w-2 h-2 rounded-full ${
            aiState === 'listening'
              ? 'bg-[var(--edith-accent)] animate-ping'
              : aiState === 'thinking'
              ? 'bg-[var(--edith-primary)] animate-bounce'
              : aiState === 'speaking'
              ? 'bg-[var(--edith-secondary)] animate-pulse'
              : aiState === 'error'
              ? 'bg-red-500'
              : 'bg-emerald-400'
          }`}
        />
        <span className="font-mono uppercase tracking-wider font-semibold text-[11px]">
          {aiState === 'listening'
            ? 'Dinliyor...'
            : aiState === 'thinking'
            ? 'Düşünüyor...'
            : aiState === 'speaking'
            ? 'Konuşuyor...'
            : aiState === 'error'
            ? 'Hata Oluştu'
            : `${theme?.name ?? 'JARVIS'} Çekirdek Hazır`}
        </span>
        <span className="text-[10px] text-slate-500 border-l border-slate-800 pl-2">
          {fps} FPS ({activeParticleCount} P)
        </span>
      </div>
    </div>
  );
};
