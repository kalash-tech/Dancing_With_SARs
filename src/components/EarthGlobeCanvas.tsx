import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Layers3,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Satellite,
  X,
} from 'lucide-react';
import { REGION_DATASETS } from '../data/samples/asfVertexSamples.ts';
import type { RegionId } from '../types/sar.ts';
import {
  computeCameraPositionForLatLon,
  latLonToCartesian,
} from '../utils/globeMath.ts';

interface EarthGlobeCanvasProps {
  activeRegionId: RegionId;
  onSelectRegionTransition: (regionId: RegionId) => void;
  isTransitioning: boolean;
}

type GlobeLayer = 'orbits' | 'labels' | 'clouds';

const EARTH_RADIUS = 1.72;
const DEFAULT_CAMERA_LAT = 22;
const DEFAULT_CAMERA_LON = 82;
const DEFAULT_CAMERA_DISTANCE = 5.45;
const MIN_CAMERA_DISTANCE = 2.65;
const MAX_CAMERA_DISTANCE = 8.5;

function getFitDistance(aspect: number) {
  return THREE.MathUtils.clamp(
    DEFAULT_CAMERA_DISTANCE * Math.max(1, 1.08 / aspect),
    DEFAULT_CAMERA_DISTANCE,
    MAX_CAMERA_DISTANCE
  );
}

const SATELLITES = [
  { name: 'NISAR', color: '#57d9ff', radius: 2.12, tilt: 97.4, node: 18, speed: 0.12, phase: 0.6 },
  { name: 'Landsat 9', color: '#c7d2df', radius: 2.28, tilt: 98.2, node: 102, speed: 0.085, phase: 2.8 },
  { name: 'Sentinel-6', color: '#e9b872', radius: 2.42, tilt: 66, node: 42, speed: 0.07, phase: 4.1 },
  { name: 'Aqua', color: '#a5b4c5', radius: 2.55, tilt: 98.1, node: 145, speed: 0.075, phase: 1.9 },
  { name: 'SWOT', color: '#c6a6e8', radius: 2.68, tilt: 77.6, node: 76, speed: 0.06, phase: 5.2 },
  { name: 'GPM', color: '#9db6c9', radius: 2.82, tilt: 65, node: 120, speed: 0.055, phase: 3.4 },
] as const;

const earthVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const earthFragmentShader = `
  uniform sampler2D uEarthMap;
  uniform sampler2D uCloudMap;
  uniform float uCloudOffset;
  uniform float uCloudVisibility;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec3 normal = normalize(vNormal);
    float sunlight = max(dot(normal, normalize(vec3(-0.45, 0.38, 0.82))), 0.0);
    vec3 earth = texture2D(uEarthMap, vUv).rgb;
    vec4 clouds = texture2D(uCloudMap, vec2(fract(vUv.x + uCloudOffset), vUv.y));
    float cloudAlpha = clouds.a * uCloudVisibility * 0.9;
    vec3 color = mix(earth, vec3(0.94, 0.97, 1.0), cloudAlpha);
    color *= 0.2 + sunlight * 1.08;
    float rim = pow(1.0 - max(dot(normal, normalize(vViewDirection)), 0.0), 3.4);
    color += vec3(0.035, 0.17, 0.34) * rim * (0.35 + sunlight * 0.65);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const atmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    float intensity = pow(0.72 - dot(normalize(vNormal), normalize(vViewDirection)), 3.0);
    gl_FragColor = vec4(0.18, 0.55, 0.95, 0.55) * intensity;
  }
`;

function createLabelSprite(name: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(20, 40, 8, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = color;
    context.font = '500 28px Arial, sans-serif';
    context.textBaseline = 'middle';
    context.fillText(name, 42, 41);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.88,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.88, 0.184, 1);
  return sprite;
}

export function EarthGlobeCanvas({
  activeRegionId,
  onSelectRegionTransition,
  isTransitioning,
}: EarthGlobeCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<RegionId | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLayersOpen, setIsLayersOpen] = useState(false);
  const [isLive, setIsLive] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [layers, setLayers] = useState({ orbits: true, labels: true, clouds: true });
  const flyTriggerRef = useRef<((id: RegionId) => void) | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const zoomViewRef = useRef<((factor: number) => void) | null>(null);
  const setLayerRef = useRef<((layer: GlobeLayer, visible: boolean) => void) | null>(null);
  const onSelectRef = useRef(onSelectRegionTransition);
  const activeRegionRef = useRef(activeRegionId);
  const isLiveRef = useRef(isLive);

  useEffect(() => {
    onSelectRef.current = onSelectRegionTransition;
  }, [onSelectRegionTransition]);

  useEffect(() => {
    activeRegionRef.current = activeRegionId;
  }, [activeRegionId]);

  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('3D globe unavailable; choose a region card below to open the 2D radar map.');
      setIsLoading(false);
      return;
    }

    let isDisposed = false;
    let needsRender = true;
    let isVisible = true;
    let animationTime = 0;
    let lastFrameTime = performance.now();
    let lastRenderTime = 0;
    let rafId = 0;
    let hoverRegionLocal: RegionId | null = null;
    let pointerDownPosition = { x: 0, y: 0 };
    let flyState: {
      start: THREE.Vector3;
      end: THREE.Vector3;
      startedAt: number;
      target: RegionId | null;
    } | null = null;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.25 : 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive Earth with live satellite orbits and three NISAR study areas'
    );
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 60);
    const initialCamera = computeCameraPositionForLatLon(
      DEFAULT_CAMERA_LAT,
      DEFAULT_CAMERA_LON,
      getFitDistance(width / height)
    );
    camera.position.set(initialCamera.x, initialCamera.y, initialCamera.z);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.75;
    controls.minDistance = MIN_CAMERA_DISTANCE;
    controls.maxDistance = MAX_CAMERA_DISTANCE;
    controls.addEventListener('change', () => {
      needsRender = true;
    });

    const colorPlaceholder = new THREE.DataTexture(new Uint8Array([10, 30, 52, 255]), 1, 1);
    colorPlaceholder.needsUpdate = true;
    colorPlaceholder.colorSpace = THREE.SRGBColorSpace;
    const cloudPlaceholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    cloudPlaceholder.needsUpdate = true;

    const earthUniforms = {
      uEarthMap: { value: colorPlaceholder as THREE.Texture },
      uCloudMap: { value: cloudPlaceholder as THREE.Texture },
      uCloudOffset: { value: 0 },
      uCloudVisibility: { value: layers.clouds ? 1 : 0 },
    };
    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
    });
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 48);
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earth);

    const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.035, 48, 32);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: atmosphereFragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    scene.add(atmosphere);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('/textures/earth-color.jpg', (texture) => {
      if (isDisposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      earthUniforms.uEarthMap.value = texture;
      colorPlaceholder.dispose();
      setIsLoading(false);
      needsRender = true;
    });
    textureLoader.load('/textures/earth-clouds.png', (texture) => {
      if (isDisposed) {
        texture.dispose();
        return;
      }
      texture.anisotropy = 2;
      earthUniforms.uCloudMap.value = texture;
      cloudPlaceholder.dispose();
      needsRender = true;
    });

    const orbitRoot = new THREE.Group();
    scene.add(orbitRoot);
    const labelSprites: THREE.Sprite[] = [];
    const satelliteGeometry = new THREE.SphereGeometry(0.026, 10, 8);
    const satelliteTracks = SATELLITES.map((satellite) => {
      const group = new THREE.Group();
      group.rotation.set(
        THREE.MathUtils.degToRad(satellite.tilt),
        THREE.MathUtils.degToRad(satellite.node),
        0
      );
      const points: THREE.Vector3[] = [];
      for (let index = 0; index < 160; index += 1) {
        const angle = (index / 160) * Math.PI * 2;
        points.push(new THREE.Vector3(
          Math.cos(angle) * satellite.radius,
          Math.sin(angle) * satellite.radius,
          0
        ));
      }
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: satellite.color,
          transparent: true,
          opacity: satellite.name === 'NISAR' ? 0.5 : 0.25,
          depthWrite: false,
        })
      );
      group.add(line);

      const marker = new THREE.Mesh(
        satelliteGeometry,
        new THREE.MeshBasicMaterial({ color: satellite.color })
      );
      group.add(marker);
      const label = createLabelSprite(satellite.name, satellite.color);
      group.add(label);
      labelSprites.push(label);
      orbitRoot.add(group);
      return { ...satellite, marker, label };
    });

    const clickableTargets: THREE.Mesh[] = [];
    const regionMarkers: Array<{
      id: RegionId;
      core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    }> = [];
    const coreGeometry = new THREE.SphereGeometry(0.045, 14, 10);
    const ringGeometry = new THREE.RingGeometry(0.075, 0.093, 32);
    const hitGeometry = new THREE.SphereGeometry(0.18, 10, 8);
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

    (Object.keys(REGION_DATASETS) as RegionId[]).forEach((id) => {
      const region = REGION_DATASETS[id];
      const point = latLonToCartesian(region.center[0], region.center[1], EARTH_RADIUS * 1.008);
      const normal = new THREE.Vector3(point.x, point.y, point.z).normalize();
      const group = new THREE.Group();
      group.position.copy(normal.clone().multiplyScalar(EARTH_RADIUS * 1.008));
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const color = id === 'japan_gunw' ? 0xfb923c : 0x38d9ff;

      const core = new THREE.Mesh(
        coreGeometry,
        new THREE.MeshBasicMaterial({ color, depthTest: true })
      );
      core.position.y = 0.035;
      group.add(core);

      const ring = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.018;
      group.add(ring);

      const hitArea = new THREE.Mesh(hitGeometry, hitMaterial);
      hitArea.userData.regionId = id;
      group.add(hitArea);
      clickableTargets.push(hitArea);
      regionMarkers.push({ id, core, ring });
      earth.add(group);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const updatePointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    };
    const findRegion = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickableTargets, false)[0];
      return (hit?.object.userData.regionId as RegionId | undefined) ?? null;
    };
    const onPointerMove = (event: PointerEvent) => {
      const id = findRegion(event);
      if (id !== hoverRegionLocal) {
        hoverRegionLocal = id;
        setHoveredRegion(id);
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
        needsRender = true;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerDownPosition = { x: event.clientX, y: event.clientY };
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onPointerUp = (event: PointerEvent) => {
      renderer.domElement.style.cursor = hoverRegionLocal ? 'pointer' : 'grab';
      const movement = Math.hypot(
        event.clientX - pointerDownPosition.x,
        event.clientY - pointerDownPosition.y
      );
      if (movement > 7) return;
      const id = findRegion(event);
      if (id) startFlyTo(id, true);
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const startCameraMove = (end: THREE.Vector3, target: RegionId | null) => {
      flyState = { start: camera.position.clone(), end, startedAt: performance.now(), target };
      controls.enabled = false;
      needsRender = true;
    };
    const startFlyTo = (id: RegionId, openMap: boolean) => {
      const region = REGION_DATASETS[id];
      const destination = computeCameraPositionForLatLon(
        region.center[0],
        region.center[1],
        openMap ? MIN_CAMERA_DISTANCE : DEFAULT_CAMERA_DISTANCE
      );
      startCameraMove(new THREE.Vector3(destination.x, destination.y, destination.z), openMap ? id : null);
    };
    flyTriggerRef.current = (id) => startFlyTo(id, true);
    resetViewRef.current = () => {
      const destination = computeCameraPositionForLatLon(
        DEFAULT_CAMERA_LAT,
        DEFAULT_CAMERA_LON,
        getFitDistance(camera.aspect)
      );
      startCameraMove(new THREE.Vector3(destination.x, destination.y, destination.z), null);
    };
    zoomViewRef.current = (factor) => {
      const distance = THREE.MathUtils.clamp(
        camera.position.length() * factor,
        MIN_CAMERA_DISTANCE,
        MAX_CAMERA_DISTANCE
      );
      startCameraMove(camera.position.clone().normalize().multiplyScalar(distance), null);
    };
    setLayerRef.current = (layer, visible) => {
      if (layer === 'orbits') orbitRoot.visible = visible;
      if (layer === 'labels') labelSprites.forEach((sprite) => { sprite.visible = visible; });
      if (layer === 'clouds') earthUniforms.uCloudVisibility.value = visible ? 1 : 0;
      needsRender = true;
    };

    const resize = () => {
      if (isDisposed) return;
      const nextWidth = Math.max(1, container.clientWidth);
      const nextHeight = Math.max(1, container.clientHeight);
      const previousFitDistance = getFitDistance(camera.aspect);
      camera.aspect = nextWidth / nextHeight;
      if (!flyState && Math.abs(camera.position.length() - previousFitDistance) < 0.2) {
        camera.position.setLength(getFitDistance(camera.aspect));
      }
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight, false);
      needsRender = true;
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      lastFrameTime = performance.now();
    });
    intersectionObserver.observe(container);

    const animate = (now: number) => {
      if (isDisposed) return;
      rafId = window.requestAnimationFrame(animate);
      if (!isVisible || document.hidden) {
        lastFrameTime = now;
        return;
      }
      const delta = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      const controlsChanged = controls.update();
      const isMoving = isLiveRef.current || flyState !== null;
      if (!needsRender && !controlsChanged && !isMoving) return;
      if (now - lastRenderTime < (flyState ? 1000 / 60 : 1000 / 30) && !needsRender) return;

      if (isLiveRef.current) animationTime += delta;
      earthUniforms.uCloudOffset.value = animationTime * 0.0015;
      satelliteTracks.forEach((satellite) => {
        const angle = satellite.phase + animationTime * satellite.speed;
        satellite.marker.position.set(
          Math.cos(angle) * satellite.radius,
          Math.sin(angle) * satellite.radius,
          0
        );
        satellite.label.position.copy(satellite.marker.position);
        satellite.label.position.y += 0.13;
      });
      regionMarkers.forEach((marker, index) => {
        const active = marker.id === activeRegionRef.current || marker.id === hoverRegionLocal;
        const wave = (animationTime * 0.85 + index * 0.31) % 1;
        const scale = active ? 1.05 + wave * 0.85 : 1;
        marker.ring.scale.set(scale, scale, scale);
        marker.ring.material.opacity = active ? 0.9 - wave * 0.55 : 0.68;
        marker.core.scale.setScalar(active ? 1.18 : 1);
      });

      if (flyState) {
        const progress = Math.min((now - flyState.startedAt) / 520, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const direction = flyState.start.clone().normalize().lerp(flyState.end.clone().normalize(), eased).normalize();
        const distance = THREE.MathUtils.lerp(flyState.start.length(), flyState.end.length(), eased);
        camera.position.copy(direction.multiplyScalar(distance));
        camera.lookAt(0, 0, 0);
        if (progress === 1) {
          const target = flyState.target;
          flyState = null;
          controls.enabled = true;
          if (target) onSelectRef.current(target);
        }
      }

      renderer.render(scene, camera);
      lastRenderTime = now;
      needsRender = false;
    };
    rafId = window.requestAnimationFrame(animate);

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      flyTriggerRef.current = null;
      resetViewRef.current = null;
      zoomViewRef.current = null;
      setLayerRef.current = null;

      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>([
        earthUniforms.uEarthMap.value,
        earthUniforms.uCloudMap.value,
      ]);
      scene.traverse((object) => {
        if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) {
          geometries.add(object.geometry);
        }
        if ('material' in object) {
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((material) => {
            if (!(material instanceof THREE.Material)) return;
            materials.add(material);
            if (material instanceof THREE.SpriteMaterial && material.map) textures.add(material.map);
          });
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const toggleLayer = (layer: GlobeLayer) => {
    const visible = !layers[layer];
    setLayers((current) => ({ ...current, [layer]: visible }));
    setLayerRef.current?.(layer, visible);
  };

  const observedDate = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
  const hoveredMeta = hoveredRegion ? REGION_DATASETS[hoveredRegion] : null;

  return (
    <div className="relative overflow-hidden border border-[var(--rr-border)] bg-black">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#05080d] px-4 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <Satellite className="h-4 w-4 shrink-0 text-[#72d9ff]" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-[0.08em]">EYES ON EARTH</div>
            <div className="hidden font-mono text-[9px] uppercase tracking-[0.16em] text-white/45 sm:block">
              NISAR · Visible Earth
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => resetViewRef.current?.()}
          className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d9ff]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset view
        </button>
      </div>

      <div
        className="relative h-[430px] w-full overflow-hidden sm:h-[520px] lg:h-[570px]"
        style={{
          backgroundColor: '#010204',
          backgroundImage: [
            'radial-gradient(circle at 18% 28%, rgba(255,255,255,.65) 0 0.6px, transparent .9px)',
            'radial-gradient(circle at 74% 62%, rgba(185,220,255,.5) 0 0.7px, transparent 1px)',
            'radial-gradient(circle at 42% 84%, rgba(255,255,255,.35) 0 0.5px, transparent .9px)',
            'radial-gradient(ellipse at 50% 48%, #071221 0%, #02050a 48%, #000 100%)',
          ].join(','),
          backgroundSize: '83px 79px, 127px 113px, 59px 67px, 100% 100%',
        }}
      >
        {webglError ? (
          <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-white">
            {webglError}
          </div>
        ) : (
          <div ref={mountRef} data-testid="earth-globe-canvas" className="h-full w-full" />
        )}

        {isLoading && !webglError && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
            <span className="bg-black/65 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/65">
              Loading Earth imagery
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute left-4 top-4 font-mono text-[9px] uppercase tracking-[0.18em] text-white/55">
          {hoveredMeta ? `${hoveredMeta.shortName} · Select beacon` : isTransitioning ? 'Opening radar map…' : 'Low Earth orbit · Live simulation'}
        </div>

        <div className="absolute right-3 top-3 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
          <button
            type="button"
            onClick={() => setIsLive((value) => !value)}
            aria-label={isLive ? 'Pause satellite simulation' : 'Resume satellite simulation'}
            className={`inline-flex h-9 items-center gap-2 border px-3 font-mono text-[10px] font-bold tracking-[0.16em] backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d9ff] ${
              isLive
                ? 'border-[#168aad] bg-[#087f9e]/85 text-white hover:bg-[#087f9e]'
                : 'border-white/20 bg-black/65 text-white/65 hover:text-white'
            }`}
          >
            {isLive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {isLive ? 'LIVE' : 'PAUSED'}
          </button>
          <button
            type="button"
            onClick={() => setIsLayersOpen((value) => !value)}
            aria-label="Toggle globe layers"
            aria-expanded={isLayersOpen}
            className="inline-flex h-10 w-10 items-center justify-center border border-white/15 bg-[#0b2d50]/90 text-white backdrop-blur-sm transition-colors hover:bg-[#123f6b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d9ff]"
          >
            <Layers3 className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="mt-1 flex flex-col border border-white/15 bg-black/60 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => zoomViewRef.current?.(0.86)}
              aria-label="Zoom in on Earth"
              className="flex h-9 w-9 items-center justify-center text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d9ff]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => zoomViewRef.current?.(1.16)}
              aria-label="Zoom out from Earth"
              className="flex h-9 w-9 items-center justify-center border-t border-white/15 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d9ff]"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isLayersOpen && (
          <div className="absolute right-16 top-16 w-48 border border-white/15 bg-[#050a12]/95 p-3 text-white shadow-2xl backdrop-blur-md sm:right-20 sm:top-20">
            <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/60">Globe layers</span>
              <button
                type="button"
                onClick={() => setIsLayersOpen(false)}
                aria-label="Close globe layers"
                className="text-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#72d9ff]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              {(['orbits', 'labels', 'clouds'] as GlobeLayer[]).map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => toggleLayer(layer)}
                  aria-pressed={layers[layer]}
                  className="flex w-full items-center justify-between px-1 py-2 text-left text-xs capitalize text-white/80 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#72d9ff]"
                >
                  <span>{layer === 'orbits' ? 'Satellite orbits' : layer === 'labels' ? 'Satellite labels' : 'Cloud cover'}</span>
                  <span className={`h-2 w-2 rounded-full ${layers[layer] ? 'bg-[#72d9ff] shadow-[0_0_8px_#72d9ff]' : 'bg-white/20'}`} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-4 left-4 text-white sm:bottom-5 sm:left-5">
          <div className="flex items-center gap-2.5">
            <span className="text-xl font-medium tracking-[-0.02em] sm:text-2xl">Visible Earth</span>
            <button
              type="button"
              onClick={() => setIsLayersOpen((value) => !value)}
              aria-label="Open Visible Earth layers"
              className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#1674d1] text-white transition-colors hover:bg-[#2589e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-white/70 sm:text-xs">Observed on {observedDate}</div>
          <div className="mt-2 hidden font-mono text-[9px] uppercase tracking-[0.14em] text-white/40 sm:block">
            Drag to rotate · Scroll to zoom · Select a glowing beacon
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 right-4 border border-white/10 bg-black/55 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[#72d9ff] backdrop-blur-sm sm:bottom-5 sm:right-5">
          3 study areas
        </div>
      </div>

      <div className="sr-only">
        {(Object.keys(REGION_DATASETS) as RegionId[]).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`globe-pin-${id}`}
            onClick={() => flyTriggerRef.current?.(id)}
          >
            Focus {REGION_DATASETS[id].shortName}
          </button>
        ))}
      </div>
    </div>
  );
}
