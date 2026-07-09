import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function LogoScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = 350;
    const H = 280;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = `${W}px`;
    renderer.domElement.style.height = `${H}px`;
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
    camera.position.set(0, 0, 31);

    const GREEN = 0x00ff00;
    const DIMGREEN = 0x0a7a0a;
    const DARK = 0x041404;
    const root = new THREE.Group();
    scene.add(root);

    // ── Hex badge outline ──────────────────────────────────────────────────
    const hexPts: THREE.Vector2[] = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + i * Math.PI / 3;
      hexPts.push(new THREE.Vector2(Math.cos(a) * 9.2, Math.sin(a) * 9.2));
    }
    hexPts.push(hexPts[0].clone());
    const hexLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(hexPts.map(p => new THREE.Vector3(p.x, p.y, 0))),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.55 })
    );
    root.add(hexLine);
    const hexInner = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(hexPts.map(p => new THREE.Vector3(p.x * 0.92, p.y * 0.92, 0))),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.2 })
    );
    root.add(hexInner);

    // ── Skyline ────────────────────────────────────────────────────────────
    function addBuilding(x: number, w: number, h: number, d: number, dim: boolean) {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: DARK }));
      mesh.position.set(x, -5 + h / 2, -1);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: dim ? DIMGREEN : GREEN, transparent: true, opacity: dim ? 0.5 : 0.9 })
      );
      mesh.add(edges);
      if (!dim) {
        const winGeo = new THREE.PlaneGeometry(0.28, 0.28);
        for (let r = 0; r < Math.floor(h / 1.0) - 1; r++) {
          for (let c = -1; c <= 1; c += 2) {
            if (Math.random() < 0.3) continue;
            const win = new THREE.Mesh(
              winGeo,
              new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: Math.random() < 0.5 ? 0.9 : 0.3 })
            );
            win.position.set(c * w * 0.22, -h / 2 + 0.7 + r * 1.0, d / 2 + 0.01);
            mesh.add(win);
          }
        }
      }
      root.add(mesh);
    }

    addBuilding(-5.5, 1.6, 4.2, 1.4, false);
    addBuilding(-2.8, 1.4, 5.8, 1.3, false);
    addBuilding( 2.8, 1.4, 5.4, 1.3, false);
    addBuilding( 5.5, 1.6, 3.9, 1.4, false);
    addBuilding(-7.2, 1.2, 5.0, 1.1, true);
    addBuilding(-0.8, 1.1, 6.8, 1.1, true);
    addBuilding( 0.8, 1.2, 6.2, 1.1, true);
    addBuilding( 7.2, 1.2, 4.6, 1.1, true);

    // Ground line
    root.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-8, -5, -1), new THREE.Vector3(8, -5, -1)]),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.7 })
    ));

    // ── Gem ───────────────────────────────────────────────────────────────
    const gemGroup = new THREE.Group();
    const gemGeo = new THREE.OctahedronGeometry(2.2);
    gemGroup.add(new THREE.Mesh(gemGeo, new THREE.MeshBasicMaterial({ color: DARK, transparent: true, opacity: 0.9 })));
    gemGroup.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(gemGeo),
      new THREE.LineBasicMaterial({ color: GREEN, linewidth: 2 })
    ));
    const innerGeo = new THREE.OctahedronGeometry(1.4);
    gemGroup.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(innerGeo),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.35 })
    ));
    gemGroup.position.set(0, 2.8, 1);
    root.add(gemGroup);

    // ── CITY_NET label ────────────────────────────────────────────────────
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 768;
    labelCanvas.height = 96;
    const ctx = labelCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#00ff00';
      ctx.font = '900 68px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('C I T Y _ N E T', 384, 48);
    }
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(11.2, 1.9),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true })
    );
    label.position.set(0, -10.9, 0);
    scene.add(label);

    // ── Ambient auto-rotation ─────────────────────────────────────────────
    let raf: number;
    const start = performance.now();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - start) / 1000;
      root.rotation.y = t * 0.25;
      gemGroup.rotation.y = t * 0.6;
      gemGroup.position.y = 2.8 + Math.sin(t * 1.2) * 0.18;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="logo-scene" style={{ width: '350px', height: '280px', overflow: 'hidden', margin: '0 auto 24px', position: 'relative' }} />;
}
