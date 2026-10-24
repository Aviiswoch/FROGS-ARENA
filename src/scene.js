import * as THREE from 'three';

const GRID_SIZE = 40;
const TILE = 1.04;
const MAX_INSECTS = GRID_SIZE * GRID_SIZE;
const HOP_COOLDOWN = 1;
const HOP_DURATION = 0.68;
const BASE_SCALE = 0.55;
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
};

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
const cameraOffset = new THREE.Vector3(7.8, 10.5, 9.5);
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

const world = new THREE.Group();
scene.add(world);
const dummy = new THREE.Object3D();
let seed = 7241;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const clamp = THREE.MathUtils.clamp;

// Flush tile tops preserve the checker pattern without artificial boundary lines.
const tiles = new THREE.InstancedMesh(
  new THREE.BoxGeometry(TILE + 0.006, 0.18, TILE + 0.006),
  new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
  MAX_INSECTS,
);
tiles.receiveShadow = true;
const lightGrass = new THREE.Color('#83b94f');
const darkGrass = new THREE.Color('#70a443');
let tileIndex = 0;
for (let z = 0; z < GRID_SIZE; z++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    dummy.position.set(x * TILE, -0.1, z * TILE);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    tiles.setMatrixAt(tileIndex, dummy.matrix);
    const color = ((x + z) % 2 === 0 ? lightGrass : darkGrass).clone();
    color.offsetHSL(0, 0, ((x * 17 + z * 31) % 7) * 0.003);
    tiles.setColorAt(tileIndex, color);
    tileIndex++;
  }
}
tiles.instanceMatrix.needsUpdate = true;
tiles.instanceColor.needsUpdate = true;
world.add(tiles);

const earth = new THREE.Mesh(
  new THREE.BoxGeometry(GRID_SIZE * TILE + 0.25, 0.5, GRID_SIZE * TILE + 0.25),
  new THREE.MeshStandardMaterial({ color: '#527b38', roughness: 1, flatShading: true }),
);
earth.position.set((GRID_SIZE - 1) * TILE / 2, -0.42, (GRID_SIZE - 1) * TILE / 2);
earth.receiveShadow = true;
world.add(earth);

// Thousands of angular blades make the tiles read as soft 3D grass rather than flat boxes.
const tuftCount = 1800;
const tufts = new THREE.InstancedMesh(
  new THREE.ConeGeometry(0.045, 0.2, 3),
  new THREE.MeshStandardMaterial({ color: '#568e3c', roughness: 1, flatShading: true }),
  tuftCount,
);
for (let i = 0; i < tuftCount; i++) {
  const x = Math.floor(random() * GRID_SIZE);
  const z = Math.floor(random() * GRID_SIZE);
  dummy.position.set(x * TILE + (random() - .5) * .82, .08, z * TILE + (random() - .5) * .82);
  dummy.rotation.set((random() - .5) * .2, random() * Math.PI, (random() - .5) * .28);
  dummy.scale.set(.65 + random() * .65, .55 + random() * .9, .65 + random() * .65);
  dummy.updateMatrix();
  tufts.setMatrixAt(i, dummy.matrix);
}
world.add(tufts);

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
  paused: false, muted: false, currentScale: BASE_SCALE, targetScale: BASE_SCALE,
  zoom: 1, manualZoom: 1, zoomTarget: 1, frogsEaten: 0,
  boostUntil: 0, boosterCooldown: 0, nextBoosterCheck: 0,
};
const panOffset = new THREE.Vector3();
let minZoom = .16;
frog.position.set(state.x * TILE, 0, state.z * TILE);
frog.rotation.y = Math.PI;
frogVisual.scale.setScalar(BASE_SCALE);
frogShadow.position.set(frog.position.x, .015, frog.position.z);

let audioContext;
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
  crown.visible = blackForm;
  scary.visible = blackForm;
  eyeWhite.color.set(blackForm ? '#e74736' : '#edf2c5');
  pupilMaterial.color.set(blackForm ? '#fff0a3' : '#172b1d');
  pupilMaterial.emissive.set(blackForm ? '#b92e20' : '#000000');
  pupilMaterial.emissiveIntensity = blackForm ? .65 : 0;
  return changed ? palette.name : null;
}

function growPlayer(kind = 'insects') {
  state.growth++;
  state.targetScale *= 1.1;
  updateAutoZoom();
  const transformation = updatePlayerPalette();
  if (transformation) {
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
  const visual = root.children[0];
  visual.scale.setScalar(1);
  world.add(root);
  const shadow = makeShadow();
  const ai = {
    root, visual, shadow, skinClones, x: 0, z: 0, alive: true, jump: null,
    currentScale: .34 + i * .035, targetScale: .34 + i * .035,
    score: 0, nextInsectGrowth: 10, nextHop: 0, respawnAt: 0,
  };
  visual.scale.setScalar(ai.currentScale);
  aiFrogs.push(ai);
  spawnAi(ai, true);
}

function updateAi(ai, dt) {
  if (!ai.alive) {
    if (state.gameTime >= ai.respawnAt) spawnAi(ai);
    return;
  }
  if (!ai.jump && state.gameTime >= ai.nextHop) {
    const options = Object.entries(directionData).filter(([, d]) => ai.x + d.x >= 0 && ai.x + d.x < GRID_SIZE && ai.z + d.z >= 0 && ai.z + d.z < GRID_SIZE);
    const [direction, data] = options[Math.floor(random() * options.length)];
    const nextX = ai.x + data.x;
    const nextZ = ai.z + data.z;
    ai.jump = { fromX: ai.x * TILE, fromZ: ai.z * TILE, toX: nextX * TILE, toZ: nextZ * TILE, start: state.gameTime };
    ai.x = nextX;
    ai.z = nextZ;
    ai.root.rotation.y = data.rotation;
    ai.nextHop = state.gameTime + 1.25 + random() * 1.4;
  }
  if (ai.jump) {
    const t = Math.min((state.gameTime - ai.jump.start) / HOP_DURATION, 1);
    const eased = t * t * (3 - 2 * t);
    ai.root.position.x = THREE.MathUtils.lerp(ai.jump.fromX, ai.jump.toX, eased);
    ai.root.position.z = THREE.MathUtils.lerp(ai.jump.fromZ, ai.jump.toZ, eased);
    ai.root.position.y = reducedMotion ? 0 : Math.sin(t * Math.PI) * .55;
    if (t >= 1) {
      ai.root.position.set(ai.jump.toX, 0, ai.jump.toZ);
      ai.jump = null;
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
  ai.respawnAt = state.gameTime + 18;
  state.frogsEaten++;
  burstAt(ai.root.position.x, ai.root.position.z, true);
  growPlayer('frog');
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
  for (const [direction, data] of Object.entries(directionData)) {
    const projected = frog.position.clone().add(new THREE.Vector3(data.x, 0, data.z)).project(camera);
    const vx = projected.x - origin.x;
    const vy = -(projected.y - origin.y);
    const dot = (vx * dx + vy * dy) / (Math.hypot(vx, vy) * length);
    if (dot > bestDot) { bestDot = dot; bestDirection = direction; }
  }
  return bestDirection;
}
const keySwipes = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
window.addEventListener('keydown', (event) => {
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
let pointerStartedAt = 0;
let panning = false;
let panMoveCount = 0;
const panStartOffset = new THREE.Vector3();
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
    pointerStartedAt = event.timeStamp;
    panStartOffset.copy(panOffset);
    panMoveCount = 0;
    panning = false;
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
  if (pointers.size === 1 && swipeStart) {
    const totalDistance = Math.hypot(event.clientX - swipeStart.x, event.clientY - swipeStart.y);
    panMoveCount++;
    if (!panning && panMoveCount >= 2 && totalDistance > 10 && event.timeStamp - pointerStartedAt > 300) panning = true;
    if (panning) panCamera(event.clientX - previous.x, event.clientY - previous.y);
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
    const duration = event.timeStamp - pointerStartedAt;
    swipeStart = null;
    panning = false;
    if ((!wasPanning || duration < 500) && Math.max(Math.abs(dx), Math.abs(dy)) >= 24) {
      if (wasPanning) panOffset.copy(panStartOffset);
      requestHop(directionFromSwipe(dx, dy));
    }
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
  const cooling = Boolean(state.jump) || state.gameTime < state.nextHop;
  const boosted = state.gameTime < state.boostUntil;
  ui.ready.classList.toggle('cooling', cooling && !boosted);
  ui.ready.classList.toggle('boosted', boosted);
  ui.ready.lastChild.textContent = boosted ? ' 2× SPEED' : cooling ? ' RECHARGING' : ' READY TO HOP';
  renderer.render(scene, camera);
  if (firstFrame) {
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
    boostRemaining: Math.max(0, state.boostUntil - state.gameTime), boosterActive: Boolean(booster),
    pan: { x: panOffset.x, z: panOffset.z },
  }),
  hop: requestHop,
  swipe: (dx, dy) => requestHop(directionFromSwipe(dx, dy)),
  zoom: setZoom,
};
