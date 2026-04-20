import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  size?: number;
  pulse?: boolean;
  trackMouse?: boolean;
}

export default function EyeOfProvidence({ size = 60, pulse = false, trackMouse = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    camera.position.z = 2.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const CYAN = 0x2EC4B6;

    // Triangle
    const triShape = new THREE.Shape();
    const s = 0.55;
    triShape.moveTo(0, s * 1.1);
    triShape.lineTo(-s, -s * 0.6);
    triShape.lineTo(s, -s * 0.6);
    triShape.closePath();
    const triGeo = new THREE.ShapeGeometry(triShape);
    const triEdges = new THREE.EdgesGeometry(triGeo);
    const triLine = new THREE.LineSegments(triEdges, new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.6
    }));
    group.add(triLine);

    // Inner triangle (smaller, brighter)
    const triShape2 = new THREE.Shape();
    const s2 = 0.38;
    triShape2.moveTo(0, s2 * 1.1);
    triShape2.lineTo(-s2, -s2 * 0.6);
    triShape2.lineTo(s2, -s2 * 0.6);
    triShape2.closePath();
    const triGeo2 = new THREE.ShapeGeometry(triShape2);
    const triEdges2 = new THREE.EdgesGeometry(triGeo2);
    group.add(new THREE.LineSegments(triEdges2, new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.3
    })));

    // Eye outline (torus = iris ring)
    const irisGeo = new THREE.TorusGeometry(0.18, 0.015, 8, 32);
    const irisEdges = new THREE.EdgesGeometry(irisGeo);
    const iris = new THREE.LineSegments(irisEdges, new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.8
    }));
    iris.position.y = 0.12;
    group.add(iris);

    // Pupil (glowing dot)
    const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const pupilMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9 });
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.y = 0.12;
    group.add(pupil);

    // Eyelid arcs (top and bottom)
    const eyeCurveTop = new THREE.EllipseCurve(0, 0.12, 0.25, 0.12, 0, Math.PI, false, 0);
    const eyeCurveBot = new THREE.EllipseCurve(0, 0.12, 0.25, 0.08, Math.PI, Math.PI * 2, false, 0);
    const eyeTopGeo = new THREE.BufferGeometry().setFromPoints(eyeCurveTop.getPoints(20));
    const eyeBotGeo = new THREE.BufferGeometry().setFromPoints(eyeCurveBot.getPoints(20));
    const eyeMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5 });
    group.add(new THREE.Line(eyeTopGeo, eyeMat));
    group.add(new THREE.Line(eyeBotGeo, eyeMat));

    // Scan line
    const scanGeo = new THREE.PlaneGeometry(1.2, 0.008);
    const scanMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const scanLine = new THREE.Mesh(scanGeo, scanMat);
    group.add(scanLine);

    // Mouse tracking
    const onMouseMove = (e: MouseEvent) => {
      if (!trackMouse) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      mouseRef.current.x = (e.clientX - cx) / (window.innerWidth / 2);
      mouseRef.current.y = -(e.clientY - cy) / (window.innerHeight / 2);
    };
    if (trackMouse) window.addEventListener('mousemove', onMouseMove);

    const clock = new THREE.Clock();
    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Slow rotation
      group.rotation.z = Math.sin(elapsed * 0.3) * 0.05;

      // Iris rotation
      iris.rotation.z = elapsed * 0.5;

      // Scan line sweep
      scanLine.position.y = 0.5 - (elapsed * 0.3 % 1.4);
      scanMat.opacity = 0.08 + Math.sin(elapsed * 2) * 0.04;

      // Pupil tracks mouse or drifts
      if (trackMouse) {
        pupil.position.x = mouseRef.current.x * 0.06;
        pupil.position.y = 0.12 + mouseRef.current.y * 0.04;
      } else {
        pupil.position.x = Math.sin(elapsed * 0.7) * 0.03;
        pupil.position.y = 0.12 + Math.cos(elapsed * 0.5) * 0.02;
      }

      // Pulse effect
      if (pulse) {
        const p = Math.sin(elapsed * 4);
        pupilMat.color.setHex(p > 0.7 ? 0xD64045 : CYAN);
        pupilMat.opacity = 0.7 + p * 0.3;
      }

      renderer.render(scene, camera);
    }
    animate();

    // Handle WebGL context loss/restore so the eye survives other
    // renderers being created and destroyed (e.g. About page eye).
    const canvas = renderer.domElement;
    const onContextLost = (e: Event) => {
      e.preventDefault(); // allows context to be restored
      cancelAnimationFrame(animId);
    };
    const onContextRestored = () => {
      renderer.setSize(size, size);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      animate();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    return () => {
      cancelAnimationFrame(animId);
      if (trackMouse) window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer.dispose();
      if (el.contains(canvas)) el.removeChild(canvas);
    };
  }, [size, pulse, trackMouse]);

  return <div ref={containerRef} style={{ width: size, height: size }} />;
}
