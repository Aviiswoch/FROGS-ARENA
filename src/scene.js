import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GRID_SIZE = 40;
const TILE = 1.04;
const MAX_INSECTS = GRID_SIZE * GRID_SIZE;
const HOP_COOLDOWN = 1;
const HOP_DURATION = 0.68;
const BASE_SCALE = 0.55;
const MAX_FROG_SCALE = 12;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = {
  scene: document.querySelector('#scene'),
  toast: document.querySelector('#toast'),
  hint: document.querySelector('#hint'),
  ready: document.querySelector('#ready-indicator'),
  loading: document.querySelector('#loading'),
  pauseButton: document.querySelector('#pause-btn'),
  pauseOverlay: document.querySelector('#pause-overlay'),
  soundButton: document.querySelector('#sound-btn'),
  nameLayer: document.querySelector('#name-layer'),
  winnerOverlay: document.querySelector('#winner-overlay'),
};
document.querySelector('#winner-restart-btn').addEventListener('click', () => window.location.reload());

const scene = new THREE.Scene();
scene.background = new THREE.Color('#78a957');
scene.fog = new THREE.Fog('#78a957', 24, 70);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
ui.scene.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-hidden', 'true');

const camera = new THREE.OrthographicCamera(-4, 4, 6, -6, 0.1, 100);
const cameraOffset = new THREE.Vector3(12, 12, 12);
const cameraFocus = new THREE.Vector3(20, 0, 20);
camera.position.copy(cameraFocus).add(cameraOffset);
camera.lookAt(cameraFocus);

scene.add(new THREE.HemisphereLight('#eff8cf', '#31562d', 2.3));
const sun = new THREE.DirectionalLight('#fff3c4', 3.2);
sun.position.set(9, 18, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 45 });
sun.shadow.bias = -0.001;
scene.add(sun, sun.target);
const frogRimLight = new THREE.DirectionalLight('#dfffbf', 1.35);
frogRimLight.position.set(-5, 7, -4);
scene.add(frogRimLight, frogRimLight.target);

const world = new THREE.Group();
scene.add(world);
const dummy = new THREE.Object3D();
let seed = 7241;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const clamp = THREE.MathUtils.clamp;

// The gameplay matrix remains 40x40; only its visual ground is replaced by the painted board.
let groundReady = false;
const groundMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE * TILE, GRID_SIZE * TILE), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.set((GRID_SIZE - 1) * TILE / 2, -.025, (GRID_SIZE - 1) * TILE / 2);
ground.receiveShadow = true;
world.add(ground);
new THREE.TextureLoader().load('/images/arena-grass.jpg', (texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy());
  groundMaterial.map = texture;
  groundMaterial.needsUpdate = true;
  groundReady = true;
}, undefined, () => {
  groundMaterial.color.set('#668d3f');
  groundReady = true;
});

// A low-poly city park: iron fence, sidewalks, four roads, gardens, towers and moving taxis.
const city = new THREE.Group();
world.add(city);
const CITY_CENTER = (GRID_SIZE - 1) * TILE / 2;
const HALF_ARENA = GRID_SIZE * TILE / 2;
const cityMaterials = {
  iron: new THREE.MeshStandardMaterial({ color: '#263c35', roughness: .72, metalness: .35, flatShading: true }),
  sidewalk: new THREE.MeshStandardMaterial({ color: '#a8aa96', roughness: 1 }),
  road: new THREE.MeshStandardMaterial({ color: '#3f4747', roughness: 1 }),
  stripe: new THREE.MeshBasicMaterial({ color: '#e8d786' }),
  trunk: new THREE.MeshStandardMaterial({ color: '#70513a', roughness: 1, flatShading: true }),
  leaves: new THREE.MeshStandardMaterial({ color: '#477b43', roughness: 1, flatShading: true }),
  taxi: new THREE.MeshStandardMaterial({ color: '#edbd32', roughness: .65, flatShading: true }),
  taxiGlass: new THREE.MeshStandardMaterial({ color: '#8fb6b4', roughness: .35, flatShading: true }),
  rubber: new THREE.MeshStandardMaterial({ color: '#252b29', roughness: 1 }),
};
function cityBox(width, height, depth, material, x, y, z, parent = city) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
cityBox(GRID_SIZE * TILE + 3, .18, GRID_SIZE * TILE + 3, cityMaterials.sidewalk, CITY_CENTER, -.25, CITY_CENTER);
const roadOffset = HALF_ARENA + 4.2;
const roadLength = GRID_SIZE * TILE + 24;
for (const side of [-1, 1]) {
  cityBox(roadLength, .12, 5.5, cityMaterials.road, CITY_CENTER, -.22, CITY_CENTER + side * roadOffset);
  cityBox(5.5, .12, roadLength, cityMaterials.road, CITY_CENTER + side * roadOffset, -.22, CITY_CENTER);
}
const dashCount = 56;
const roadDashes = new THREE.InstancedMesh(new THREE.BoxGeometry(.85, .025, .09), cityMaterials.stripe, dashCount);
for (let i = 0; i < dashCount; i++) {
  const lane = Math.floor(i / 14);
  const along = CITY_CENTER - 25 + (i % 14) * 3.85;
  const vertical = lane >= 2;
  const side = lane % 2 === 0 ? -1 : 1;
  dummy.position.set(vertical ? CITY_CENTER + side * roadOffset : along, -.145, vertical ? along : CITY_CENTER + side * roadOffset);
  dummy.rotation.set(0, vertical ? Math.PI / 2 : 0, 0);
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  roadDashes.setMatrixAt(i, dummy.matrix);
}
city.add(roadDashes);
const fenceExtent = HALF_ARENA + .7;
const fencePosts = new THREE.InstancedMesh(new THREE.BoxGeometry(.1, 1.05, .1), cityMaterials.iron, 88);
let postIndex = 0;
for (let side = 0; side < 4; side++) {
  for (let i = 0; i < 22; i++) {
    const along = CITY_CENTER - HALF_ARENA + i * (GRID_SIZE * TILE / 21);
    const vertical = side >= 2;
    const sign = side % 2 === 0 ? -1 : 1;
    dummy.position.set(vertical ? CITY_CENTER + sign * fenceExtent : along, .45, vertical ? along : CITY_CENTER + sign * fenceExtent);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    fencePosts.setMatrixAt(postIndex++, dummy.matrix);
  }
}
city.add(fencePosts);
for (const side of [-1, 1]) {
  for (const height of [.25, .78]) {
    cityBox(GRID_SIZE * TILE + 1.4, .07, .07, cityMaterials.iron, CITY_CENTER, height, CITY_CENTER + side * fenceExtent);
    cityBox(.07, .07, GRID_SIZE * TILE + 1.4, cityMaterials.iron, CITY_CENTER + side * fenceExtent, height, CITY_CENTER);
  }
}
const treePositions = [];
for (let i = 0; i < 36; i++) {
  const side = i % 4;
  const along = CITY_CENTER - 23 + Math.floor(i / 4) * 5.7;
  const sign = side % 2 === 0 ? -1 : 1;
  const offset = HALF_ARENA + 8.4;
  treePositions.push(side < 2 ? [along, CITY_CENTER + sign * offset] : [CITY_CENTER + sign * offset, along]);
}
const treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.16, .22, 1.5, 6), cityMaterials.trunk, treePositions.length);
const treeCrowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.05, 1), cityMaterials.leaves, treePositions.length);
treePositions.forEach(([x, z], i) => {
  dummy.position.set(x, .55, z); dummy.rotation.set(0, random() * Math.PI, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); treeTrunks.setMatrixAt(i, dummy.matrix);
  dummy.position.set(x, 1.85, z); dummy.scale.set(.8 + random() * .45, .85 + random() * .5, .8 + random() * .45); dummy.updateMatrix(); treeCrowns.setMatrixAt(i, dummy.matrix);
  treeCrowns.setColorAt(i, new THREE.Color(i % 3 === 0 ? '#5d8c48' : '#3f7540'));
});
treeCrowns.instanceColor.needsUpdate = true;
city.add(treeTrunks, treeCrowns);
const buildingColors = ['#8b7968', '#77858a', '#9b866d', '#6f787b', '#a0927e'];
const windowTransforms = [];
for (let side = 0; side < 4; side++) {
  for (let i = 0; i < 5; i++) {
    const along = CITY_CENTER - 22 + i * 11;
    const sign = side % 2 === 0 ? -1 : 1;
    const offset = HALF_ARENA + 14 + (i % 2) * 2;
    const x = side < 2 ? along : CITY_CENTER + sign * offset;
    const z = side < 2 ? CITY_CENTER + sign * offset : along;
    const width = 5 + (i % 2);
    const depth = 5 + ((i + 1) % 2);
    const height = 6 + ((i * 7 + side * 3) % 11);
    const material = new THREE.MeshStandardMaterial({ color: buildingColors[(i + side) % buildingColors.length], roughness: .95, flatShading: true });
    cityBox(width, height, depth, material, x, height / 2 - .2, z);
    cityBox(width * .55, .5, depth * .55, cityMaterials.sidewalk, x, height + .05, z);
    if (i % 2 === 0) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(.65, .65, 1.2, 8), cityMaterials.trunk);
      tank.position.set(x, height + .85, z);
      city.add(tank);
    }
    for (let floor = 0; floor < Math.floor(height / 1.5); floor++) {
      for (let column = -1; column <= 1; column++) {
        windowTransforms.push({ x, z, y: 1 + floor * 1.45, column, side, width, depth });
      }
    }
  }
}
const cityWindows = new THREE.InstancedMesh(new THREE.BoxGeometry(.48, .58, .035), new THREE.MeshBasicMaterial({ color: '#d7d59b' }), windowTransforms.length);
windowTransforms.forEach((window, i) => {
  const frontSign = window.side % 2 === 0 ? 1 : -1;
  if (window.side < 2) {
    dummy.position.set(window.x + window.column * 1.25, window.y, window.z + frontSign * (window.depth / 2 + .02));
    dummy.rotation.set(0, 0, 0);
  } else {
    dummy.position.set(window.x + frontSign * (window.width / 2 + .02), window.y, window.z + window.column * 1.25);
    dummy.rotation.set(0, Math.PI / 2, 0);
  }
  dummy.scale.set(1, 1, 1); dummy.updateMatrix(); cityWindows.setMatrixAt(i, dummy.matrix);
});
city.add(cityWindows);
const taxis = [];
for (let i = 0; i < 10; i++) {
  const group = new THREE.Group();
  cityBox(.85, .32, 1.55, cityMaterials.taxi, 0, .22, 0, group);
  cityBox(.68, .3, .78, cityMaterials.taxiGlass, 0, .5, -.05, group);
  cityBox(.9, .12, .12, cityMaterials.rubber, 0, .17, .73, group);
  cityBox(.9, .12, .12, cityMaterials.rubber, 0, .17, -.73, group);
  city.add(group);
  const vertical = i % 2 === 1;
  const side = i % 4 < 2 ? -1 : 1;
  taxis.push({ group, vertical, side, progress: random() * 58 - 29, speed: 1.5 + random() * 1.4 });
}
function updateCity(dt) {
  for (const taxi of taxis) {
    taxi.progress += dt * taxi.speed * taxi.side;
    if (taxi.progress > 31) taxi.progress = -31;
    if (taxi.progress < -31) taxi.progress = 31;
    const along = CITY_CENTER + taxi.progress;
    const lane = CITY_CENTER + (taxi.vertical ? taxi.side : -taxi.side) * (roadOffset + 1.25);
    taxi.group.position.set(taxi.vertical ? lane : along, -.1, taxi.vertical ? along : lane);
    taxi.group.rotation.y = taxi.vertical ? (taxi.side > 0 ? 0 : Math.PI) : (taxi.side > 0 ? -Math.PI / 2 : Math.PI / 2);
  }
}

// One instanced beetle per tile; eaten insects are hidden in place.
const insectBody = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 6, 4),
  new THREE.MeshStandardMaterial({ color: '#40342a', roughness: .85, flatShading: true }),
  MAX_INSECTS,
);
const wingMaterial = new THREE.MeshStandardMaterial({ color: '#d49b3d', roughness: .7, flatShading: true });
const insectLeftWing = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), wingMaterial, MAX_INSECTS);
const insectRightWing = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), wingMaterial, MAX_INSECTS);
const insectMeshes = [insectBody, insectLeftWing, insectRightWing];
const insects = Array.from({ length: MAX_INSECTS }, () => ({ eaten: false }));
insectMeshes.forEach((mesh) => { mesh.receiveShadow = true; world.add(mesh); });

function setInsectMatrices(index, x, z, angle, visible = true) {
  const s = visible ? 1 : 0;
  dummy.position.set(x, .15, z);
  dummy.rotation.set(0, angle, 0);
  dummy.scale.set(.065 * s, .055 * s, .105 * s);
  dummy.updateMatrix();
  insectBody.setMatrixAt(index, dummy.matrix);
  for (let side = 0; side < 2; side++) {
    const direction = side === 0 ? -1 : 1;
    const localX = direction * .047;
    dummy.position.set(x + Math.cos(angle) * localX, .185, z - Math.sin(angle) * localX);
    dummy.rotation.set(0, angle + direction * .18, direction * .15);
    dummy.scale.set(.052 * s, .025 * s, .09 * s);
    dummy.updateMatrix();
    insectMeshes[side + 1].setMatrixAt(index, dummy.matrix);
  }
}
let insectIndex = 0;
for (let z = 0; z < GRID_SIZE; z++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    setInsectMatrices(insectIndex, x * TILE, z * TILE, random() * Math.PI * 2);
    insectIndex++;
  }
}
insectMeshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });

function frogMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: .88, flatShading: true });
}
const frog = new THREE.Group();
const frogVisual = new THREE.Group();
frog.add(frogVisual);
world.add(frog);
const frogSkin = frogMaterial('#a9d95c');
const frogLight = frogMaterial('#c5e879');
const frogDark = frogMaterial('#7cad46');
const frogSkinMaterials = [frogSkin, frogLight, frogDark];
const eyeWhite = frogMaterial('#edf2c5');
const pupilMaterial = frogMaterial('#172b1d');

function ellipsoid(material, position, scale, parent = frogVisual) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
ellipsoid(frogSkin, [0, .36, .05], [.43, .32, .5]);
ellipsoid(frogLight, [0, .31, -.25], [.32, .22, .29]);
ellipsoid(frogSkin, [0, .5, -.28], [.42, .3, .34]);
ellipsoid(frogLight, [0, .39, -.52], [.3, .12, .12]);
for (const side of [-1, 1]) {
  ellipsoid(frogDark, [side * .39, .25, .24], [.25, .2, .32]);
  const backFoot = ellipsoid(frogSkin, [side * .48, .1, .42], [.23, .075, .17]);
  backFoot.rotation.y = side * .35;
  ellipsoid(frogSkin, [side * .31, .18, -.36], [.09, .21, .09]);
  ellipsoid(frogDark, [side * .34, .065, -.5], [.14, .055, .16]);
  for (let toe = -1; toe <= 1; toe++) {
    const toeMesh = ellipsoid(frogDark, [side * .34 + toe * .07, .05, -.62], [.025, .025, .09]);
    toeMesh.rotation.y = toe * .25;
  }
  ellipsoid(frogSkin, [side * .265, .72, -.39], [.16, .18, .15]);
  ellipsoid(eyeWhite, [side * .265, .735, -.505], [.105, .115, .055]);
  ellipsoid(pupilMaterial, [side * .265, .74, -.555], [.047, .065, .025]);
  ellipsoid(eyeWhite, [side * .252, .77, -.578], [.014, .018, .009]);
}
const smileCurve = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(-.17, .42, -.618), new THREE.Vector3(0, .35, -.65), new THREE.Vector3(.17, .42, -.618),
);
frogVisual.add(new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 8, .012, 4, false), frogDark));

// The final form adds real geometry, not just a color swap.
const crown = new THREE.Group();
const crownMaterial = new THREE.MeshStandardMaterial({ color: '#f2bd3d', metalness: .45, roughness: .35, flatShading: true });
const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(.29, .31, .14, 8), crownMaterial);
crownBand.position.y = .02;
crown.add(crownBand);
for (let i = 0; i < 5; i++) {
  const angle = (i / 5) * Math.PI * 2;
  const spike = new THREE.Mesh(new THREE.ConeGeometry(.09, .3, 4), crownMaterial);
  spike.position.set(Math.cos(angle) * .23, .2, Math.sin(angle) * .23);
  crown.add(spike);
}
const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(.07), new THREE.MeshStandardMaterial({ color: '#e5483f', emissive: '#7b100c', emissiveIntensity: .5 }));
jewel.position.set(0, .02, -.3);
crown.add(jewel);
crown.position.set(0, 1.01, -.15);
crown.visible = false;
frogVisual.add(crown);

const scary = new THREE.Group();
const hornMaterial = new THREE.MeshStandardMaterial({ color: '#3b1719', roughness: .8, flatShading: true });
for (const side of [-1, 1]) {
  const horn = new THREE.Mesh(new THREE.ConeGeometry(.075, .38, 5), hornMaterial);
  horn.position.set(side * .37, .91, -.2);
  horn.rotation.z = side * -.48;
  scary.add(horn);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(.22, .045, .06), hornMaterial);
  brow.position.set(side * .25, .81, -.57);
  brow.rotation.z = side * .35;
  scary.add(brow);
}
scary.visible = false;
frogVisual.add(scary);
const placeholderParts = frogVisual.children.filter((child) => child !== crown && child !== scary);
let customModelReady = false;
let playerCustomMaterial = null;
const customPaletteTints = ['#ffffff', '#79a875', '#ef8980', '#c28be0', '#3b403b'];

function makeShadow() {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(.48, 20),
    new THREE.MeshBasicMaterial({ color: '#173c24', transparent: true, opacity: .26, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .015;
  world.add(shadow);
  return shadow;
}
const frogShadow = makeShadow();

const palettes = [
  { name: 'Green', colors: ['#a9d95c', '#c5e879', '#7cad46'] },
  { name: 'Dark green', colors: ['#4f913c', '#72ae4e', '#397632'] },
  { name: 'Red', colors: ['#c94f42', '#ed7a5f', '#8e302e'] },
  { name: 'Purple', colors: ['#8250a8', '#b87ac8', '#553071'] },
  { name: 'Crowned shadow', colors: ['#20231f', '#34382e', '#111511'] },
];
const state = {
  x: 20, z: 20, score: 0, nextInsectGrowth: 10, growth: 0, palette: 0,
  gameTime: 0, nextHop: 0, jump: null, queued: null, held: null,
  paused: false, won: false, muted: false, currentScale: BASE_SCALE, targetScale: BASE_SCALE,
  zoom: 1, manualZoom: 1, zoomTarget: 1, frogsEaten: 0,
  boostUntil: 0, boosterCooldown: 0, nextBoosterCheck: 0,
};
const panOffset = new THREE.Vector3();
let minZoom = .16;
frog.position.set(state.x * TILE, 0, state.z * TILE);
frog.rotation.y = Math.PI;
frogVisual.scale.setScalar(BASE_SCALE);
frogShadow.position.set(frog.position.x, .015, frog.position.z);
const playerName = document.createElement('span');
playerName.className = 'frog-name player';
playerName.textContent = 'YOU';
ui.nameLayer.appendChild(playerName);
const nameVector = new THREE.Vector3();
function positionName(label, root, scale, crownHeight = 1.35) {
  nameVector.copy(root.position);
  nameVector.y += scale * crownHeight + .3;
  nameVector.project(camera);
  const x = (nameVector.x * .5 + .5) * ui.scene.clientWidth;
  const y = (-nameVector.y * .5 + .5) * ui.scene.clientHeight;
  const visible = root.visible && nameVector.z > -1 && nameVector.z < 1 && x > -30 && x < ui.scene.clientWidth + 30 && y > -20 && y < ui.scene.clientHeight + 20;
  label.style.display = visible ? '' : 'none';
  if (visible) label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
}

let audioContext;
const distressAudio = new Audio('/audio/frog-distress.mp3');
distressAudio.preload = 'auto';
distressAudio.volume = .72;
function playTone(type) {
  if (state.muted) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.type = type === 'eat' ? 'sine' : 'triangle';
    const start = type === 'eat' ? 540 : type === 'grow' ? 260 : type === 'frog' ? 100 : 145;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(type === 'eat' ? 860 : type === 'grow' ? 620 : type === 'frog' ? 55 : 105, now + .14);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'grow' || type === 'frog' ? .11 : .05, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (type === 'grow' ? .32 : .18));
    oscillator.start(now);
    oscillator.stop(now + .35);
  } catch { /* Sound is optional. */ }
}
let toastTimeout;
function showToast(message, duration = 1400) {
  clearTimeout(toastTimeout);
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimeout = setTimeout(() => ui.toast.classList.remove('show'), duration);
}

const particles = [];
const particleGeometry = new THREE.IcosahedronGeometry(.045, 0);
const particleMaterials = ['#e9f6a2', '#d8ef72', '#f2c65e'].map((color) => new THREE.MeshBasicMaterial({ color }));
function burstAt(x, z, large = false) {
  if (reducedMotion) return;
  const count = large ? 15 : 8;
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(particleGeometry, particleMaterials[i % particleMaterials.length]);
    mesh.position.set(x, .25, z);
    mesh.scale.setScalar(large ? 1.5 : 1);
    world.add(mesh);
    const angle = (i / count) * Math.PI * 2;
    particles.push({ mesh, vx: Math.cos(angle) * (.5 + random()), vz: Math.sin(angle) * (.5 + random()), vy: .8 + random(), life: .65 });
  }
}

function updatePlayerPalette() {
  const growthRatio = state.targetScale / BASE_SCALE - 1;
  const nextPalette = Math.min(Math.floor(growthRatio / .8), palettes.length - 1);
  const changed = nextPalette !== state.palette;
  state.palette = nextPalette;
  const palette = palettes[nextPalette];
  frogSkinMaterials.forEach((material, index) => material.color.set(palette.colors[index]));
  const blackForm = nextPalette === palettes.length - 1;
  if (playerCustomMaterial) {
    playerCustomMaterial.color.set(customPaletteTints[nextPalette]);
    playerCustomMaterial.emissive.set(blackForm ? '#101510' : '#142008');
  }
  crown.visible = blackForm;
  scary.visible = blackForm;
  eyeWhite.color.set(blackForm ? '#e74736' : '#edf2c5');
  pupilMaterial.color.set(blackForm ? '#fff0a3' : '#172b1d');
  pupilMaterial.emissive.set(blackForm ? '#b92e20' : '#000000');
  pupilMaterial.emissiveIntensity = blackForm ? .65 : 0;
  return changed ? palette.name : null;
}

function growPlayer(kind = 'insects') {
  if (state.targetScale >= MAX_FROG_SCALE) return;
  state.growth++;
  state.targetScale = Math.min(MAX_FROG_SCALE, state.targetScale * 1.1);
  updateAutoZoom();
  const transformation = updatePlayerPalette();
  if (state.targetScale === MAX_FROG_SCALE) {
    showToast('Maximum size · 12 blocks', 1800);
  } else if (transformation) {
    showToast(transformation === 'Crowned shadow' ? 'Final form · Crowned shadow' : `${transformation} transformation`, 1900);
  } else {
    showToast(kind === 'frog' ? 'Smaller frog eaten · +10%' : '+10% growth');
  }
  playTone(kind === 'frog' ? 'frog' : 'grow');
}

// Consume every insect whose square intersects the frog's circular footprint.
function consumeInsectsAround(gridX, gridZ, scale, owner) {
  const worldX = gridX * TILE;
  const worldZ = gridZ * TILE;
  const radius = scale * .55;
  const reach = Math.ceil(radius / TILE) + 1;
  let eatenNow = 0;
  for (let z = Math.max(0, gridZ - reach); z <= Math.min(GRID_SIZE - 1, gridZ + reach); z++) {
    for (let x = Math.max(0, gridX - reach); x <= Math.min(GRID_SIZE - 1, gridX + reach); x++) {
      const index = z * GRID_SIZE + x;
      if (insects[index].eaten) continue;
      const centerX = x * TILE;
      const centerZ = z * TILE;
      const nearestX = clamp(worldX, centerX - TILE / 2, centerX + TILE / 2);
      const nearestZ = clamp(worldZ, centerZ - TILE / 2, centerZ + TILE / 2);
      if ((nearestX - worldX) ** 2 + (nearestZ - worldZ) ** 2 > radius ** 2) continue;
      insects[index].eaten = true;
      setInsectMatrices(index, centerX, centerZ, 0, false);
      eatenNow++;
    }
  }
  if (!eatenNow) return 0;
  insectMeshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  owner.score += eatenNow;
  burstAt(worldX, worldZ, eatenNow > 3);
  if (owner === state) {
    playTone('eat');
    while (state.score >= state.nextInsectGrowth) {
      state.nextInsectGrowth += 10;
      growPlayer('insects');
    }
    if (state.score === MAX_INSECTS) showToast('The whole meadow is yours!', 3500);
  } else {
    while (owner.score >= owner.nextInsectGrowth) {
      owner.nextInsectGrowth += 10;
      owner.targetScale *= 1.1;
    }
  }
  return eatenNow;
}

const directionData = {
  up: { x: 0, z: -1, rotation: 0 },
  down: { x: 0, z: 1, rotation: Math.PI },
  left: { x: -1, z: 0, rotation: Math.PI / 2 },
  right: { x: 1, z: 0, rotation: -Math.PI / 2 },
};

function tryHop(direction) {
  if (state.paused || !directionData[direction]) return false;
  if (state.jump || state.gameTime < state.nextHop) {
    state.queued = direction;
    return false;
  }
  const data = directionData[direction];
  const nextX = state.x + data.x;
  const nextZ = state.z + data.z;
  if (nextX < 0 || nextX >= GRID_SIZE || nextZ < 0 || nextZ >= GRID_SIZE) {
    showToast('The meadow ends here', 800);
    state.nextHop = state.gameTime + .25;
    return false;
  }
  const boosted = state.gameTime < state.boostUntil;
  state.jump = {
    fromX: state.x * TILE, fromZ: state.z * TILE, toX: nextX * TILE, toZ: nextZ * TILE,
    start: state.gameTime, duration: boosted ? HOP_DURATION / 2 : HOP_DURATION,
  };
  state.x = nextX;
  state.z = nextZ;
  state.nextHop = state.gameTime + (boosted ? HOP_COOLDOWN / 2 : HOP_COOLDOWN);
  state.queued = null;
  frog.rotation.y = data.rotation;
  playTone('hop');
  return true;
}
function requestHop(direction) {
  if (!state.paused) tryHop(direction);
}

// Rival frogs use the same detailed model with independent materials and AI state.
const aiFrogs = [];
const aiColors = ['#8fc94f', '#c0d75d', '#69aa48', '#a4c94a', '#7dbb56', '#b3cf62', '#6da54d'];
const aiNames = ['CROAK', 'HOPPER', 'LILY', 'JUMPY', 'BUBBLES', 'MOSS', 'RIBBIT'];
function randomAiTile() {
  let x, z;
  do {
    x = Math.floor(random() * GRID_SIZE);
    z = Math.floor(random() * GRID_SIZE);
  } while (Math.hypot(x - state.x, z - state.z) < 6);
  return { x, z };
}
function spawnAi(ai, initial = false) {
  const tile = randomAiTile();
  ai.x = tile.x;
  ai.z = tile.z;
  ai.root.position.set(tile.x * TILE, 0, tile.z * TILE);
  ai.root.visible = true;
  ai.shadow.visible = true;
  ai.alive = true;
  ai.jump = null;
  ai.nextHop = state.gameTime + (initial ? random() * 2 : 1);
  ai.respawnAt = 0;
}
for (let i = 0; i < 7; i++) {
  const root = frog.clone(true);
  const skinClones = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    const original = object.material;
    object.material = original.clone();
    object.castShadow = false;
    const skinIndex = frogSkinMaterials.indexOf(original);
    if (skinIndex >= 0) {
      object.material.color.set(aiColors[i]);
      if (skinIndex === 2) object.material.color.multiplyScalar(.72);
      if (skinIndex === 1) object.material.color.offsetHSL(0, 0, .08);
      skinClones.push(object.material);
    }
  });
  // Rivals never inherit the player's final-form accessories.
  root.traverse((object) => {
    if (object.geometry?.type === 'ConeGeometry' && object.position.y > .8) object.visible = false;
  });
  const label = document.createElement('span');
  label.className = 'frog-name';
  label.textContent = aiNames[i];
  ui.nameLayer.appendChild(label);
  const visual = root.children[0];
  visual.scale.setScalar(1);
  world.add(root);
  const shadow = makeShadow();
  const ai = {
    root, visual, shadow, label, skinClones, x: 0, z: 0, alive: true, jump: null,
    currentScale: .34 + i * .035, targetScale: .34 + i * .035,
    score: 0, nextInsectGrowth: 10, nextHop: 0, respawnAt: 0,
  };
  visual.scale.setScalar(ai.currentScale);
  aiFrogs.push(ai);
  spawnAi(ai, true);
}

const MODEL_FORWARD_OFFSET = Math.PI / 2;
function enhanceFrogMaterial(source) {
  const material = source.clone();
  material.metalness = .04;
  material.roughness = .72;
  material.envMapIntensity = 1.1;
  material.emissive.set('#142008');
  material.emissiveIntensity = .11;
  if (material.normalMap) material.normalScale.set(.45, .45);
  if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  material.needsUpdate = true;
  return material;
}
new GLTFLoader().load('/models/Verdant_Frog_Guardian.glb', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const normalize = 1.18 / size.x;
  model.scale.setScalar(normalize);
  model.position.set(-center.x * normalize, -bounds.min.y * normalize, -center.z * normalize);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.material = enhanceFrogMaterial(object.material);
    object.castShadow = true;
    object.receiveShadow = true;
  });
  const container = new THREE.Group();
  container.name = 'VerdantFrogGuardian';
  container.rotation.y = MODEL_FORWARD_OFFSET;
  container.add(model);
  placeholderParts.forEach((part) => frogVisual.remove(part));
  frogVisual.add(container);
  playerCustomMaterial = model.children.find((child) => child.isMesh)?.material || null;
  model.traverse((object) => { if (object.isMesh && !playerCustomMaterial) playerCustomMaterial = object.material; });

  aiFrogs.forEach((ai, index) => {
    ai.visual.clear();
    const rivalModel = container.clone(true);
    rivalModel.traverse((object) => {
      if (!object.isMesh) return;
      object.material = enhanceFrogMaterial(object.material);
      object.material.color.set(aiColors[index]).lerp(new THREE.Color('#ffffff'), .48);
      object.castShadow = false;
    });
    ai.visual.add(rivalModel);
  });
  customModelReady = true;
  updatePlayerPalette();
}, undefined, () => {
  // The complete procedural frog remains as an offline fallback.
  customModelReady = true;
});

function updateAi(ai, dt) {
  if (!ai.alive) return;
  if (!ai.jump && state.gameTime >= ai.nextHop) {
    const options = Object.entries(directionData).filter(([, d]) => ai.x + d.x >= 0 && ai.x + d.x < GRID_SIZE && ai.z + d.z >= 0 && ai.z + d.z < GRID_SIZE);
    const [direction, data] = options[Math.floor(random() * options.length)];
    const nextX = ai.x + data.x;
    const nextZ = ai.z + data.z;
    ai.jump = { fromX: ai.x * TILE, fromZ: ai.z * TILE, toX: nextX * TILE, toZ: nextZ * TILE, start: state.gameTime };
    ai.x = nextX;
    ai.z = nextZ;
    // Local forward is -Z: face the velocity vector before leaving the ground.
    ai.root.rotation.y = Math.atan2(-data.x, -data.z);
    ai.nextHop = state.gameTime + 1.25 + random() * 1.4;
  }
  if (ai.jump) {
    const t = Math.min((state.gameTime - ai.jump.start) / HOP_DURATION, 1);
    const eased = t * t * (3 - 2 * t);
    ai.root.position.x = THREE.MathUtils.lerp(ai.jump.fromX, ai.jump.toX, eased);
    ai.root.position.z = THREE.MathUtils.lerp(ai.jump.fromZ, ai.jump.toZ, eased);
    ai.root.position.y = reducedMotion ? 0 : Math.sin(t * Math.PI) * .55;
    ai.visual.rotation.x = reducedMotion ? 0 : -Math.sin(t * Math.PI) * .16;
    if (t >= 1) {
      ai.root.position.set(ai.jump.toX, 0, ai.jump.toZ);
      ai.jump = null;
      ai.visual.rotation.x = 0;
      consumeInsectsAround(ai.x, ai.z, ai.currentScale, ai);
    }
  }
  ai.currentScale = THREE.MathUtils.damp(ai.currentScale, ai.targetScale, 5, dt);
  ai.visual.scale.setScalar(ai.currentScale);
  ai.shadow.position.set(ai.root.position.x, .015, ai.root.position.z);
  ai.shadow.scale.setScalar(ai.currentScale / BASE_SCALE * (1 - ai.root.position.y * .3));
}

function eatRival(ai) {
  ai.alive = false;
  ai.root.visible = false;
  ai.shadow.visible = false;
  ai.label.style.display = 'none';
  state.frogsEaten++;
  burstAt(ai.root.position.x, ai.root.position.z, true);
  if (!state.muted) {
    distressAudio.currentTime = 0;
    distressAudio.play().catch(() => {});
  }
  growPlayer('frog');
  if (aiFrogs.every((rival) => !rival.alive)) {
    state.won = true;
    setTimeout(() => {
      state.paused = true;
      ui.winnerOverlay.hidden = false;
      document.querySelector('#winner-restart-btn').focus();
    }, 650);
  }
}
function checkRivalCollisions() {
  for (const ai of aiFrogs) {
    if (!ai.alive || state.currentScale < ai.currentScale * 1.04) continue;
    const distance = Math.hypot(frog.position.x - ai.root.position.x, frog.position.z - ai.root.position.z);
    if (distance < (state.currentScale + ai.currentScale) * .43) eatRival(ai);
  }
}

// A distinctive firefly appears nearby only when every rival is at least 15 tiles away.
let booster = null;
const boosterBodyGeometry = new THREE.SphereGeometry(.11, 7, 5);
const boosterWingGeometry = new THREE.OctahedronGeometry(.12, 0);
const boosterBodyMaterial = new THREE.MeshStandardMaterial({ color: '#8ff7e8', emissive: '#29a9aa', emissiveIntensity: 1.2, flatShading: true });
const boosterWingMaterial = new THREE.MeshBasicMaterial({ color: '#f6e979', transparent: true, opacity: .85 });
function spawnBooster() {
  const angle = random() * Math.PI * 2;
  const distance = 2 + Math.floor(random() * 2);
  const x = clamp(state.x + Math.round(Math.cos(angle) * distance), 0, GRID_SIZE - 1);
  const z = clamp(state.z + Math.round(Math.sin(angle) * distance), 0, GRID_SIZE - 1);
  const group = new THREE.Group();
  const body = new THREE.Mesh(boosterBodyGeometry, boosterBodyMaterial);
  group.add(body);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(boosterWingGeometry, boosterWingMaterial);
    wing.position.x = side * .13;
    wing.scale.set(.8, .25, 1.25);
    group.add(wing);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.23, .018, 4, 16), new THREE.MeshBasicMaterial({ color: '#c8fff0' }));
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  group.position.set(x * TILE, .45, z * TILE);
  group.scale.setScalar(0);
  world.add(group);
  booster = { x, z, group, born: state.gameTime };
  showToast('A speed insect appeared nearby!', 1700);
}
function collectBooster() {
  if (!booster) return;
  world.remove(booster.group);
  booster = null;
  state.boostUntil = state.gameTime + 12;
  state.boosterCooldown = state.gameTime + 25;
  state.nextBoosterCheck = state.gameTime + 25;
  burstAt(state.x * TILE, state.z * TILE, true);
  showToast('Speed boost · Half-second hops!', 1900);
  playTone('grow');
}
function updateBooster() {
  if (!booster && state.gameTime >= state.nextBoosterCheck && state.gameTime >= state.boosterCooldown) {
    state.nextBoosterCheck = state.gameTime + 2;
    const distances = aiFrogs.filter((ai) => ai.alive).map((ai) => Math.hypot(ai.x - state.x, ai.z - state.z));
    const nearest = distances.length ? Math.min(...distances) : Infinity;
    if (nearest >= 15) spawnBooster();
  }
  if (!booster) return;
  const age = state.gameTime - booster.born;
  const emerge = Math.min(1, age * 3);
  booster.group.scale.setScalar(emerge * (1 + Math.sin(age * 5) * .08));
  booster.group.position.y = .45 + Math.sin(age * 4) * .09;
  booster.group.rotation.y += .035;
  const distance = Math.hypot(frog.position.x - booster.x * TILE, frog.position.z - booster.z * TILE);
  if (distance < state.currentScale * .55 + .22) collectBooster();
}

function setPaused(paused) {
  state.paused = paused;
  state.held = null;
  state.queued = null;
  ui.pauseOverlay.hidden = !paused;
  ui.pauseButton.setAttribute('aria-pressed', paused);
  ui.pauseButton.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  if (paused) document.querySelector('#resume-btn').focus();
  else ui.pauseButton.focus();
}
ui.pauseButton.addEventListener('click', () => setPaused(!state.paused));
document.querySelector('#resume-btn').addEventListener('click', () => setPaused(false));
document.querySelector('#restart-btn').addEventListener('click', () => window.location.reload());
ui.soundButton.addEventListener('click', () => {
  state.muted = !state.muted;
  distressAudio.muted = state.muted;
  ui.soundButton.setAttribute('aria-pressed', state.muted);
  ui.soundButton.setAttribute('aria-label', state.muted ? 'Enable sound' : 'Mute sound');
  if (!state.muted) playTone('eat');
});

// Convert vertical/horizontal gestures to the closest axis on the tilted ground.
function directionFromSwipe(dx, dy) {
  const origin = frog.position.clone().project(camera);
  let bestDirection = 'up';
  let bestDot = -Infinity;
  const length = Math.hypot(dx, dy) || 1;
  const preferredDirection = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'right' : 'left')
    : (dy >= 0 ? 'down' : 'up');
  for (const [direction, data] of Object.entries(directionData)) {
    const projected = frog.position.clone().add(new THREE.Vector3(data.x, 0, data.z)).project(camera);
    const vx = projected.x - origin.x;
    const vy = -(projected.y - origin.y);
    const dot = (vx * dx + vy * dy) / (Math.hypot(vx, vy) * length);
    const isPreferredTie = Math.abs(dot - bestDot) <= 1e-6 && direction === preferredDirection;
    if (dot > bestDot + 1e-6 || isPreferredTie) { bestDot = dot; bestDirection = direction; }
  }
  return bestDirection;
}
const keySwipes = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
window.addEventListener('keydown', (event) => {
  if (state.won) return;
  if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); setPaused(!state.paused); return; }
  const swipe = keySwipes[event.code];
  if (!swipe) return;
  event.preventDefault();
  const direction = directionFromSwipe(...swipe);
  state.held = direction;
  requestHop(direction);
});
window.addEventListener('keyup', (event) => {
  const swipe = keySwipes[event.code];
  if (swipe && directionFromSwipe(...swipe) === state.held) state.held = null;
});

function updateAutoZoom(immediate = false) {
  const baseWidth = camera.right - camera.left;
  minZoom = baseWidth / 32;
  // A heavy frog keeps four clear tiles on each side whenever the viewport allows it.
  const safetyZoom = state.targetScale < 1.2 ? 1 : clamp(baseWidth / (state.targetScale * 1.4 + 8), minZoom, 3);
  state.zoomTarget = clamp(Math.min(state.manualZoom, safetyZoom), minZoom, 3);
  if (immediate) {
    state.zoom = state.zoomTarget;
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
  }
}
function setZoom(value) {
  state.manualZoom = clamp(value, minZoom, 3);
  updateAutoZoom(true);
}
const pointers = new Map();
let swipeStart = null;
let pinchStart = null;
let panning = false;
let gestureMode = null;
function panCamera(dx, dy) {
  const worldPerPixel = (camera.top - camera.bottom) / state.zoom / renderer.domElement.clientHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  right.y = 0;
  up.y = 0;
  right.normalize();
  up.normalize();
  panOffset.addScaledVector(right, -dx * worldPerPixel);
  panOffset.addScaledVector(up, dy * worldPerPixel);
  const limit = GRID_SIZE * TILE / 2;
  panOffset.x = clamp(panOffset.x, -limit, limit);
  panOffset.z = clamp(panOffset.z, -limit, limit);
}
renderer.domElement.addEventListener('pointerdown', (event) => {
  renderer.domElement.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    swipeStart = { x: event.clientX, y: event.clientY };
    const bounds = renderer.domElement.getBoundingClientRect();
    const lowerHopZone = event.clientY - bounds.top >= bounds.height * .65;
    gestureMode = lowerHopZone ? 'hop' : 'pan';
    panning = !lowerHopZone;
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
    swipeStart = null;
    panning = false;
  }
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId)) return;
  const previous = pointers.get(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance > 5 && pinchStart.distance > 5) setZoom(pinchStart.zoom * distance / pinchStart.distance);
    return;
  }
  if (pointers.size === 1 && swipeStart && gestureMode === 'pan') {
    panCamera(event.clientX - previous.x, event.clientY - previous.y);
  }
});
function endPointer(event) {
  const wasPinching = Boolean(pinchStart);
  const wasPanning = panning;
  pointers.delete(event.pointerId);
  if (wasPinching) {
    if (pointers.size < 2) pinchStart = null;
    swipeStart = null;
    panning = false;
    return;
  }
  if (swipeStart && pointers.size === 0) {
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    const shouldHop = gestureMode === 'hop' && !wasPanning;
    swipeStart = null;
    panning = false;
    gestureMode = null;
    if (shouldHop && Math.max(Math.abs(dx), Math.abs(dy)) >= 24) requestHop(directionFromSwipe(dx, dy));
  }
}
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  setZoom(state.zoom * Math.exp(-event.deltaY * .001));
}, { passive: false });
document.addEventListener('visibilitychange', () => { if (document.hidden && !state.paused) setPaused(true); });

function resize() {
  const width = ui.scene.clientWidth;
  const height = ui.scene.clientHeight;
  renderer.setSize(width, height, false);
  const aspect = width / height;
  const frustumHeight = height < 690 ? 10.2 : 11.4;
  camera.left = -frustumHeight * aspect / 2;
  camera.right = frustumHeight * aspect / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
  camera.updateProjectionMatrix();
  updateAutoZoom(true);
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const targetFocus = new THREE.Vector3();
let firstFrame = true;
let hintChanged = false;
function animate() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, .05);
  if (!state.paused) {
    state.gameTime += rawDt;
    if (!state.jump && state.gameTime >= state.nextHop) {
      const nextDirection = state.queued || state.held;
      if (nextDirection) tryHop(nextDirection);
    }
    if (state.jump) {
      const jump = state.jump;
      const t = Math.min((state.gameTime - jump.start) / jump.duration, 1);
      const eased = t * t * (3 - 2 * t);
      frog.position.x = THREE.MathUtils.lerp(jump.fromX, jump.toX, eased);
      frog.position.z = THREE.MathUtils.lerp(jump.fromZ, jump.toZ, eased);
      frog.position.y = reducedMotion ? 0 : Math.sin(t * Math.PI) * .82;
      const stretch = reducedMotion ? 1 : 1 + Math.sin(t * Math.PI) * .11;
      frogVisual.scale.set(state.currentScale / Math.sqrt(stretch), state.currentScale * stretch, state.currentScale / Math.sqrt(stretch));
      if (t >= 1) {
        frog.position.set(jump.toX, 0, jump.toZ);
        state.jump = null;
        consumeInsectsAround(state.x, state.z, state.currentScale, state);
        if (!hintChanged) {
          hintChanged = true;
          ui.hint.textContent = 'Eat smaller frogs · Boosters give 2× speed';
          setTimeout(() => ui.hint.classList.add('hidden'), 6000);
        }
      }
    }
    state.currentScale = THREE.MathUtils.damp(state.currentScale, state.targetScale, 6, rawDt);
    if (!state.jump) frogVisual.scale.setScalar(state.currentScale);
    frogShadow.position.set(frog.position.x, .015, frog.position.z);
    frogShadow.scale.setScalar(state.currentScale / BASE_SCALE * (1 - frog.position.y * .35));
    frogShadow.material.opacity = .26 - frog.position.y * .12;
    aiFrogs.forEach((ai) => updateAi(ai, rawDt));
    checkRivalCollisions();
    updateBooster();
    updateCity(rawDt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.life -= dt;
      particle.vy -= 3.3 * dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      particle.mesh.rotation.x += dt * 5;
      particle.mesh.scale.setScalar(Math.max(0, particle.life / .65));
      if (particle.life <= 0) { world.remove(particle.mesh); particles.splice(i, 1); }
    }
  }
  if (Math.abs(state.zoom - state.zoomTarget) > .0001) {
    state.zoom = THREE.MathUtils.damp(state.zoom, state.zoomTarget, 4, rawDt);
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
  }
  targetFocus.set(frog.position.x + panOffset.x, .15, frog.position.z + panOffset.z);
  cameraFocus.lerp(targetFocus, 1 - Math.exp(-rawDt * 5));
  camera.position.copy(cameraFocus).add(cameraOffset);
  camera.lookAt(cameraFocus);
  sun.position.copy(cameraFocus).add(new THREE.Vector3(9, 18, 7));
  sun.target.position.copy(cameraFocus);
  sun.target.updateMatrixWorld();
  frogRimLight.position.copy(frog.position).add(new THREE.Vector3(-5, 7, -4));
  frogRimLight.target.position.copy(frog.position);
  frogRimLight.target.updateMatrixWorld();
  const cooling = Boolean(state.jump) || state.gameTime < state.nextHop;
  const boosted = state.gameTime < state.boostUntil;
  ui.ready.classList.toggle('cooling', cooling && !boosted);
  ui.ready.classList.toggle('boosted', boosted);
  ui.ready.lastChild.textContent = boosted ? ' 2× SPEED' : cooling ? ' RECHARGING' : ' READY TO HOP';
  positionName(playerName, frog, state.currentScale, state.palette === 4 ? 1.65 : 1.35);
  aiFrogs.forEach((ai) => positionName(ai.label, ai.root, ai.currentScale));
  renderer.render(scene, camera);
  if (firstFrame && customModelReady && groundReady) {
    firstFrame = false;
    ui.loading.classList.add('done');
    setTimeout(() => ui.loading.remove(), 450);
    window.__SCENE_READY__ = true;
  }
}
renderer.setAnimationLoop(animate);

window.__frogGame = {
  getState: () => ({
    x: state.x, z: state.z, score: state.score, growth: state.growth, palette: palettes[state.palette].name,
    size: state.currentScale, targetSize: state.targetScale, zoom: state.zoom, paused: state.paused,
    frogsEaten: state.frogsEaten, livingRivals: aiFrogs.filter((ai) => ai.alive).length,
    boostRemaining: Math.max(0, state.boostUntil - state.gameTime), boosterActive: Boolean(booster), customModelReady,
    pan: { x: panOffset.x, z: panOffset.z },
  }),
  hop: requestHop,
  swipe: (dx, dy) => requestHop(directionFromSwipe(dx, dy)),
  zoom: setZoom,
};
