import * as THREE from 'three';

const GRID_SIZE = 40;
const TILE = 1.04;
const HOP_COOLDOWN = 1;
const HOP_DURATION = 0.68;
const BASE_SCALE = 0.55;
const MAX_INSECTS = GRID_SIZE * GRID_SIZE;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = {
  scene: document.querySelector('#scene'),
  score: document.querySelector('#score'),
  size: document.querySelector('#size-label'),
  growthCount: document.querySelector('#growth-count'),
  growthFill: document.querySelector('#growth-fill'),
  growthProgress: document.querySelector('#growth-progress'),
  growthLabel: document.querySelector('#growth-label'),
  toast: document.querySelector('#toast'),
  hint: document.querySelector('#hint'),
  ready: document.querySelector('#ready-indicator'),
  loading: document.querySelector('#loading'),
  pauseButton: document.querySelector('#pause-btn'),
  pauseOverlay: document.querySelector('#pause-overlay'),
  soundButton: document.querySelector('#sound-btn'),
  moveButtons: [...document.querySelectorAll('.move-button')],
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#78a957');
scene.fog = new THREE.Fog('#78a957', 16, 34);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
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
sun.shadow.camera.left = -7;
sun.shadow.camera.right = 7;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -7;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 45;
sun.shadow.bias = -0.001;
scene.add(sun);
scene.add(sun.target);

const world = new THREE.Group();
scene.add(world);

const tileGeometry = new THREE.BoxGeometry(TILE - 0.025, 0.16, TILE - 0.025);
const tileMaterial = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true });
const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, MAX_INSECTS);
tiles.receiveShadow = true;
const dummy = new THREE.Object3D();
const lightGrass = new THREE.Color('#82b94f');
const darkGrass = new THREE.Color('#72a845');
let tileIndex = 0;
for (let z = 0; z < GRID_SIZE; z++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    dummy.position.set(x * TILE, -0.09, z * TILE);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    tiles.setMatrixAt(tileIndex, dummy.matrix);
    const variation = ((x * 17 + z * 31) % 7) * 0.008;
    const color = ((x + z) % 2 === 0 ? lightGrass : darkGrass).clone();
    color.offsetHSL(0, 0, variation);
    tiles.setColorAt(tileIndex, color);
    tileIndex++;
  }
}
tiles.instanceMatrix.needsUpdate = true;
tiles.instanceColor.needsUpdate = true;
world.add(tiles);

const earth = new THREE.Mesh(
  new THREE.BoxGeometry(GRID_SIZE * TILE + 0.3, 0.5, GRID_SIZE * TILE + 0.3),
  new THREE.MeshStandardMaterial({ color: '#527b38', roughness: 1, flatShading: true }),
);
earth.position.set((GRID_SIZE - 1) * TILE / 2, -0.4, (GRID_SIZE - 1) * TILE / 2);
earth.receiveShadow = true;
world.add(earth);

// Small angular grass tufts break up the tile surface without hiding the checkerboard.
const tuftCount = 420;
const tufts = new THREE.InstancedMesh(
  new THREE.ConeGeometry(0.055, 0.22, 3),
  new THREE.MeshStandardMaterial({ color: '#568e3c', roughness: 1, flatShading: true }),
  tuftCount,
);
let seed = 7241;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
for (let i = 0; i < tuftCount; i++) {
  const x = Math.floor(random() * GRID_SIZE);
  const z = Math.floor(random() * GRID_SIZE);
  dummy.position.set(x * TILE + (random() - .5) * .65, .1, z * TILE + (random() - .5) * .65);
  dummy.rotation.set((random() - .5) * .2, random() * Math.PI, (random() - .5) * .25);
  dummy.scale.setScalar(.65 + random() * .65);
  dummy.updateMatrix();
  tufts.setMatrixAt(i, dummy.matrix);
}
world.add(tufts);

// Every tile owns one low-poly beetle. Three instanced draws render the full population.
const insectBody = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 6, 4),
  new THREE.MeshStandardMaterial({ color: '#40342a', roughness: .85, flatShading: true }),
  MAX_INSECTS,
);
const insectWingMaterial = new THREE.MeshStandardMaterial({ color: '#d49b3d', roughness: .7, flatShading: true });
const insectLeftWing = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), insectWingMaterial, MAX_INSECTS);
const insectRightWing = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 3), insectWingMaterial, MAX_INSECTS);
const insects = [];
const insectMeshes = [insectBody, insectLeftWing, insectRightWing];
insectMeshes.forEach((mesh) => { mesh.castShadow = false; mesh.receiveShadow = true; world.add(mesh); });

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
    const angle = random() * Math.PI * 2;
    setInsectMatrices(insectIndex, x * TILE, z * TILE, angle);
    insects.push({ eaten: false });
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
const originalColors = frogSkinMaterials.map((mat) => mat.color.clone());
const grownColors = ['#4f913c', '#72ae4e', '#397632'].map((c) => new THREE.Color(c));
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
// Wide folded hind legs and splayed feet make the silhouette unmistakably frog-like.
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
// A small smiling mouth, built from a tube rather than a flat texture.
const smileCurve = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(-.17, .42, -.618),
  new THREE.Vector3(0, .35, -.65),
  new THREE.Vector3(.17, .42, -.618),
);
const smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 8, .012, 4, false), frogDark);
frogVisual.add(smile);

const frogShadow = new THREE.Mesh(
  new THREE.CircleGeometry(.48, 20),
  new THREE.MeshBasicMaterial({ color: '#1b4828', transparent: true, opacity: .28, depthWrite: false }),
);
frogShadow.rotation.x = -Math.PI / 2;
frogShadow.position.y = .015;
world.add(frogShadow);

const particles = [];
const particleGeometry = new THREE.IcosahedronGeometry(.045, 0);
const particleMaterials = ['#e9f6a2', '#d8ef72', '#f2c65e'].map((color) => new THREE.MeshBasicMaterial({ color }));

const state = {
  x: 20,
  z: 20,
  score: 0,
  stage: 0,
  gameTime: 0,
  nextHop: 0,
  jump: null,
  queued: null,
  held: null,
  paused: false,
  muted: false,
  currentScale: BASE_SCALE,
  targetScale: BASE_SCALE,
};
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
    const start = type === 'eat' ? 540 : type === 'grow' ? 260 : 145;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(type === 'eat' ? 860 : type === 'grow' ? 620 : 105, now + .12);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'grow' ? .12 : .06, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (type === 'grow' ? .32 : .14));
    oscillator.start(now);
    oscillator.stop(now + (type === 'grow' ? .34 : .16));
  } catch { /* Sound is optional when Web Audio is unavailable. */ }
}

let toastTimeout;
function showToast(message, duration = 1500) {
  clearTimeout(toastTimeout);
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimeout = setTimeout(() => ui.toast.classList.remove('show'), duration);
}

function updateHud() {
  ui.score.textContent = state.score.toLocaleString();
  ui.size.textContent = `${Math.round(55 * Math.pow(1.2, state.stage))}%`;
  const remaining = state.score % 10;
  ui.growthCount.textContent = remaining;
  ui.growthFill.style.width = `${remaining * 10}%`;
  ui.growthProgress.setAttribute('aria-valuenow', remaining);
  ui.growthLabel.textContent = state.score === MAX_INSECTS ? 'Meadow cleared!' : 'Next growth';
}

function burstAt(x, z) {
  if (reducedMotion) return;
  for (let i = 0; i < 9; i++) {
    const mesh = new THREE.Mesh(particleGeometry, particleMaterials[i % particleMaterials.length]);
    mesh.position.set(x, .25, z);
    world.add(mesh);
    const angle = (i / 9) * Math.PI * 2;
    particles.push({ mesh, vx: Math.cos(angle) * (.5 + random() * .5), vz: Math.sin(angle) * (.5 + random() * .5), vy: .8 + random() * .8, life: .65 });
  }
}

function eatCurrentTile() {
  const index = state.z * GRID_SIZE + state.x;
  if (insects[index].eaten) return;
  insects[index].eaten = true;
  setInsectMatrices(index, state.x * TILE, state.z * TILE, 0, false);
  insectMeshes.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  state.score++;
  burstAt(state.x * TILE, state.z * TILE);
  playTone('eat');
  if (state.score % 10 === 0) {
    state.stage++;
    state.targetScale = BASE_SCALE * Math.pow(1.2, state.stage);
    playTone('grow');
    showToast(state.stage <= 2 ? `Growth spurt! +20%` : `Still growing! +20%`);
  }
  if (state.score === MAX_INSECTS) showToast('You cleared the whole meadow!', 4000);
  updateHud();
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
    showToast('The meadow ends here', 850);
    state.nextHop = state.gameTime + .25;
    return false;
  }
  state.jump = {
    fromX: state.x * TILE,
    fromZ: state.z * TILE,
    toX: nextX * TILE,
    toZ: nextZ * TILE,
    start: state.gameTime,
    direction,
  };
  state.x = nextX;
  state.z = nextZ;
  state.nextHop = state.gameTime + HOP_COOLDOWN;
  state.queued = null;
  frog.rotation.y = data.rotation;
  ui.hint.classList.add('hidden');
  playTone('hop');
  return true;
}

function requestHop(direction) {
  if (state.paused) return;
  tryHop(direction);
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

ui.moveButtons.forEach((button) => {
  const direction = button.dataset.direction;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    state.held = direction;
    button.classList.add('pressed');
    requestHop(direction);
  });
  const release = () => {
    if (state.held === direction) state.held = null;
    button.classList.remove('pressed');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});

const keyDirections = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyP' || event.code === 'Escape') {
    event.preventDefault();
    setPaused(!state.paused);
    return;
  }
  const direction = keyDirections[event.code];
  if (!direction) return;
  event.preventDefault();
  state.held = direction;
  requestHop(direction);
});
window.addEventListener('keyup', (event) => {
  if (keyDirections[event.code] === state.held) state.held = null;
});

let swipeStart = null;
renderer.domElement.addEventListener('pointerdown', (event) => {
  swipeStart = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  requestHop(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
renderer.domElement.addEventListener('pointercancel', () => { swipeStart = null; });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.paused) setPaused(true);
});

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
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const targetFocus = new THREE.Vector3();
const colorScratch = new THREE.Color();
let firstFrame = true;

function animate() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, .05);
  if (!state.paused) {
    // Keep the one-second rule tied to real time even on slower phones.
    state.gameTime += rawDt;

    if (!state.jump && state.gameTime >= state.nextHop) {
      const nextDirection = state.queued || state.held;
      if (nextDirection) tryHop(nextDirection);
    }

    if (state.jump) {
      const jump = state.jump;
      const t = Math.min((state.gameTime - jump.start) / HOP_DURATION, 1);
      const eased = t * t * (3 - 2 * t);
      frog.position.x = THREE.MathUtils.lerp(jump.fromX, jump.toX, eased);
      frog.position.z = THREE.MathUtils.lerp(jump.fromZ, jump.toZ, eased);
      frog.position.y = reducedMotion ? 0 : Math.sin(t * Math.PI) * .82;
      const stretch = reducedMotion ? 1 : 1 + Math.sin(t * Math.PI) * .11;
      frogVisual.scale.set(state.currentScale / Math.sqrt(stretch), state.currentScale * stretch, state.currentScale / Math.sqrt(stretch));
      if (t >= 1) {
        frog.position.set(jump.toX, 0, jump.toZ);
        state.jump = null;
        eatCurrentTile();
      }
    }

    state.currentScale = THREE.MathUtils.damp(state.currentScale, state.targetScale, 6, rawDt);
    if (!state.jump) frogVisual.scale.setScalar(state.currentScale);
    const colorAmount = Math.min(state.stage / 3, 1);
    frogSkinMaterials.forEach((material, index) => {
      colorScratch.copy(originalColors[index]).lerp(grownColors[index], colorAmount);
      material.color.copy(colorScratch);
    });

    frogShadow.position.x = frog.position.x;
    frogShadow.position.z = frog.position.z;
    const shadowScale = state.currentScale * (1 - frog.position.y * .35);
    frogShadow.scale.setScalar(shadowScale / BASE_SCALE);
    frogShadow.material.opacity = .28 - frog.position.y * .14;

    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.life -= dt;
      particle.vy -= 3.3 * dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      particle.mesh.rotation.x += dt * 5;
      particle.mesh.scale.setScalar(Math.max(0, particle.life / .65));
      if (particle.life <= 0) {
        world.remove(particle.mesh);
        particles.splice(i, 1);
      }
    }
  }

  targetFocus.set(frog.position.x, .15, frog.position.z);
  cameraFocus.lerp(targetFocus, 1 - Math.exp(-rawDt * 5));
  camera.position.copy(cameraFocus).add(cameraOffset);
  camera.lookAt(cameraFocus);
  sun.position.copy(cameraFocus).add(new THREE.Vector3(9, 18, 7));
  sun.target.position.copy(cameraFocus);
  sun.target.updateMatrixWorld();

  const cooling = Boolean(state.jump) || state.gameTime < state.nextHop;
  ui.ready.classList.toggle('cooling', cooling);
  ui.ready.lastChild.textContent = cooling ? ' RECHARGING' : ' READY TO HOP';

  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    ui.loading.classList.add('done');
    setTimeout(() => ui.loading.remove(), 450);
    window.__SCENE_READY__ = true;
  }
}

updateHud();
renderer.setAnimationLoop(animate);

// Small read-only-friendly hook for automated smoke tests and keyboard-free debugging.
window.__frogGame = {
  getState: () => ({ x: state.x, z: state.z, score: state.score, stage: state.stage, size: state.currentScale, paused: state.paused }),
  hop: requestHop,
};
