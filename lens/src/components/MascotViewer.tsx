import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildMascot } from '../utils/mascots';

interface Props {
  type: string;
  state: 'locked' | 'idle' | 'active';
  size?: number;
}

const snapshotCache = new Map<string, string>();

function renderSnapshot(type: string, size: number): string | null {
  const key = `${type}-${size}`;
  if (snapshotCache.has(key)) return snapshotCache.get(key)!;

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    camera.position.z = 1.8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const mascot = buildMascot(type);
    scene.add(mascot);
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL();
    snapshotCache.set(key, dataUrl);
    renderer.dispose();
    return dataUrl;
  } catch {
    return null;
  }
}

export default function MascotViewer({ type, state, size = 180 }: Props) {
  // Active/locked: always live
  if (state !== 'idle') {
    return <LiveMascot type={type} state={state} size={size} />;
  }

  // Idle: static snapshot with live-on-hover
  return <IdleMascot type={type} size={size} />;
}

function IdleMascot({ type, size }: { type: string; size: number }) {
  const [hovered, setHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const src = renderSnapshot(type, size);

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: size, height: size, position: 'relative' }}
    >
      {hovered ? (
        <LiveMascot type={type} state="idle" size={size} />
      ) : (
        src ? <img src={src} width={size} height={size} alt={type} /> : null
      )}
    </div>
  );
}

function LiveMascot({ type, state, size }: { type: string; state: string; size: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    camera.position.z = 1.8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const mascot = buildMascot(type);
    scene.add(mascot);

    if (state === 'locked') {
      mascot.traverse((child) => {
        if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
          (child.material as THREE.LineBasicMaterial).opacity = 0.15;
        }
        if (child instanceof THREE.Points) {
          (child.material as THREE.PointsMaterial).opacity = 0.1;
        }
      });
    }

    const canvas = renderer.domElement;
    const onContextLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(animId); };
    const onContextRestored = () => { renderer.setSize(size, size); animate(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const clock = new THREE.Clock();
    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (state !== 'locked' && mascot.userData.update) mascot.userData.update(delta);
      if (state === 'idle') mascot.rotation.y += delta * 0.3;
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer.dispose();
      if (el.contains(canvas)) el.removeChild(canvas);
    };
  }, [type, state, size]);

  return <div ref={ref} style={{ width: size, height: size }} />;
}
