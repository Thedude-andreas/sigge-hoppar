import './style.css'
import * as THREE from 'three'
import { BUILD_TAG } from './version'

/* --- Constant world layout --- */
const INNER = 17.5
const GROUND = 0
const PLAYER_H = 0.55
const PLAYER_R = 0.4
const GRAVITY = 18
const JUMP_V = 7.2
const MOVE = 5.2
const FOX_SPD = 5.2
const FOX_TIMER_MIN = 8
const FOX_TIMER_MAX = 18
const FOX_SNIFF_TIME = 2.7
const FOX_SNIFF_DIST = 1.35
const CARROT_PICK = 1.1
const FOX_BITE = 0.9
const ENERGY_MAX = 100
const ENERGY_PER_CARROT = 18

/* --- AABB (Vector2: x, z) --- */
type Box3XZ = { min: THREE.Vector2; max: THREE.Vector2; y0: number; y1: number }
type FoxMode = 'hidden' | 'chase' | 'sniff' | 'leave'

function aabb2ContainsXZ(b: Box3XZ, x: number, z: number): boolean {
  return x >= b.min.x && x <= b.max.x && z >= b.min.y && z <= b.max.y
}

/** Cirkel (x,z) med radie r så att den inte korsar inre av en axis-aligned rektangel i xz. */
function resolveCircleAabb2(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  x: number,
  z: number,
  r: number,
): { x: number; z: number } {
  const cx = THREE.MathUtils.clamp(x, minX, maxX)
  const cz = THREE.MathUtils.clamp(z, minZ, maxZ)
  const ddx = x - cx
  const ddz = z - cz
  const d = Math.hypot(ddx, ddz)
  if (d < r) {
    if (d < 1e-5) {
      const t = x - minX
      const u = maxX - x
      const v = z - minZ
      const wv = maxZ - z
      const m = Math.min(t, u, v, wv)
      if (m === t) {
        return { x: minX - r, z }
      }
      if (m === u) {
        return { x: maxX + r, z }
      }
      if (m === v) {
        return { x, z: minZ - r }
      }
      return { x, z: maxZ + r }
    }
    const nx = ddx / d
    const nz = ddz / d
    return { x: cx + nx * r, z: cz + nz * r }
  }
  return { x, z }
}

function makeFurTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ead29a'
  ctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 620; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const len = 2 + Math.random() * 7
    const shade = Math.random()
    ctx.strokeStyle = shade > 0.55 ? 'rgba(255, 240, 201, 0.38)' : 'rgba(128, 89, 45, 0.14)'
    ctx.lineWidth = 0.55 + Math.random() * 0.8
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y + len)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2.4, 2.4)
  return tex
}

function makeSiggeMaterial() {
  const fur = makeFurTexture()
  return new THREE.MeshStandardMaterial({
    color: 0xf0d08b,
    map: fur,
    emissive: 0x3d2508,
    emissiveIntensity: 0.12,
    roughness: 0.95,
    metalness: 0,
    fog: false,
  })
}

function makeSiggeTail(material: THREE.Material) {
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), material)
  tail.scale.set(1.05, 0.8, 0.88)
  tail.position.set(0, 0.29, -0.5)
  return tail
}

function buildScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x6eb8d4)
  scene.fog = new THREE.Fog(0x8ec8e0, 22, 55)

  const hemi = new THREE.HemisphereLight(0xd8f0ff, 0x3a5a30, 0.85)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfffaec, 1.0)
  sun.position.set(20, 32, 12)
  scene.add(sun)

  // Lawn
  const groundGeo = new THREE.PlaneGeometry(50, 50)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3b, roughness: 0.9 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.position.y = GROUND
  scene.add(ground)

  // Morotsland: lighter patch
  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 40),
    new THREE.MeshStandardMaterial({ color: 0x4e9a48, roughness: 0.88 }),
  )
  patch.rotation.x = -Math.PI / 2
  patch.position.set(8, 0.02, -6)
  scene.add(patch)

  // Hedges (perimeter)
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x1f5a24, roughness: 0.8 })
  const h = 1.2
  const t = 1.2
  const L = 50
  for (const [px, pz, sx, sz] of [
    [0, 25, L, t],
    [0, -25, L, t],
    [25, 0, t, L],
    [-25, 0, t, L],
  ] as [number, number, number, number][]) {
    const hedge = new THREE.Mesh(
      new THREE.BoxGeometry(sx, h, sz),
      hedgeMat,
    )
    hedge.position.set(px, h / 2, pz)
    scene.add(hedge)
  }

  // Red house + simple decks
  const houseW = 5
  const houseD = 4.5
  const houseH = 2.4
  const houseG = new THREE.Group()
  const redMat = new THREE.MeshStandardMaterial({ color: 0xba2a20, roughness: 0.5 })
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x5c4030, roughness: 0.7 })
  const house = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), redMat)
  house.position.set(0, houseH / 2 + 0.05, 0)
  houseG.add(house)
  for (const [dx, dz, w, d] of [
    [0, houseD / 2 + 0.5, 3.2, 1.2], // back
    [houseW / 2 + 0.4, 0, 1.0, 2.0],
    [-houseW / 2 - 0.4, 0, 1.0, 2.0],
  ] as [number, number, number, number][]) {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.16, d),
      deckMat,
    )
    deck.position.set(dx, 0.1, dz)
    houseG.add(deck)
  }
  houseG.position.set(-11, 0, 9)
  scene.add(houseG)

  // Colliders for house (so Sigge can’t run through)
  const houseAabb: Box3XZ = {
    min: new THREE.Vector2(houseG.position.x - houseW * 0.5 - 0.3, houseG.position.z - houseD * 0.5 - 0.3),
    max: new THREE.Vector2(houseG.position.x + houseW * 0.5 + 0.3, houseG.position.z + houseD * 0.5 + 0.3),
    y0: 0,
    y1: houseH,
  }

  // Rabbit hutch (safe zone) — open wire frame look
  const hutchG = new THREE.Group()
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.6 })
  const hutchW = 2.2
  const hutchD = 1.4
  const hutchH = 1.2
  hutchG.add(new THREE.Mesh(new THREE.BoxGeometry(hutchW, 0.1, hutchD), frameMat).translateY(0.05))
  hutchG.add(
    new THREE.Mesh(new THREE.BoxGeometry(0.08, hutchH, hutchD), frameMat)
      .translateX(-hutchW / 2)
      .translateY(hutchH / 2 + 0.1),
  )
  hutchG.add(
    new THREE.Mesh(new THREE.BoxGeometry(0.08, hutchH, hutchD), frameMat)
      .translateX(hutchW / 2)
      .translateY(hutchH / 2 + 0.1),
  )
  hutchG.add(
    new THREE.Mesh(new THREE.BoxGeometry(hutchW, hutchH, 0.08), frameMat)
      .translateZ(-hutchD / 2)
      .translateY(hutchH / 2 + 0.1),
  )
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 0.4, 4),
    new THREE.MeshStandardMaterial({ color: 0x5a2a1a, roughness: 0.6 }),
  )
  roof.rotation.y = Math.PI / 4
  roof.position.set(0, hutchH + 0.28, 0)
  hutchG.add(roof)
  hutchG.position.set(5.2, 0, 6.2)
  scene.add(hutchG)

  const hutchCenter = hutchG.position.clone()
  hutchCenter.y = 0.5

  // Safe AABB: inside the hutch
  // min.x/max.x = world x; min.y/max.y = world z
  const hutchAabb: Box3XZ = {
    min: new THREE.Vector2(hutchG.position.x - 0.75, hutchG.position.z - 0.55),
    max: new THREE.Vector2(hutchG.position.x + 0.75, hutchG.position.z + 0.55),
    y0: 0,
    y1: 1.2,
  }

  // Carrots
  const carrots: THREE.Object3D[] = []
  const carrotMat = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0x221100 })
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.5 })
  const centerPatch = new THREE.Vector2(8, -6)
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group()
    const r = 1.5 + Math.random() * 4.2
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5
    const x = centerPatch.x + Math.cos(a) * r
    const z = centerPatch.y + Math.sin(a) * r
    g.add(
      new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.55, 6),
        carrotMat,
      )
        .translateY(0.2),
    )
    g.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.2, 5),
        stemMat,
      )
        .translateY(0.5),
    )
    g.position.set(x, 0, z)
    g.rotation.set(0, Math.random() * 6, 0)
    scene.add(g)
    carrots.push(g)
  }

  // Sigge: root = logik, visual = kropp (skuttar ovanpå)
  const siggeG = new THREE.Group()
  const siggeVisual = new THREE.Group()
  const siggeMat = makeSiggeMaterial()
  const innerEarMat = new THREE.MeshStandardMaterial({
    color: 0xc99875,
    roughness: 0.9,
    fog: false,
  })
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b130c, fog: false })
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x8a5c45, roughness: 0.8, fog: false })
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.43, 28, 20),
    siggeMat,
  )
  body.scale.set(1.05, 0.78, 1.28)
  body.position.y = 0.32
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), siggeMat)
  chest.scale.set(1.15, 0.9, 0.75)
  chest.position.set(0, 0.39, 0.28)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 22, 16), siggeMat)
  head.scale.set(1.08, 0.9, 1.02)
  head.position.set(0, 0.56, 0.38)

  const leftEar = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), siggeMat)
  leftEar.scale.set(0.62, 2.15, 0.38)
  leftEar.rotation.set(0.16, 0.06, -0.28)
  leftEar.position.set(-0.31, 0.42, 0.2)
  const rightEar = leftEar.clone()
  rightEar.rotation.set(0.16, -0.06, 0.28)
  rightEar.position.x = 0.31

  const leftInnerEar = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 8), innerEarMat)
  leftInnerEar.scale.set(0.48, 1.65, 0.13)
  leftInnerEar.rotation.copy(leftEar.rotation)
  leftInnerEar.position.set(-0.315, 0.4, 0.245)
  const rightInnerEar = leftInnerEar.clone()
  rightInnerEar.rotation.copy(rightEar.rotation)
  rightInnerEar.position.x = 0.235

  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeMat)
  leftEye.position.set(-0.105, 0.6, 0.62)
  const rightEye = leftEye.clone()
  rightEye.position.x = 0.105
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), noseMat)
  nose.scale.set(1.1, 0.75, 0.75)
  nose.position.set(0, 0.535, 0.655)

  const siggeTail = makeSiggeTail(siggeMat)
  siggeVisual.add(body, chest, head, leftEar, rightEar, leftInnerEar, rightInnerEar, leftEye, rightEye, nose, siggeTail)
  siggeG.add(siggeVisual)
  siggeG.position.set(0, PLAYER_H, 0)
  scene.add(siggeG)

  // Fox
  const foxG = new THREE.Group()
  const orange = new THREE.MeshStandardMaterial({ color: 0xd45a1a, roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a0f05, roughness: 0.5 })
  const cream = new THREE.MeshStandardMaterial({ color: 0xf3e2bd, roughness: 0.7 })
  const black = new THREE.MeshBasicMaterial({ color: 0x120806, fog: false })
  const fBody = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), orange)
  fBody.scale.set(0.85, 0.55, 1.45)
  fBody.position.y = 0.34
  const fChest = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), cream)
  fChest.scale.set(0.95, 0.7, 0.55)
  fChest.position.set(0, 0.35, 0.36)
  const fHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), orange)
  fHead.scale.set(0.95, 0.8, 1)
  fHead.position.set(0, 0.56, 0.58)
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 12), cream)
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, 0.52, 0.77)
  const foxNose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), black)
  foxNose.scale.set(1.15, 0.8, 0.8)
  foxNose.position.set(0, 0.52, 0.9)
  const leftFoxEye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), black)
  leftFoxEye.position.set(-0.075, 0.61, 0.76)
  const rightFoxEye = leftFoxEye.clone()
  rightFoxEye.position.x = 0.075
  const leftFoxEar = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), orange)
  leftFoxEar.rotation.set(0.22, 0.18, -0.15)
  leftFoxEar.position.set(-0.13, 0.76, 0.52)
  const rightFoxEar = leftFoxEar.clone()
  rightFoxEar.rotation.set(0.22, -0.18, 0.15)
  rightFoxEar.position.x = 0.13
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 12), orange)
  tail.rotation.x = -1.05
  tail.position.set(0, 0.38, -0.56)
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), cream)
  tailTip.scale.set(0.9, 0.75, 1.05)
  tailTip.position.set(0, 0.63, -0.83)
  const legs: THREE.Mesh[] = []
  for (const x of [-0.18, 0.18]) {
    for (const z of [-0.25, 0.28]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.28, 8), dark)
      leg.position.set(x, 0.15, z)
      legs.push(leg)
    }
  }
  foxG.userData.parts = {
    body: fBody,
    chest: fChest,
    head: fHead,
    snout,
    nose: foxNose,
    tail,
    tailTip,
    legs,
    baseY: 0,
    bodyY: fBody.position.y,
    chestY: fChest.position.y,
    headY: fHead.position.y,
    snoutY: snout.position.y,
    noseY: foxNose.position.y,
    tailRotX: tail.rotation.x,
    tailTipY: tailTip.position.y,
  }
  foxG.add(
    fBody,
    fChest,
    fHead,
    snout,
    foxNose,
    leftFoxEye,
    rightFoxEye,
    leftFoxEar,
    rightFoxEar,
    tail,
    tailTip,
    ...legs,
  )
  foxG.visible = false
  scene.add(foxG)

  return {
    scene,
    siggeG,
    siggeVisual,
    foxG,
    carrots,
    houseAabb,
    hutchAabb,
    hutchCenter,
  }
}

function main() {
  const root = document.getElementById('app')!
  // HUD: läs in efter att DOM:en finns; index.html ersätts i bygget med rätt "Kod:" redan
  const elEnergy = document.getElementById('energy-bar') as HTMLDivElement | null
  const elFox = document.getElementById('hud-fox') as HTMLParagraphElement | null
  const elSafe = document.getElementById('hud-safe') as HTMLParagraphElement | null
  const rev = document.getElementById('hud-rev')
  if (rev) {
    rev.textContent = `Kod: ${BUILD_TAG}`
  }
  const { scene, siggeG, siggeVisual, foxG, carrots, houseAabb, hutchAabb, hutchCenter } = buildScene()

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  root.appendChild(renderer.domElement)

  const keys: Record<string, boolean> = {}
  const pVel = new THREE.Vector3(0, 0, 0)
  const foxP = new THREE.Vector3(0, 0, 12)
  /** Var Sigge tittar (Y-rotation) — kameran följer bakifrån. */
  let playerFacing = 0
  let hopPhase = 0
  const TURN_SPD = 2.2
  let energy = 12
  let onGround = true
  let foxMode: FoxMode = 'hidden'
  let foxNext = 5
  let foxSniffLeft = 0
  let foxWalkPhase = 0
  const foxTarget = new THREE.Vector3()
  const foxLeaveTarget = new THREE.Vector3()

  function inSafeZone(x: number, y: number, z: number): boolean {
    return (
      aabb2ContainsXZ(hutchAabb, x, z) && y + PLAYER_H * 0.3 >= hutchAabb.y0 && y < hutchAabb.y1 + 0.2
    )
  }

  function trySpawnFox() {
    if (foxMode !== 'hidden') {
      return
    }
    const ang = Math.random() * Math.PI * 2
    const r = INNER - 1.2
    foxP.set(Math.cos(ang) * r, 0.25, Math.sin(ang) * r)
    foxG.position.copy(foxP)
    foxG.visible = true
    foxMode = 'chase'
  }

  function hideFox() {
    foxMode = 'hidden'
    foxG.visible = false
    foxNext = THREE.MathUtils.randFloat(FOX_TIMER_MIN, FOX_TIMER_MAX)
  }

  function moveFoxToward(target: THREE.Vector3, speed: number, dt: number): number {
    const to = target.clone().sub(foxG.position)
    to.y = 0
    const dist = to.length()
    if (dist < 0.01) {
      return dist
    }
    const stepLen = Math.min(dist, speed * dt)
    to.normalize()
    foxG.position.addScaledVector(to, stepLen)
    foxG.rotation.y = Math.atan2(to.x, to.z)
    return dist - stepLen
  }

  function animateFox(moving: boolean, sniffing: boolean, dt: number, now: number) {
    const parts = foxG.userData.parts
    if (!parts) {
      return
    }
    if (moving) {
      foxWalkPhase += dt * 10
    } else {
      foxWalkPhase = THREE.MathUtils.lerp(foxWalkPhase, 0, Math.min(1, dt * 6))
    }

    const stride = Math.sin(foxWalkPhase)
    const counterStride = Math.sin(foxWalkPhase + Math.PI)
    const bob = moving ? Math.abs(stride) * 0.035 : sniffing ? Math.sin(now * 8) * 0.012 : 0
    const headNod = sniffing ? Math.sin(now * 12) * 0.035 : moving ? Math.sin(foxWalkPhase + 0.5) * 0.015 : 0

    foxG.position.y = 0.25 + bob
    parts.body.position.y = parts.bodyY + bob * 0.35
    parts.chest.position.y = parts.chestY + bob * 0.45
    parts.head.position.y = parts.headY + headNod
    parts.snout.position.y = parts.snoutY + headNod
    parts.nose.position.y = parts.noseY + headNod
    parts.tail.rotation.x = parts.tailRotX + Math.sin(foxWalkPhase + 0.8) * 0.14
    parts.tailTip.position.y = parts.tailTipY + Math.sin(foxWalkPhase + 0.8) * 0.035

    for (let i = 0; i < parts.legs.length; i++) {
      const leg = parts.legs[i] as THREE.Mesh
      const phase = i % 2 === 0 ? stride : counterStride
      leg.rotation.x = moving ? phase * 0.45 : THREE.MathUtils.lerp(leg.rotation.x, 0, Math.min(1, dt * 8))
    }
  }

  function startFoxSniff() {
    const side = foxG.position.clone().sub(hutchCenter)
    side.y = 0
    if (side.lengthSq() < 0.01) {
      side.set(0, 0, -1)
    }
    side.normalize()
    foxTarget.set(
      hutchCenter.x + side.x * FOX_SNIFF_DIST,
      0.25,
      hutchCenter.z + side.z * FOX_SNIFF_DIST,
    )
    foxLeaveTarget.set(
      hutchCenter.x + side.x * (INNER + 8),
      0.25,
      hutchCenter.z + side.z * (INNER + 8),
    )
    foxSniffLeft = FOX_SNIFF_TIME
    foxMode = 'sniff'
  }

  function resolveCarrots() {
    for (const c of carrots) {
      if (!c.userData.picked) {
        const d = c.position.distanceTo(siggeG.position)
        if (d < CARROT_PICK) {
          c.userData.picked = true
          c.visible = false
          energy = Math.min(ENERGY_MAX, energy + ENERGY_PER_CARROT)
        }
      }
    }
  }

  function onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  window.addEventListener('resize', onResize)
  onResize()

  function bindKeyFromCode(e: KeyboardEvent, on: boolean) {
    if (e.code === 'Space') {
      e.preventDefault()
    }
    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      e.preventDefault()
    }
    keys[e.code] = on
  }
  window.addEventListener('keydown', (e) => {
    bindKeyFromCode(e, true)
  })
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false
  })

  let last = performance.now() / 1000

  function step(t: number) {
    const now = t / 1000
    let dt = now - last
    last = now
    if (dt > 0.1) {
      dt = 0.1
    }
    if (foxMode === 'hidden') {
      foxNext -= dt
      if (foxNext <= 0) {
        trySpawnFox()
      }
    }

    const kUp = keys['ArrowUp'] || keys['KeyW']
    const kDown = keys['ArrowDown'] || keys['KeyS']
    const kLeft = keys['ArrowLeft'] || keys['KeyA']
    const kRight = keys['ArrowRight'] || keys['KeyD']

    if (kLeft) {
      playerFacing += TURN_SPD * dt
    }
    if (kRight) {
      playerFacing -= TURN_SPD * dt
    }

    const forwardX = Math.sin(playerFacing)
    const forwardZ = Math.cos(playerFacing)
    const thrust = (kUp ? 1 : 0) - (kDown ? 1 : 0)
    const boost = 1 + energy * 0.0008
    pVel.x = forwardX * thrust * MOVE * dt * boost
    pVel.z = forwardZ * thrust * MOVE * dt * boost
    pVel.y -= GRAVITY * dt
    if (onGround && keys['Space']) {
      pVel.y = JUMP_V
      onGround = false
    }
    let nx = siggeG.position.x + pVel.x
    let ny = Math.max(0, siggeG.position.y + pVel.y * dt)
    let nz = siggeG.position.z + pVel.z

    nx = THREE.MathUtils.clamp(nx, -INNER + PLAYER_R, INNER - PLAYER_R)
    nz = THREE.MathUtils.clamp(nz, -INNER + PLAYER_R, INNER - PLAYER_R)

    const hOut = resolveCircleAabb2(
      houseAabb.min.x,
      houseAabb.min.y,
      houseAabb.max.x,
      houseAabb.max.y,
      nx,
      nz,
      PLAYER_R,
    )
    nx = hOut.x
    nz = hOut.z

    siggeG.position.x = nx
    siggeG.position.z = nz
    if (ny <= PLAYER_H) {
      ny = PLAYER_H
      pVel.y = 0
      onGround = true
    } else {
      onGround = false
    }
    siggeG.position.y = ny
    siggeG.rotation.y = playerFacing

    // Skuttbounce i kroppen när man går fram/bak; kollaps när man stannar
    const strolling = onGround && Math.abs(thrust) > 0
    if (strolling) {
      hopPhase += dt * 11.5
      siggeVisual.position.y = 0.1 * (0.5 - 0.5 * Math.cos(hopPhase * 2.6))
    } else {
      hopPhase = THREE.MathUtils.lerp(hopPhase, 0, dt * 4)
      siggeVisual.position.y = THREE.MathUtils.lerp(siggeVisual.position.y, 0, Math.min(1, dt * 12))
    }
    if (!onGround) {
      siggeVisual.position.y = 0
    }

    resolveCarrots()

    const safe = inSafeZone(nx, ny, nz)
    elSafe?.classList.toggle('hud-safe--hidden', !safe)
    if (safe || foxMode === 'hidden' || foxMode === 'leave') {
      elFox?.classList.add('hud-fox--hidden')
    } else {
      elFox?.classList.remove('hud-fox--hidden')
    }

    let foxMoving = false
    let foxSniffing = false
    if (foxMode === 'chase') {
      if (safe) {
        startFoxSniff()
      } else {
        foxTarget.set(siggeG.position.x, 0.25, siggeG.position.z)
        foxMoving = moveFoxToward(foxTarget, FOX_SPD * (0.9 + (100 - energy) * 0.0004), dt) > 0.08
        foxG.position.x = THREE.MathUtils.clamp(foxG.position.x, -INNER + 0.4, INNER - 0.4)
        foxG.position.z = THREE.MathUtils.clamp(foxG.position.z, -INNER + 0.4, INNER - 0.4)
        if (new THREE.Vector2(foxG.position.x, foxG.position.z).distanceTo(new THREE.Vector2(nx, nz)) < FOX_BITE) {
          energy = Math.max(0, energy - 30)
          hideFox()
        }
      }
    } else if (foxMode === 'sniff') {
      const remaining = moveFoxToward(foxTarget, FOX_SPD * 0.55, dt)
      foxMoving = remaining > 0.08
      if (remaining < 0.08) {
        foxSniffing = true
        foxSniffLeft -= dt
        foxG.rotation.y += Math.sin(performance.now() * 0.014) * dt * 0.9
        if (foxSniffLeft <= 0) {
          foxMode = 'leave'
        }
      }
    } else if (foxMode === 'leave') {
      const remaining = moveFoxToward(foxLeaveTarget, FOX_SPD * 0.8, dt)
      foxMoving = true
      if (remaining < 0.2 || Math.abs(foxG.position.x) > INNER || Math.abs(foxG.position.z) > INNER) {
        hideFox()
      }
    }
    animateFox(foxMoving, foxSniffing, dt, now)

    // Kamera: bakom Sigge längs hans blickriktning
    const f = new THREE.Vector3(forwardX, 0, forwardZ)
    const back = f.clone().multiplyScalar(-1)
    const dist = 4.35
    const camP = new THREE.Vector3(
      siggeG.position.x + back.x * dist,
      siggeG.position.y + 1.15,
      siggeG.position.z + back.z * dist,
    )
    camera.position.lerp(camP, 0.18)
    camera.lookAt(
      new THREE.Vector3(
        siggeG.position.x,
        siggeG.position.y + 0.3,
        siggeG.position.z,
      ),
    )

    if (elEnergy) {
      elEnergy.style.width = `${(energy / ENERGY_MAX) * 100}%`
    }

    renderer.render(scene, camera)
  }

  renderer.setAnimationLoop(() => {
    const t = performance.now()
    step(t)
  })
}

main()
