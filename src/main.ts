import './style.css'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { AudioDirector } from './audio'
import { fetchHighscores, sanitizeHighscoreName, saveHighscore, type HighscoreEntry, type HighscoreSource } from './highscores'
import { BUILD_TAG } from './version'
import { buildNeighborhood, terrainHeightAt, WORLD_HALF_X, WORLD_HALF_Z, type HedgeZone, type HutchZone } from './neighborhood'

/* --- Constant world layout --- */
const INNER = WORLD_HALF_X
const GROUND = 0
const SIGGE_SCALE = 0.72
const PLAYER_H = 0
const PLAYER_R = 0.29
const GRAVITY = 18
const JUMP_V = 7.4
const MOVE = 5.7
const JUMP_FORWARD_BASE = 7.1
const JUMP_FORWARD_STEP = 1.05
const JUMP_FORWARD_MAX = 10.25
const JUMP_CHAIN_WINDOW = 1.25
const JUMP_BUFFER_SECONDS = 0.2
const FOX_SPD = 4.9
const FOX_TIMER_MIN = 8
const FOX_TIMER_MAX = 18
const FOX_SNIFF_TIME = 2.7
// Radierna omsluter även nos och svans, så ingen del av rovdjuret kan korsa burnätet.
const FOX_HUTCH_CLEARANCE = 1.5
const CAT_SPD = 5.35
const CAT_TIMER_MIN = 13
const CAT_TIMER_MAX = 28
const CAT_SNIFF_TIME = 2.2
const CAT_HUTCH_CLEARANCE = 1.2
const CARROT_PICK = 0.85
const CARROT_REGROW_MIN = 18
const CARROT_REGROW_MAX = 28
const FOX_BITE = 0.74
const CAT_BITE = 0.68
const ENERGY_MAX = 100
const ENERGY_PER_CARROT = 18
const ENERGY_DRAIN_PER_SEC = 1.4
const FOX_BITE_DAMAGE = 24
const CAT_BITE_DAMAGE = 17
const FOX_BITE_COOLDOWN = 1.15
const CAT_BITE_COOLDOWN = 0.9
const FOX_BITE_ANIM_TIME = 0.42
const CAT_BITE_ANIM_TIME = 0.32
const FOX_ATTACK_DIST = 0.68
const CAT_ATTACK_DIST = 0.58
const START_ENERGY = 45
const DAY_SECONDS = 60
const NIGHT_SECONDS = 30
const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS
const TWILIGHT_SECONDS = 8
const PICKUP_PICK = 0.85
const PICKUP_MAX = 6
const PICKUP_SPAWN_MIN = 9
const PICKUP_SPAWN_MAX = 17
const ARMOR_MAX = 4
const SPEED_POTION_SECONDS = 16
const SHIELD_POTION_SECONDS = 12
const RISK_CYCLE_BOOST_SECONDS = 20
const RISK_NIGHT_MULTIPLIER_SECONDS = 45
const RISK_CARROT_BOOST_SECONDS = 30
const RISK_REWARD_PAUSE_SECONDS = 7

type RenderProfile = {
  antialias: boolean
  initialPixelRatio: number
  minPixelRatio: number
  maxPixelRatio: number
}

function detectRenderProfile(): RenderProfile {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
  const touchDevice = navigator.maxTouchPoints > 0 || window.matchMedia('(hover: none), (pointer: coarse)').matches
  const memory = navigatorWithMemory.deviceMemory ?? (touchDevice ? 4 : 8)
  const cores = navigator.hardwareConcurrency || (touchDevice ? 4 : 8)
  const constrained = memory <= 4 || cores <= 4
  const devicePixelRatio = window.devicePixelRatio || 1
  const cap = constrained ? 1 : touchDevice ? 1.25 : 1.75
  const maxPixelRatio = Math.min(devicePixelRatio, cap)
  const floor = constrained ? 0.75 : touchDevice ? 0.85 : 1

  return {
    antialias: !touchDevice && !constrained,
    initialPixelRatio: maxPixelRatio,
    minPixelRatio: Math.min(maxPixelRatio, floor),
    maxPixelRatio,
  }
}

/* --- AABB (Vector2: x, z) --- */
type Box3XZ = { min: THREE.Vector2; max: THREE.Vector2; y0: number; y1: number }
type CarrotPlant = {
  root: THREE.Group
  edible: THREE.Group
  greens: THREE.Group
  picked: boolean
  regrowLeft: number
  regrowTotal: number
}
type RampSpec = {
  x: number
  zBottom: number
  zTop: number
  w: number
  yBottom: number
  yTop: number
}
type HutchSpec = {
  w: number
  d: number
  doorX: number
  doorW: number
}
type FoxMode = 'hidden' | 'chase' | 'sniff' | 'leave'
type CharacterId = 'sigge' | 'kurre'
type PickupKind = 'light-armor' | 'heavy-armor' | 'energy-potion' | 'speed-potion' | 'shield-potion'
type Pickup = {
  group: THREE.Group
  kind: PickupKind
  ttl: number
}
type RiskChallengeKind = 'fox-jump' | 'night-dandelion' | 'predator-carrot'

declare global {
  interface Window {
    __siggeDebug?: {
      setCycleClock: (seconds: number) => void
      setEnergy: (value: number) => void
      spawnPickup: (kind?: PickupKind) => void
      setRiskChallenge: (kind: RiskChallengeKind) => void
    }
  }
}

function createRiskDandelion(): THREE.Group {
  const group = new THREE.Group()
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x4f9d38, roughness: 0.82 })
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x91ee54,
    emissive: 0x2f7d24,
    emissiveIntensity: 0.62,
    roughness: 0.68,
  })
  const flowerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdc42,
    emissive: 0x8a5a00,
    emissiveIntensity: 0.78,
    roughness: 0.55,
  })

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.45, 7), stemMaterial)
  stem.position.y = 0.23
  group.add(stem)

  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 5), leafMaterial)
    leaf.scale.set(1.45, 0.15, 0.48)
    leaf.position.set(side * 0.12, 0.1, side * 0.04)
    leaf.rotation.y = side * 0.62
    leaf.rotation.z = side * 0.18
    group.add(leaf)
  }

  const flower = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 7), flowerMaterial)
  flower.scale.set(1.35, 0.42, 1.35)
  flower.position.y = 0.48
  group.add(flower)
  for (let i = 0; i < 8; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 5), flowerMaterial)
    const angle = (i / 8) * Math.PI * 2
    petal.scale.set(1.5, 0.25, 0.62)
    petal.position.set(Math.cos(angle) * 0.14, 0.47, Math.sin(angle) * 0.14)
    petal.rotation.y = -angle
    group.add(petal)
  }

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.022, 6, 18),
    new THREE.MeshBasicMaterial({ color: 0xffee72, fog: false }),
  )
  halo.position.y = 0.72
  halo.rotation.x = Math.PI / 2
  group.add(halo)

  group.visible = false
  return group
}

function aabb2ContainsXZ(b: Box3XZ, x: number, z: number): boolean {
  return x >= b.min.x && x <= b.max.x && z >= b.min.y && z <= b.max.y
}

function distanceToHedge(zone: HedgeZone, x: number, z: number): number {
  const dx = zone.to.x - zone.from.x
  const dz = zone.to.y - zone.from.y
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq > 0
    ? THREE.MathUtils.clamp(((x - zone.from.x) * dx + (z - zone.from.y) * dz) / lengthSq, 0, 1)
    : 0
  return Math.hypot(x - (zone.from.x + dx * t), z - (zone.from.y + dz * t))
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

function setCarrotPlantGrowth(plant: CarrotPlant, growth: number) {
  const g = THREE.MathUtils.clamp(growth, 0, 1)
  plant.edible.visible = g >= 0.98
  plant.greens.visible = g > 0.03
  plant.greens.scale.setScalar(0.28 + g * 0.72)
  plant.greens.position.y = -0.24 * (1 - g)
  plant.edible.scale.setScalar(0.86 + g * 0.14)
}

function makeFurTexture(character: CharacterId) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = character === 'sigge' ? '#ead29a' : '#4a2d1d'
  ctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 620; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const len = 2 + Math.random() * 7
    const shade = Math.random()
    ctx.strokeStyle = character === 'sigge'
      ? (shade > 0.55 ? 'rgba(255, 240, 201, 0.38)' : 'rgba(128, 89, 45, 0.14)')
      : (shade > 0.55 ? 'rgba(164, 112, 75, 0.34)' : 'rgba(25, 12, 8, 0.25)')
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

function makeRabbitMaterial(character: CharacterId) {
  const fur = makeFurTexture(character)
  return new THREE.MeshStandardMaterial({
    color: character === 'sigge' ? 0xf0d08b : 0x5b3522,
    map: fur,
    emissive: character === 'sigge' ? 0x3d2508 : 0x160a05,
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

type RabbitModel = {
  root: THREE.Group
  visual: THREE.Group
  armor: THREE.Group
  furMaterial: THREE.MeshStandardMaterial
  innerEarMaterial: THREE.MeshStandardMaterial
  noseMaterial: THREE.MeshStandardMaterial
}

type RabbitNpc = RabbitModel & {
  character: CharacterId
  hutch: HutchZone
  target: THREE.Vector2
  patrolIndex: number
  waitLeft: number
  walkPhase: number
}

// En slinga längs burens fria inneryta. Alla punkter lämnar kroppsmarginal till nätet.
const NPC_PATROL_POINTS: readonly (readonly [number, number])[] = [
  [-0.82, 0.75],
  [-0.84, -0.05],
  [-0.2, -0.78],
  [0.82, -0.72],
  [0.84, 0.75],
]

function createRabbitModel(character: CharacterId): RabbitModel {
  const root = new THREE.Group()
  const visual = new THREE.Group()
  const furMaterial = makeRabbitMaterial(character)
  const innerEarMaterial = new THREE.MeshStandardMaterial({
    color: character === 'sigge' ? 0xc99875 : 0x7f5140,
    roughness: 0.9,
    fog: false,
  })
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x1b130c, fog: false })
  const noseMaterial = new THREE.MeshStandardMaterial({
    color: character === 'sigge' ? 0x8a5c45 : 0x3a2018,
    roughness: 0.8,
    fog: false,
  })

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.43, 28, 20), furMaterial)
  body.scale.set(1.05, 0.78, 1.28)
  body.position.y = 0.32
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), furMaterial)
  chest.scale.set(1.15, 0.9, 0.75)
  chest.position.set(0, 0.39, 0.28)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 22, 16), furMaterial)
  head.scale.set(1.08, 0.9, 1.02)
  head.position.set(0, 0.56, 0.38)

  const leftEar = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), furMaterial)
  leftEar.scale.set(0.62, 2.15, 0.38)
  leftEar.rotation.set(0.16, 0.06, -0.28)
  leftEar.position.set(-0.31, 0.42, 0.2)
  const rightEar = leftEar.clone()
  rightEar.rotation.set(0.16, -0.06, 0.28)
  rightEar.position.x = 0.31

  const leftInnerEar = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 8), innerEarMaterial)
  leftInnerEar.scale.set(0.48, 1.65, 0.13)
  leftInnerEar.rotation.copy(leftEar.rotation)
  leftInnerEar.position.set(-0.315, 0.4, 0.245)
  const rightInnerEar = leftInnerEar.clone()
  rightInnerEar.rotation.copy(rightEar.rotation)
  rightInnerEar.position.x = 0.235

  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeMaterial)
  leftEye.position.set(-0.105, 0.6, 0.62)
  const rightEye = leftEye.clone()
  rightEye.position.x = 0.105
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), noseMaterial)
  nose.scale.set(1.1, 0.75, 0.75)
  nose.position.set(0, 0.535, 0.655)

  const tail = makeSiggeTail(furMaterial)
  const armor = new THREE.Group()
  const armorMaterial = new THREE.MeshStandardMaterial({ color: 0xa8b6c6, metalness: 0.45, roughness: 0.34, fog: false })
  const backPlate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.055, 0.66), armorMaterial)
  backPlate.position.set(0, 0.61, -0.03)
  backPlate.rotation.x = -0.08
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.24), armorMaterial)
  chestPlate.position.set(0, 0.49, 0.34)
  chestPlate.rotation.x = 0.18
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.23), armorMaterial)
  helm.position.set(0, 0.73, 0.43)
  armor.add(backPlate, chestPlate, helm)
  armor.visible = false

  visual.add(body, chest, head, leftEar, rightEar, leftInnerEar, rightInnerEar, leftEye, rightEye, nose, tail, armor)
  visual.scale.setScalar(SIGGE_SCALE)
  root.add(visual)
  return { root, visual, armor, furMaterial, innerEarMaterial, noseMaterial }
}

function applyRabbitCharacter(model: RabbitModel, character: CharacterId) {
  const source = makeRabbitMaterial(character)
  model.furMaterial.map?.dispose()
  model.furMaterial.color.copy(source.color)
  model.furMaterial.emissive.copy(source.emissive)
  model.furMaterial.map = source.map
  model.furMaterial.needsUpdate = true
  source.map = null
  source.dispose()
  model.innerEarMaterial.color.set(character === 'sigge' ? 0xc99875 : 0x7f5140)
  model.noseMaterial.color.set(character === 'sigge' ? 0x8a5c45 : 0x3a2018)
}

type CharacterPreview = {
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  rabbit: RabbitModel
  pixelRatio: number
}

function setupCharacterPreviews(profile: RenderProfile): CharacterPreview[] {
  return Array.from(document.querySelectorAll<HTMLCanvasElement>('[data-character-preview]')).map((canvas) => {
    const character: CharacterId = canvas.dataset.characterPreview === 'kurre' ? 'kurre' : 'sigge'
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
    camera.position.set(0, 0.52, 2.35)
    camera.lookAt(0, 0.36, 0)
    scene.add(new THREE.HemisphereLight(0xfff5dc, 0x30452c, 1.8))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1)
    keyLight.position.set(2.4, 3.2, 2.8)
    scene.add(keyLight)
    const rabbit = createRabbitModel(character)
    rabbit.root.scale.setScalar(1.55)
    rabbit.root.position.y = -0.08
    scene.add(rabbit.root)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: profile.antialias, alpha: true })
    const pixelRatio = Math.min(profile.initialPixelRatio, 1.25)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(pixelRatio)
    return { canvas, renderer, scene, camera, rabbit, pixelRatio }
  })
}

function renderCharacterPreviews(previews: CharacterPreview[], now: number) {
  for (let i = 0; i < previews.length; i++) {
    const preview = previews[i]
    if (preview.canvas.offsetParent === null) {
      continue
    }
    const width = Math.max(1, Math.round(preview.canvas.clientWidth))
    const height = Math.max(1, Math.round(preview.canvas.clientHeight))
    if (preview.canvas.width !== Math.round(width * preview.pixelRatio) || preview.canvas.height !== Math.round(height * preview.pixelRatio)) {
      preview.renderer.setSize(width, height, false)
      preview.camera.aspect = width / height
      preview.camera.updateProjectionMatrix()
    }
    preview.rabbit.root.rotation.y = now * 0.7 + i * Math.PI * 0.35
    preview.rabbit.visual.position.y = Math.sin(now * 2.2 + i) * 0.018
    preview.renderer.render(preview.scene, preview.camera)
  }
}

function buildScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x6eb8d4)
  scene.fog = new THREE.Fog(0x8ec8e0, 28, 125)

  const hemi = new THREE.HemisphereLight(0xd8f0ff, 0x3a5a30, 0.85)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfffaec, 1.0)
  sun.position.set(20, 32, 12)
  scene.add(sun)
  const moonLight = new THREE.DirectionalLight(0xb8c8ff, 0.0)
  moonLight.position.set(-18, 26, -12)
  scene.add(moonLight)
  const sunOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff1a6, fog: false }),
  )
  const moonOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xd8ddff, fog: false }),
  )
  scene.add(sunOrb, moonOrb)
  const windowLights: THREE.PointLight[] = []

  // Den gamla prototypträdgården ligger kvar som referens men byggs inte längre.
  // Vites produktionsoptimering tar bort hela det här konstanta blocket.
  if (false) {
  // Lawn
  const groundGeo = new THREE.PlaneGeometry(50, 50)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3b, roughness: 0.9 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  ground.position.y = GROUND
  scene.add(ground)

  // Morotsland: fyrkantiga jordbäddar med raka planteringsrader.
  const carrotPatchCenter = new THREE.Vector2(8, -6)
  const farCarrotPatchCenter = new THREE.Vector2(-12.2, -9.2)
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x5a3821, roughness: 0.96 })
  const soilDarkMat = new THREE.MeshStandardMaterial({ color: 0x3d2819, roughness: 0.98 })
  const addCarrotPatchBed = (center: THREE.Vector2, w: number, d: number, rows: number[]) => {
    const patch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), soilMat)
    patch.position.set(center.x, 0.04, center.y)
    scene.add(patch)
    for (const rowZ of rows) {
      const row = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.035, 0.16), soilDarkMat)
      row.position.set(center.x, 0.095, center.y + rowZ)
      scene.add(row)
    }
  }
  addCarrotPatchBed(carrotPatchCenter, 8.6, 5.8, [-1.85, -0.62, 0.62, 1.85])
  addCarrotPatchBed(farCarrotPatchCenter, 7.2, 4.8, [-1.45, -0.48, 0.48, 1.45])

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

  // Garden details: gravel paths, patio, trees and shrubs.
  const gravelMat = new THREE.MeshStandardMaterial({ color: 0xa8997d, roughness: 0.98 })
  const gravelEdgeMat = new THREE.MeshStandardMaterial({ color: 0x5c5244, roughness: 0.9 })
  const pavingMat = new THREE.MeshStandardMaterial({ color: 0x8f8778, roughness: 0.92 })
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.86 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b33, roughness: 0.85 })
  const leafDarkMat = new THREE.MeshStandardMaterial({ color: 0x245128, roughness: 0.9 })
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xd9d06a, roughness: 0.78 })

  const addPath = (x1: number, z1: number, x2: number, z2: number, width: number) => {
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    const g = new THREE.Group()
    g.position.set((x1 + x2) / 2, 0.018, (z1 + z2) / 2)
    g.rotation.y = Math.atan2(dx, dz)
    const gravel = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, len), gravelMat)
    const leftEdge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, len), gravelEdgeMat)
    const rightEdge = leftEdge.clone()
    leftEdge.position.x = -width / 2 - 0.04
    rightEdge.position.x = width / 2 + 0.04
    g.add(gravel, leftEdge, rightEdge)
    scene.add(g)
  }

  const addCurvedPath = (points: [number, number][], width: number) => {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i]
      const [x2, z2] = points[i + 1]
      addPath(x1, z1, x2, z2, width)
    }
    for (const [x, z] of points.slice(1, -1)) {
      const node = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.52, width * 0.52, 0.038, 18), gravelMat)
      node.position.set(x, 0.02, z)
      scene.add(node)
    }
  }

  addCurvedPath([[-10.7, 12.9], [-6.6, 11.65], [-1.8, 9.45], [4.6, 7.55]], 0.74)
  addCurvedPath([[4.6, 7.55], [5.9, 4.0], [7.25, 0.4], [8.1, -2.6]], 0.64)
  addCurvedPath([[-3.6, 12.8], [-4.1, 14.1], [-3.75, 15.55], [-3.6, 16.9]], 0.7)
  addCurvedPath([[-1.8, 9.45], [-5.2, 4.0], [-8.5, -2.8], [-11.6, -6.6]], 0.58)

  const patio = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 3.2), pavingMat)
  patio.position.set(-8.7, 0.03, 14.45)
  scene.add(patio)
  for (const x of [-10.7, -9.35, -8.0, -6.65]) {
    const joint = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.07, 3.05), gravelEdgeMat)
    joint.position.set(x, 0.075, 14.45)
    scene.add(joint)
  }
  for (const z of [13.65, 14.45, 15.25]) {
    const joint = new THREE.Mesh(new THREE.BoxGeometry(5.15, 0.07, 0.035), gravelEdgeMat)
    joint.position.set(-8.7, 0.076, z)
    scene.add(joint)
  }

  const addTree = (x: number, z: number, s: number) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 1.55 * s, 10), trunkMat)
    trunk.position.set(x, 0.78 * s, z)
    const crown = new THREE.Group()
    crown.position.set(x, 1.75 * s, z)
    for (const [dx, dy, dz, r] of [
      [0, 0, 0, 0.72],
      [-0.35, -0.05, 0.08, 0.48],
      [0.32, -0.02, -0.08, 0.5],
      [0.05, 0.35, 0.04, 0.44],
    ] as [number, number, number, number][]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * s, 16, 12), dy > 0 ? leafMat : leafDarkMat)
      leaf.position.set(dx * s, dy * s, dz * s)
      crown.add(leaf)
    }
    scene.add(trunk, crown)
  }

  const addBush = (x: number, z: number, s: number, flowers = false) => {
    const bush = new THREE.Group()
    bush.position.set(x, 0.18 * s, z)
    for (const [dx, dz, r] of [
      [0, 0, 0.38],
      [-0.28, 0.04, 0.28],
      [0.24, -0.02, 0.3],
      [0.02, 0.25, 0.25],
    ] as [number, number, number][]) {
      const part = new THREE.Mesh(new THREE.SphereGeometry(r * s, 14, 10), leafDarkMat)
      part.scale.y = 0.72
      part.position.set(dx * s, 0, dz * s)
      bush.add(part)
    }
    if (flowers) {
      for (const [dx, dz] of [[-0.12, 0.1], [0.18, -0.08], [0.05, 0.24]] as [number, number][]) {
        const flower = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 8, 6), flowerMat)
        flower.position.set(dx * s, 0.23 * s, dz * s)
        bush.add(flower)
      }
    }
    scene.add(bush)
  }

  addTree(-18, -12, 1.0)
  addTree(16, 13, 0.9)
  addTree(-18, 17, 0.82)
  addTree(18, -15, 0.95)
  addTree(-13.5, -18.2, 0.85)
  addTree(-4.2, -18.5, 0.76)
  addTree(8.5, 17.8, 0.82)
  addTree(19.2, 4.8, 0.78)
  addTree(-20.5, 3.2, 0.72)
  addBush(-14.5, 5, 1.45, true)
  addBush(-6, -13.5, 1.25)
  addBush(12.8, 3.5, 1.35, true)
  addBush(2.2, 13.6, 1.15)
  addBush(15.2, -1.8, 1.2)
  addBush(-17.2, 10.8, 1.25, true)
  addBush(-10.5, -17.4, 1.1)
  addBush(5.5, 15.8, 1.2, true)
  addBush(18.4, 9.8, 1.08)
  addBush(11.5, -15.8, 1.25)
  addTree(-15.6, -5.6, 0.72)
  addTree(-8.4, -10.8, 0.68)
  addTree(3.2, -15.7, 0.74)
  addTree(13.8, -10.8, 0.7)
  addTree(-2.6, 18.8, 0.66)
  addTree(15.8, 16.4, 0.64)
  addBush(-13.8, -6.4, 1.18, true)
  addBush(-10.6, -3.6, 1.05)
  addBush(-14.8, -12.6, 1.15)
  addBush(-6.8, -8.5, 0.98, true)
  addBush(0.8, -12.6, 1.1)
  addBush(6.2, -15.8, 1.02, true)
  addBush(14.9, 6.5, 1.0)
  addBush(17.5, -6.8, 0.96, true)
  addBush(-18.4, -2.2, 1.03)

  // Svensk enplansvilla: låg röd träpanel, vita omfattningar och inbyggt garage på ena gaveln.
  const houseW = 13
  const houseD = 8
  const houseH = 2.65
  const houseG = new THREE.Group()
  const redMat = new THREE.MeshStandardMaterial({ color: 0xba2a20, roughness: 0.5 })
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f2e8, roughness: 0.55 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d332b, roughness: 0.7 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x8db6c9,
    emissive: 0xffb34d,
    emissiveIntensity: 0,
    roughness: 0.18,
    metalness: 0.05,
  })
  const garageMat = new THREE.MeshStandardMaterial({ color: 0xe9e3d8, roughness: 0.62 })
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x5c4030, roughness: 0.7 })

  const house = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), redMat)
  house.position.set(0, houseH / 2 + 0.05, 0)
  houseG.add(house)

  for (let x = -houseW / 2 + 0.35; x < houseW / 2; x += 0.7) {
    const batten = new THREE.Mesh(new THREE.BoxGeometry(0.045, houseH + 0.04, 0.035), redMat)
    batten.position.set(x, houseH / 2 + 0.08, houseD / 2 + 0.02)
    houseG.add(batten)
  }

  const roofW = houseW + 0.8
  const roofD = houseD + 1
  const eaveY = houseH + 0.2
  const ridgeY = houseH + 1.15
  const roofGeo = new THREE.BufferGeometry()
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -roofW / 2, eaveY, -roofD / 2,
    roofW / 2, eaveY, -roofD / 2,
    -roofW / 2, ridgeY, 0,
    roofW / 2, ridgeY, 0,
    -roofW / 2, eaveY, roofD / 2,
    roofW / 2, eaveY, roofD / 2,
  ], 3))
  roofGeo.setIndex([
    0, 1, 3, 0, 3, 2,
    2, 3, 5, 2, 5, 4,
    0, 2, 4,
    1, 5, 3,
    0, 4, 5, 0, 5, 1,
  ])
  roofGeo.computeVertexNormals()
  const houseRoof = new THREE.Mesh(roofGeo, roofMat)
  houseG.add(houseRoof)

  const addWindow = (x: number, z: number, side: 'front' | 'back') => {
    const dir = side === 'front' ? 1 : -1
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.05, 0.08), whiteMat)
    trim.position.set(x, 1.58, z + dir * 0.045)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.095), glassMat)
    glass.position.set(x, 1.58, z + dir * 0.095)
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.76, 0.11), whiteMat)
    crossV.position.copy(glass.position)
    crossV.position.z += dir * 0.01
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.07, 0.11), whiteMat)
    crossH.position.copy(glass.position)
    crossH.position.z += dir * 0.012
    const windowLight = new THREE.PointLight(0xffb35a, 0, 6.2, 2)
    windowLight.position.set(x, 1.56, z + dir * 0.4)
    windowLights.push(windowLight)
    houseG.add(trim, glass, crossV, crossH, windowLight)
  }

  const addGableWindow = (x: number, y: number, z: number) => {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.3), whiteMat)
    trim.position.set(x, y, z)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.62, 0.96), glassMat)
    glass.position.set(x - 0.015, y, z)
    const windowLight = new THREE.PointLight(0xffb35a, 0, 5.2, 2)
    windowLight.position.set(x - 0.4, y, z)
    windowLights.push(windowLight)
    houseG.add(trim, glass, windowLight)
  }

  addWindow(-4.4, houseD / 2, 'front')
  addWindow(-2.6, houseD / 2, 'front')
  addWindow(0.6, houseD / 2, 'front')
  addWindow(2.4, houseD / 2, 'front')
  addWindow(-3.6, -houseD / 2, 'back')
  addWindow(-1.4, -houseD / 2, 'back')
  addWindow(1.6, -houseD / 2, 'back')
  addGableWindow(-houseW / 2 - 0.045, 1.62, -1.65)

  const doorTrim = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.0, 0.09), whiteMat)
  doorTrim.position.set(-0.95, 1.05, houseD / 2 + 0.055)
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.72, 0.11), new THREE.MeshStandardMaterial({ color: 0x6a2f23, roughness: 0.58 }))
  door.position.set(-0.95, 0.96, houseD / 2 + 0.12)
  houseG.add(doorTrim, door)

  const garageDoor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.85, 2.9), garageMat)
  garageDoor.position.set(houseW / 2 + 0.07, 1.05, 1.55)
  houseG.add(garageDoor)
  for (const y of [0.55, 0.95, 1.35]) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 2.7), whiteMat)
    groove.position.set(houseW / 2 + 0.145, y, 1.55)
    houseG.add(groove)
  }

  for (const [dx, dz, w, d] of [
    [-0.95, houseD / 2 + 0.55, 2.0, 1.1],
    [houseW / 2 + 0.45, 1.55, 0.9, 3.4],
  ] as [number, number, number, number][]) {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.16, d),
      deckMat,
    )
    deck.position.set(dx, 0.1, dz)
    houseG.add(deck)
  }
  houseG.position.set(-9.8, 0, 8.3)
  scene.add(houseG)

  // Colliders for house (so Sigge can’t run through)
  const houseAabb: Box3XZ = {
    min: new THREE.Vector2(houseG.position.x - houseW * 0.5 - 0.3, houseG.position.z - houseD * 0.5 - 0.3),
    max: new THREE.Vector2(houseG.position.x + houseW * 0.5 + 0.3, houseG.position.z + houseD * 0.5 + 0.3),
    y0: 0,
    y1: houseH,
  }

  // Kaninbur: ram med hönsnät, vilhylla, ramp, bolåda och kattlucka.
  const hutchG = new THREE.Group()
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.6 })
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xc7d2cb, roughness: 0.35, metalness: 0.2 })
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x8a603d, roughness: 0.7 })
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x7a4f2f, roughness: 0.8 })
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x140d09 })
  const hutchW = 2.6
  const hutchD = 2.5
  const hutchH = 1.55
  const hutchSpec: HutchSpec = {
    w: hutchW,
    d: hutchD,
    doorX: -0.62,
    doorW: 0.68,
  }
  const rail = 0.07
  const wire = 0.012
  const addBox = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = frameMat,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
    mesh.position.set(x, y, z)
    hutchG.add(mesh)
    return mesh
  }

  // Träram med stolpar och räls runt botten och tak.
  for (const x of [-hutchW / 2, hutchW / 2]) {
    for (const z of [-hutchD / 2, hutchD / 2]) {
      addBox(rail, hutchH, rail, x, hutchH / 2, z)
    }
  }
  for (const y of [rail / 2, hutchH - rail / 2]) {
    for (const z of [-hutchD / 2, hutchD / 2]) {
      addBox(hutchW + rail, rail, rail, 0, y, z)
    }
    for (const x of [-hutchW / 2, hutchW / 2]) {
      addBox(rail, rail, hutchD + rail, x, y, 0)
    }
  }

  // Hönsnät på fyra väggar.
  for (let i = 1; i < 6; i++) {
    const x = -hutchW / 2 + (hutchW * i) / 6
    addBox(wire, hutchH - rail * 2, wire, x, hutchH / 2, hutchD / 2 + wire, wireMat)
    addBox(wire, hutchH - rail * 2, wire, x, hutchH / 2, -hutchD / 2 - wire, wireMat)
  }
  for (let i = 1; i < 6; i++) {
    const z = -hutchD / 2 + (hutchD * i) / 6
    addBox(wire, hutchH - rail * 2, wire, hutchW / 2 + wire, hutchH / 2, z, wireMat)
    addBox(wire, hutchH - rail * 2, wire, -hutchW / 2 - wire, hutchH / 2, z, wireMat)
  }
  for (let i = 1; i < 5; i++) {
    const y = rail + ((hutchH - rail * 2) * i) / 5
    addBox(hutchW - rail, wire, wire, 0, y, hutchD / 2 + wire, wireMat)
    addBox(hutchW - rail, wire, wire, 0, y, -hutchD / 2 - wire, wireMat)
    addBox(wire, wire, hutchD - rail, hutchW / 2 + wire, y, 0, wireMat)
    addBox(wire, wire, hutchD - rail, -hutchW / 2 - wire, y, 0, wireMat)
  }

  // Nättak.
  for (let i = 1; i < 6; i++) {
    const x = -hutchW / 2 + (hutchW * i) / 6
    const z = -hutchD / 2 + (hutchD * i) / 6
    addBox(wire, wire, hutchD - rail, x, hutchH + wire, 0, wireMat)
    addBox(hutchW - rail, wire, wire, 0, hutchH + wire * 2, z, wireMat)
  }

  // Liten kattlucka i frontnätet.
  addBox(0.58, 0.4, 0.035, hutchSpec.doorX, 0.3, hutchD / 2 + 0.035, shadowMat)
  addBox(0.68, 0.045, 0.055, hutchSpec.doorX, 0.52, hutchD / 2 + 0.06, frameMat)
  addBox(0.045, 0.44, 0.055, hutchSpec.doorX - hutchSpec.doorW / 2, 0.3, hutchD / 2 + 0.06, frameMat)
  addBox(0.045, 0.44, 0.055, hutchSpec.doorX + hutchSpec.doorW / 2, 0.3, hutchD / 2 + 0.06, frameMat)

  // Inredning: bolåda, vilhylla och ramp.
  const shelfY = 0.65
  addBox(0.78, 0.5, 0.64, -0.72, 0.25, -0.7, boxMat)
  addBox(0.42, 0.3, 0.045, -0.72, 0.22, -0.36, shadowMat)
  addBox(0.94, 0.08, 0.66, 0.48, shelfY - 0.04, -0.62, shelfMat)
  addBox(0.08, 0.32, 0.08, 0.1, 0.62, -0.88, frameMat)
  addBox(0.08, 0.32, 0.08, 0.86, 0.62, -0.88, frameMat)

  const rampSpec: RampSpec = {
    x: 0.28,
    zBottom: 0.78,
    zTop: -0.31,
    w: 0.52,
    yBottom: 0.08,
    yTop: shelfY,
  }
  const rampRun = rampSpec.zBottom - rampSpec.zTop
  const rampRise = rampSpec.yTop - rampSpec.yBottom
  const rampLen = Math.hypot(rampRun, rampRise)
  const rampAngle = Math.atan2(rampRise, rampRun)
  const rampG = new THREE.Group()
  rampG.position.set(rampSpec.x, (rampSpec.yBottom + rampSpec.yTop) / 2, (rampSpec.zBottom + rampSpec.zTop) / 2)
  rampG.rotation.x = rampAngle
  const rampBoard = new THREE.Mesh(new THREE.BoxGeometry(rampSpec.w, 0.045, rampLen), shelfMat)
  rampG.add(rampBoard)
  for (let i = 0; i < 5; i++) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(rampSpec.w + 0.06, 0.04, 0.035), frameMat)
    cleat.position.set(0, 0.045, rampLen * (0.34 - i * 0.17))
    rampG.add(cleat)
  }
  hutchG.add(rampG)

  hutchG.position.set(5.2, 0, 6.2)
  scene.add(hutchG)

  const hutchCenter = hutchG.position.clone()
  hutchCenter.y = 0.5

  // Safe AABB: inside the hutch
  // min.x/max.x = world x; min.y/max.y = world z
  const hutchAabb: Box3XZ = {
    min: new THREE.Vector2(hutchG.position.x - hutchW / 2, hutchG.position.z - hutchD / 2),
    max: new THREE.Vector2(hutchG.position.x + hutchW / 2, hutchG.position.z + hutchD / 2),
    y0: 0,
    y1: hutchH,
  }

  void houseAabb
  void hutchAabb
  }

  // Den tidigare prototypträdgården ovan ersätts av den skalenliga Kronan-kartan.
  // Spelmekaniken nedan behålls, men arbetar mot den nya miljöns kolliderare och burar.
  const neighborhood = buildNeighborhood(scene)
  const realCarrotPatchCenter = neighborhood.carrotPatches[0]
  const whiteHouseCarrotPatchCenter = neighborhood.carrotPatches[1]
  const realSoilMat = new THREE.MeshStandardMaterial({ color: 0x5a3821, roughness: 0.96 })
  const realSoilDarkMat = new THREE.MeshStandardMaterial({ color: 0x3d2819, roughness: 0.98 })
  const addRealCarrotPatchBed = (center: THREE.Vector2, w: number, d: number, rows: number[]) => {
    const patch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), realSoilMat)
    patch.position.set(center.x, terrainHeightAt(center.x, center.y) + 0.04, center.y)
    scene.add(patch)
    for (const rowZ of rows) {
      const row = new THREE.Mesh(new THREE.BoxGeometry(w - 0.55, 0.035, 0.15), realSoilDarkMat)
      const z = center.y + rowZ
      row.position.set(center.x, terrainHeightAt(center.x, z) + 0.095, z)
      scene.add(row)
    }
  }
  addRealCarrotPatchBed(realCarrotPatchCenter, 7.4, 4.6, [-1.35, -0.45, 0.45, 1.35])
  addRealCarrotPatchBed(whiteHouseCarrotPatchCenter, 3.6, 4.2, [-1.25, -0.42, 0.42, 1.25])

  // Carrots
  const carrots: CarrotPlant[] = []
  const carrotMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    emissive: 0x100400,
    emissiveIntensity: 0.22,
    roughness: 0.75,
  })
  const coloredCarrotGeometry = (
    geometry: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    position: THREE.Vector3,
    rotation = new THREE.Euler(),
  ) => {
    const transform = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(rotation),
      new THREE.Vector3(1, 1, 1),
    )
    geometry.applyMatrix4(transform)
    const rgb = new THREE.Color(color)
    const colors = new Float32Array(geometry.getAttribute('position').count * 3)
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = rgb.r
      colors[i + 1] = rgb.g
      colors[i + 2] = rgb.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geometry
  }
  const carrotEdibleGeometry = mergeGeometries([
    coloredCarrotGeometry(
      new THREE.CylinderGeometry(0.08, 0.18, 0.24, 12),
      0xf28a24,
      new THREE.Vector3(0, 0.18, 0),
    ),
    coloredCarrotGeometry(
      new THREE.ConeGeometry(0.105, 0.34, 12),
      0xe9781d,
      new THREE.Vector3(0, 0.13, 0),
      new THREE.Euler(Math.PI, 0, 0),
    ),
  ])
  const carrotGreenParts = Array.from({ length: 7 }, (_, i) => {
    const angle = (i / 7) * Math.PI * 2
    const tilt = 0.35 + (i % 2) * 0.18
    return coloredCarrotGeometry(
      new THREE.ConeGeometry(0.025, 0.44 + (i % 3) * 0.07, 5),
      0x286f22,
      new THREE.Vector3(Math.cos(angle) * 0.045, 0.43, Math.sin(angle) * 0.045),
      new THREE.Euler(Math.sin(angle) * tilt, angle, -Math.cos(angle) * tilt),
    )
  })
  const carrotGreensGeometry = mergeGeometries(carrotGreenParts)
  if (!carrotEdibleGeometry || !carrotGreensGeometry) {
    throw new Error('Could not merge carrot geometry')
  }
  const makeCarrot = (lean: number): CarrotPlant => {
    const root = new THREE.Group()
    const edible = new THREE.Group()
    const greens = new THREE.Group()
    edible.add(new THREE.Mesh(carrotEdibleGeometry, carrotMaterial))
    greens.add(new THREE.Mesh(carrotGreensGeometry, carrotMaterial))
    greens.rotation.y = lean

    root.add(edible, greens)
    const plant = {
      root,
      edible,
      greens,
      picked: false,
      regrowLeft: 0,
      regrowTotal: 0,
    }
    setCarrotPlantGrowth(plant, 1)
    return plant
  }
  const addCarrots = (center: THREE.Vector2, rows: number[], cols: number[], skip: (row: number, col: number) => boolean) => {
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < cols.length; col++) {
        if (skip(row, col)) {
          continue
        }
        const plant = makeCarrot(row * 0.45 + col * 0.18)
        const offsetX = ((row + col) % 2 === 0 ? -0.08 : 0.08)
        const offsetZ = col % 2 === 0 ? 0.04 : -0.04
        const plantX = center.x + cols[col] + offsetX
        const plantZ = center.y + rows[row] + offsetZ
        plant.root.position.set(plantX, terrainHeightAt(plantX, plantZ) + 0.08, plantZ)
        plant.root.rotation.y = ((row + col) % 3 - 1) * 0.08
        scene.add(plant.root)
        carrots.push(plant)
      }
    }
  }
  addCarrots(realCarrotPatchCenter, [-1.35, -0.45, 0.45, 1.35], [-2.7, -1.35, 0, 1.35, 2.7], (row, col) => (
    (row === 0 && col === 4) || (row === 3 && col === 0)
  ))
  addCarrots(whiteHouseCarrotPatchCenter, [-1.25, -0.42, 0.42, 1.25], [-1.25, -0.42, 0.42, 1.25], (row, col) => (
    (row === 1 && col === 0) || (row === 2 && col === 3)
  ))

  // Spelaren använder samma modellbyggare som NPC-kaninerna och 3D-valet på startskärmen.
  const playerRabbit = createRabbitModel('sigge')
  const siggeG = playerRabbit.root
  const siggeVisual = playerRabbit.visual
  const siggeArmor = playerRabbit.armor
  siggeG.position.copy(neighborhood.spawns.sigge)
  scene.add(siggeG)

  const setPlayerCharacter = (character: CharacterId) => {
    applyRabbitCharacter(playerRabbit, character)
  }

  const npcRabbits = {} as Record<CharacterId, RabbitNpc>
  for (const [index, character] of (['sigge', 'kurre'] as CharacterId[]).entries()) {
    const model = createRabbitModel(character)
    const hutch = neighborhood.hutches.find((candidate) => candidate.name.toLowerCase() === character)!
    const [targetX, targetZ] = NPC_PATROL_POINTS[(index * 2 + 1) % NPC_PATROL_POINTS.length]
    const rabbit: RabbitNpc = {
      ...model,
      character,
      hutch,
      target: new THREE.Vector2(hutch.center.x + targetX, hutch.center.z + targetZ),
      patrolIndex: (index * 2 + 1) % NPC_PATROL_POINTS.length,
      waitLeft: 0.35 + index * 0.25,
      walkPhase: index * Math.PI,
    }
    rabbit.root.position.set(hutch.center.x, hutch.aabb.y0, hutch.center.z - 0.18)
    rabbit.root.rotation.y = 0
    rabbit.root.visible = false
    npcRabbits[character] = rabbit
    scene.add(rabbit.root)
  }
  const setNpcForSelection = (selected: CharacterId) => {
    npcRabbits.sigge.root.visible = selected === 'kurre'
    npcRabbits.kurre.root.visible = selected === 'sigge'
  }

  // Fox
  const foxG = new THREE.Group()
  const orange = new THREE.MeshStandardMaterial({ color: 0xd45a1a, roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a0f05, roughness: 0.5 })
  const cream = new THREE.MeshStandardMaterial({ color: 0xf3e2bd, roughness: 0.7 })
  const black = new THREE.MeshBasicMaterial({ color: 0x120806, fog: false })
  const toothMat = new THREE.MeshBasicMaterial({ color: 0xfff3d8, fog: false })
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
  const mouthLine = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.014, 0.08), black)
  mouthLine.position.set(0, 0.492, 0.82)
  const lowerJawG = new THREE.Group()
  lowerJawG.position.set(0, 0.49, 0.77)
  const lowerJaw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), cream)
  lowerJaw.scale.set(1.12, 0.36, 0.95)
  lowerJaw.position.set(0, -0.03, 0.08)
  lowerJawG.add(lowerJaw)
  for (const x of [-0.05, 0.05]) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.04, 5), toothMat)
    tooth.position.set(x, -0.005, 0.12)
    lowerJawG.add(tooth)
  }
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
  const tail = new THREE.Group()
  tail.position.set(0, 0.42, -0.46)
  tail.rotation.x = -0.46
  for (const [z, y, sx, sy, sz] of [
    [-0.08, 0.0, 0.15, 0.12, 0.22],
    [-0.25, 0.05, 0.19, 0.15, 0.28],
    [-0.44, 0.09, 0.22, 0.17, 0.3],
    [-0.62, 0.13, 0.18, 0.15, 0.24],
  ] as [number, number, number, number, number][]) {
    const segment = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), orange)
    segment.scale.set(sx, sy, sz)
    segment.position.set(0, y, z)
    tail.add(segment)
  }
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cream)
  tailTip.scale.set(0.16, 0.13, 0.2)
  tailTip.position.set(0, 0.17, -0.78)
  tail.add(tailTip)
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
    mouthLine,
    lowerJaw: lowerJawG,
    tail,
    legs,
    baseY: 0,
    bodyY: fBody.position.y,
    chestY: fChest.position.y,
    headY: fHead.position.y,
    headZ: fHead.position.z,
    snoutY: snout.position.y,
    snoutZ: snout.position.z,
    noseY: foxNose.position.y,
    noseZ: foxNose.position.z,
    mouthLineY: mouthLine.position.y,
    mouthLineZ: mouthLine.position.z,
    lowerJawY: lowerJawG.position.y,
    lowerJawZ: lowerJawG.position.z,
    lowerJawRotX: lowerJawG.rotation.x,
    tailRotX: tail.rotation.x,
    tailRotZ: tail.rotation.z,
  }
  foxG.add(
    fBody,
    fChest,
    fHead,
    snout,
    foxNose,
    mouthLine,
    lowerJawG,
    leftFoxEye,
    rightFoxEye,
    leftFoxEar,
    rightFoxEar,
    tail,
    ...legs,
  )
  foxG.visible = false
  scene.add(foxG)

  // Cat
  const catG = new THREE.Group()
  const catMat = new THREE.MeshStandardMaterial({ color: 0x80878d, roughness: 0.62 })
  const catDarkMat = new THREE.MeshStandardMaterial({ color: 0x353a3d, roughness: 0.66 })
  const catLightMat = new THREE.MeshStandardMaterial({ color: 0xc7c9c8, roughness: 0.7 })
  const cBody = new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 12), catMat)
  cBody.scale.set(0.78, 0.5, 1.34)
  cBody.position.y = 0.31
  const cChest = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), catLightMat)
  cChest.scale.set(0.8, 0.55, 0.45)
  cChest.position.set(0, 0.32, 0.34)
  const cHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), catMat)
  cHead.scale.set(0.96, 0.78, 0.92)
  cHead.position.set(0, 0.52, 0.55)
  const cSnout = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), catLightMat)
  cSnout.scale.set(1.12, 0.58, 0.84)
  cSnout.position.set(0, 0.48, 0.72)
  const catNose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), black)
  catNose.scale.set(1.15, 0.75, 0.75)
  catNose.position.set(0, 0.49, 0.82)
  const catMouthLine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.011, 0.055), black)
  catMouthLine.position.set(0, 0.452, 0.76)
  const catLowerJawG = new THREE.Group()
  catLowerJawG.position.set(0, 0.45, 0.7)
  const catLowerJaw = new THREE.Mesh(new THREE.SphereGeometry(0.054, 10, 8), catLightMat)
  catLowerJaw.scale.set(1.08, 0.34, 0.88)
  catLowerJaw.position.set(0, -0.02, 0.08)
  catLowerJawG.add(catLowerJaw)
  const leftCatEye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 8, 6), new THREE.MeshBasicMaterial({ color: 0xa8ff80, fog: false }))
  leftCatEye.position.set(-0.075, 0.56, 0.7)
  const rightCatEye = leftCatEye.clone()
  rightCatEye.position.x = 0.075
  const leftCatEar = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), catMat)
  leftCatEar.rotation.set(0.1, 0.22, -0.1)
  leftCatEar.position.set(-0.13, 0.69, 0.47)
  const rightCatEar = leftCatEar.clone()
  rightCatEar.rotation.set(0.1, -0.22, 0.1)
  rightCatEar.position.x = 0.13
  const catTail = new THREE.Group()
  catTail.position.set(0, 0.38, -0.44)
  catTail.rotation.x = -0.2
  for (const [z, y, sx, sy, sz] of [
    [-0.1, 0.02, 0.075, 0.07, 0.18],
    [-0.28, 0.08, 0.07, 0.065, 0.2],
    [-0.45, 0.17, 0.064, 0.06, 0.18],
    [-0.56, 0.29, 0.058, 0.055, 0.14],
  ] as [number, number, number, number, number][]) {
    const segment = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), catMat)
    segment.scale.set(sx, sy, sz)
    segment.position.set(0, y, z)
    catTail.add(segment)
  }
  const catLegs: THREE.Mesh[] = []
  for (const x of [-0.15, 0.15]) {
    for (const z of [-0.23, 0.26]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.043, 0.25, 8), catDarkMat)
      leg.position.set(x, 0.13, z)
      catLegs.push(leg)
    }
  }
  catG.userData.parts = {
    body: cBody,
    chest: cChest,
    head: cHead,
    snout: cSnout,
    nose: catNose,
    mouthLine: catMouthLine,
    lowerJaw: catLowerJawG,
    tail: catTail,
    legs: catLegs,
    baseY: 0,
    bodyY: cBody.position.y,
    chestY: cChest.position.y,
    headY: cHead.position.y,
    headZ: cHead.position.z,
    snoutY: cSnout.position.y,
    snoutZ: cSnout.position.z,
    noseY: catNose.position.y,
    noseZ: catNose.position.z,
    mouthLineY: catMouthLine.position.y,
    mouthLineZ: catMouthLine.position.z,
    lowerJawY: catLowerJawG.position.y,
    lowerJawZ: catLowerJawG.position.z,
    lowerJawRotX: catLowerJawG.rotation.x,
    tailRotX: catTail.rotation.x,
    tailRotZ: catTail.rotation.z,
  }
  catG.add(
    cBody,
    cChest,
    cHead,
    cSnout,
    catNose,
    catMouthLine,
    catLowerJawG,
    leftCatEye,
    rightCatEye,
    leftCatEar,
    rightCatEar,
    catTail,
    ...catLegs,
  )
  catG.visible = false
  scene.add(catG)

  return {
    scene,
    siggeG,
    siggeVisual,
    siggeArmor,
    setPlayerCharacter,
    setNpcForSelection,
    npcRabbits,
    foxG,
    catG,
    carrots,
    hemi,
    sun,
    moonLight,
    sunOrb,
    moonOrb,
    windowMaterials: neighborhood.windowMaterials,
    colliders: neighborhood.colliders,
    platforms: neighborhood.platforms,
    hedges: neighborhood.hedges,
    hutches: neighborhood.hutches,
    spawns: neighborhood.spawns,
  }
}

function main() {
  const root = document.getElementById('app')!
  const renderProfile = detectRenderProfile()
  // HUD: läs in efter att DOM:en finns; index.html ersätts i bygget med rätt "Kod:" redan
  const elEnergy = document.getElementById('energy-bar') as HTMLDivElement | null
  const elNightCount = document.getElementById('night-count') as HTMLSpanElement | null
  const elCycle = document.getElementById('cycle-state') as HTMLSpanElement | null
  const elItems = document.getElementById('item-status') as HTMLSpanElement | null
  const elRiskChallenge = document.getElementById('risk-challenge') as HTMLParagraphElement | null
  const elRiskBonus = document.getElementById('risk-bonus') as HTMLSpanElement | null
  const elRiskPointer = document.getElementById('risk-pointer') as HTMLDivElement | null
  const elRiskPointerArrow = document.getElementById('risk-pointer-arrow') as HTMLSpanElement | null
  const elRiskPointerDistance = document.getElementById('risk-pointer-distance') as HTMLSpanElement | null
  const elPickup = document.getElementById('hud-pickup') as HTMLParagraphElement | null
  const elFox = document.getElementById('hud-fox') as HTMLParagraphElement | null
  const elSafe = document.getElementById('hud-safe') as HTMLParagraphElement | null
  const elGameOver = document.getElementById('hud-gameover') as HTMLParagraphElement | null
  const elGameOverDialog = document.getElementById('gameover-dialog') as HTMLDivElement | null
  const elGameOverDetail = document.getElementById('gameover-detail') as HTMLParagraphElement | null
  const elHighscoreForm = document.getElementById('highscore-form') as HTMLFormElement | null
  const elHighscoreName = document.getElementById('highscore-name') as HTMLInputElement | null
  const elHighscoreSubmit = document.getElementById('highscore-submit') as HTMLButtonElement | null
  const elHighscoreStatus = document.getElementById('highscore-status') as HTMLParagraphElement | null
  const elHighscoreList = document.getElementById('highscore-list') as HTMLOListElement | null
  const elRestart = document.getElementById('restart-game') as HTMLButtonElement | null
  const elMoveZone = document.getElementById('move-zone') as HTMLDivElement | null
  const elMoveStick = document.getElementById('move-stick') as HTMLDivElement | null
  const elMoveKnob = document.getElementById('move-knob') as HTMLDivElement | null
  const elCameraZone = document.getElementById('camera-zone') as HTMLDivElement | null
  const elJumpZone = document.getElementById('jump-zone') as HTMLButtonElement | null
  const elStartScreen = document.getElementById('start-screen') as HTMLDivElement | null
  const elRotateScreen = document.getElementById('rotate-screen') as HTMLDivElement | null
  const elNpcSpeech = document.getElementById('npc-speech') as HTMLDivElement | null
  const characterButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-character]'))
  const characterPreviews = setupCharacterPreviews(renderProfile)
  const elPlayerName = document.getElementById('player-name') as HTMLSpanElement | null
  const rev = document.getElementById('hud-rev')
  if (rev) {
    rev.textContent = `Kod: ${BUILD_TAG}`
  }
  const {
    scene,
    siggeG,
    siggeVisual,
    siggeArmor,
    setPlayerCharacter,
    setNpcForSelection,
    npcRabbits,
    foxG,
    catG,
    carrots,
    hemi,
    sun,
    moonLight,
    sunOrb,
    moonOrb,
    windowMaterials,
    colliders,
    platforms,
    hedges,
    hutches,
    spawns,
  } = buildScene()
  const audio = new AudioDirector()

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
  let rendererPixelRatio = renderProfile.initialPixelRatio
  const renderer = new THREE.WebGLRenderer({ antialias: renderProfile.antialias, powerPreference: 'high-performance' })
  renderer.setPixelRatio(rendererPixelRatio)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = false
  root.appendChild(renderer.domElement)

  const keys: Record<string, boolean> = {}
  const touchMove = {
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    radius: 64,
    x: 0,
    y: 0,
  }
  const touchCamera = {
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  }
  let jumpBufferLeft = 0
  const pVel = new THREE.Vector3(0, 0, 0)
  const jumpDirection = new THREE.Vector2(0, 1)
  const foxP = new THREE.Vector3(0, 0, 12)
  const catP = new THREE.Vector3(0, 0, -12)
  /** Var Sigge tittar (Y-rotation) — kameran följer bakifrån. */
  let playerFacing = 0
  let cameraYaw = 0
  let cameraPitch = 0.18
  let hopPhase = 0
  const TURN_SPD = 2.2
  let energy = START_ENERGY
  let onGround = true
  let airborneForwardSpeed = 0
  let jumpChain = 0
  let lastJumpAt = Number.NEGATIVE_INFINITY
  let gameOver = false
  let foxMode: FoxMode = 'hidden'
  let foxNext = 5
  let foxSniffLeft = 0
  let foxWalkPhase = 0
  let foxBiteCooldown = 0
  let foxBiteAnimLeft = 0
  let catMode: FoxMode = 'hidden'
  let catNext = 12
  let catSniffLeft = 0
  let catWalkPhase = 0
  let catBiteCooldown = 0
  let catBiteAnimLeft = 0
  let cycleClock = TWILIGHT_SECONDS * 0.45
  let survivedNights = 0
  let wasNight = false
  let armorCharges = 0
  let shieldPotionLeft = 0
  let speedPotionLeft = 0
  let pickupSpawnNext = 7
  let pickupMessageLeft = 0
  let mobileStarted = !isMobileLike()
  let titleStarted = false
  let selectedCharacter: CharacterId = 'sigge'
  let finishedRun: { nights: number; rabbit: CharacterId } | null = null
  let submittedHighscoreId: string | null = null
  let highscoreViewGeneration = 0
  let activeRiskChallenge: RiskChallengeKind | null = null
  let riskChallengeIndex = 0
  let riskChallengeTimeLeft = 0
  let riskChallengePauseLeft = 0
  let riskChallengeNotice = ''
  let cycleBoostLeft = 0
  let nightMultiplierLeft = 0
  let carrotBoostLeft = 0
  let npcGreetingLeft = 0
  let npcGreetingArmed = true
  const npcSpeechPosition = new THREE.Vector3()
  const foxTarget = new THREE.Vector3()
  const foxLeaveTarget = new THREE.Vector3()
  const foxMoveDelta = new THREE.Vector3()
  const foxToPlayer = new THREE.Vector3()
  const catTarget = new THREE.Vector3()
  const catLeaveTarget = new THREE.Vector3()
  const catMoveDelta = new THREE.Vector3()
  const catToPlayer = new THREE.Vector3()
  const cameraForward = new THREE.Vector3()
  const cameraBack = new THREE.Vector3()
  const cameraPosition = new THREE.Vector3()
  const cameraTarget = new THREE.Vector3()
  const riskPointerTarget = new THREE.Vector3()
  const pickups: Pickup[] = []
  const skyDay = new THREE.Color(0x6eb8d4)
  const skyTwilight = new THREE.Color(0xf5a06c)
  const skyNight = new THREE.Color(0x070b1c)
  const fogDay = new THREE.Color(0x8ec8e0)
  const fogTwilight = new THREE.Color(0xf0a178)
  const fogNight = new THREE.Color(0x090d1a)
  const currentSky = new THREE.Color()
  const currentFog = new THREE.Color()
  const riskDandelion = createRiskDandelion()
  const riskChallengeOrder: RiskChallengeKind[] = ['fox-jump', 'night-dandelion', 'predator-carrot']
  scene.add(riskDandelion)

  function isMobileLike(): boolean {
    return navigator.maxTouchPoints > 0 || window.matchMedia('(hover: none), (pointer: coarse)').matches
  }

  function isPortrait(): boolean {
    return window.innerHeight > window.innerWidth
  }

  function mobileBlocked(): boolean {
    return !titleStarted || (isMobileLike() && (!mobileStarted || isPortrait()))
  }

  function updateMobileOverlays() {
    const mobile = isMobileLike()
    const portrait = isPortrait()
    const showStart = (!mobile || !portrait) && (!titleStarted || (mobile && !mobileStarted))
    elStartScreen?.classList.toggle('mobile-overlay--hidden', !showStart)
    elRotateScreen?.classList.toggle('mobile-overlay--hidden', !mobile || !portrait)
    if (!mobile) {
      mobileStarted = true
    }
    if (mobileBlocked()) {
      resetTouchControls()
    }
  }

  function inSafeZone(x: number, y: number, z: number): boolean {
    return hutches.some((hutch) => (
      aabb2ContainsXZ(hutch.aabb, x, z) && y + PLAYER_H * 0.3 >= hutch.aabb.y0 && y < hutch.aabb.y1 + 0.2
    ))
  }

  function hutchFloorY(x: number, z: number): number {
    const hutch = hutches.find((candidate) => aabb2ContainsXZ(candidate.aabb, x, z))
    if (!hutch) {
      return terrainHeightAt(x, z)
    }

    const localX = x - hutch.center.x
    const localZ = z - hutch.center.z
    let floorY = hutch.aabb.y0

    const onShelf = (
      localX >= 0.43 - 0.43 - PLAYER_R * 0.35 &&
      localX <= 0.43 + 0.43 + PLAYER_R * 0.35 &&
      localZ >= -0.48 - 0.31 - PLAYER_R * 0.35 &&
      localZ <= -0.48 + 0.31 + PLAYER_R * 0.35
    )
    if (onShelf) {
      floorY = Math.max(floorY, hutch.aabb.y0 + hutch.ramp.yTop)
    }

    const onRamp = (
      localX >= hutch.ramp.x - hutch.ramp.w / 2 - PLAYER_R * 0.25 &&
      localX <= hutch.ramp.x + hutch.ramp.w / 2 + PLAYER_R * 0.25 &&
      localZ >= hutch.ramp.zTop &&
      localZ <= hutch.ramp.zBottom
    )
    if (onRamp) {
      const t = THREE.MathUtils.clamp((hutch.ramp.zBottom - localZ) / (hutch.ramp.zBottom - hutch.ramp.zTop), 0, 1)
      floorY = Math.max(floorY, hutch.aabb.y0 + THREE.MathUtils.lerp(hutch.ramp.yBottom, hutch.ramp.yTop, t))
    }

    return floorY
  }

  function raisedPlatformFloorY(x: number, y: number, z: number): number {
    let floorY = Number.NEGATIVE_INFINITY
    for (const platform of platforms) {
      if (aabb2ContainsXZ(platform.aabb, x, z) && y >= platform.topY - 0.08) {
        floorY = Math.max(floorY, platform.topY)
      }
    }
    return floorY
  }

  function inHutchDoor(hutch: HutchZone, localX: number): boolean {
    return Math.abs(localX - hutch.spec.doorX) <= hutch.spec.doorW / 2
  }

  function resolveOneHutchWalls(hutch: HutchZone, prevX: number, prevZ: number, x: number, z: number): { x: number; z: number } {
    const halfW = hutch.spec.w / 2
    const halfD = hutch.spec.d / 2
    const prevLocalX = prevX - hutch.center.x
    const prevLocalZ = prevZ - hutch.center.z
    const localX = x - hutch.center.x
    const localZ = z - hutch.center.z
    const prevInside = Math.abs(prevLocalX) <= halfW && Math.abs(prevLocalZ) <= halfD
    const nextInside = Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD
    const nearDoor = inHutchDoor(hutch, (prevLocalX + localX) / 2)
    const throughDoor = nearDoor && (
      (prevLocalZ <= halfD && localZ >= halfD - PLAYER_R) ||
      (prevLocalZ >= halfD && localZ <= halfD + PLAYER_R)
    )

    if (throughDoor) {
      return { x, z }
    }

    if (prevInside) {
      return {
        x: hutch.center.x + THREE.MathUtils.clamp(localX, -halfW + PLAYER_R, halfW - PLAYER_R),
        z: hutch.center.z + THREE.MathUtils.clamp(localZ, -halfD + PLAYER_R, halfD - PLAYER_R),
      }
    }

    if (nextInside) {
      const dxLeft = Math.abs(prevLocalX + halfW)
      const dxRight = Math.abs(prevLocalX - halfW)
      const dzBack = Math.abs(prevLocalZ + halfD)
      const dzFront = Math.abs(prevLocalZ - halfD)
      const nearest = Math.min(dxLeft, dxRight, dzBack, dzFront)
      if (nearest === dxLeft) {
        return { x: hutch.center.x - halfW - PLAYER_R, z }
      }
      if (nearest === dxRight) {
        return { x: hutch.center.x + halfW + PLAYER_R, z }
      }
      if (nearest === dzBack) {
        return { x, z: hutch.center.z - halfD - PLAYER_R }
      }
      return { x, z: hutch.center.z + halfD + PLAYER_R }
    }

    const overlapsHutchBand = Math.abs(localX) <= halfW + PLAYER_R && Math.abs(localZ) <= halfD + PLAYER_R
    if (overlapsHutchBand) {
      const fromLeft = Math.abs(localX + halfW)
      const fromRight = Math.abs(localX - halfW)
      const fromBack = Math.abs(localZ + halfD)
      const fromFront = Math.abs(localZ - halfD)
      const nearest = Math.min(fromLeft, fromRight, fromBack, fromFront)
      if (nearest === fromLeft) {
        return { x: hutch.center.x - halfW - PLAYER_R, z }
      }
      if (nearest === fromRight) {
        return { x: hutch.center.x + halfW + PLAYER_R, z }
      }
      if (nearest === fromBack) {
        return { x, z: hutch.center.z - halfD - PLAYER_R }
      }
      if (!inHutchDoor(hutch, localX)) {
        return { x, z: hutch.center.z + halfD + PLAYER_R }
      }
    }

    return { x, z }
  }

  function resolveHutchWalls(prevX: number, prevZ: number, x: number, z: number): { x: number; z: number } {
    let result = { x, z }
    for (const hutch of hutches) {
      result = resolveOneHutchWalls(hutch, prevX, prevZ, result.x, result.z)
    }
    return result
  }

  function resolvePredatorOutsideHutches(x: number, z: number, clearance: number): { x: number; z: number } {
    let result = { x, z }
    for (const hutch of hutches) {
      result = resolveCircleAabb2(
        hutch.aabb.min.x,
        hutch.aabb.min.y,
        hutch.aabb.max.x,
        hutch.aabb.max.y,
        result.x,
        result.z,
        clearance,
      )
    }
    return result
  }

  function setTargetOutsideHutch(
    target: THREE.Vector3,
    hutch: HutchZone,
    from: THREE.Vector3,
    clearance: number,
    y: number,
  ) {
    const direction = from.clone().sub(hutch.center)
    direction.y = 0
    if (direction.lengthSq() < 0.01) {
      direction.set(0, 0, -1)
    }
    direction.normalize()
    const halfW = hutch.spec.w / 2
    const halfD = hutch.spec.d / 2
    const tx = Math.abs(direction.x) < 1e-5 ? Number.POSITIVE_INFINITY : halfW / Math.abs(direction.x)
    const tz = Math.abs(direction.z) < 1e-5 ? Number.POSITIVE_INFINITY : halfD / Math.abs(direction.z)
    const boundaryDistance = Math.min(tx, tz)
    const dominantAxis = Math.max(Math.abs(direction.x), Math.abs(direction.z))
    const centerDistance = boundaryDistance + clearance / dominantAxis
    target.set(
      hutch.center.x + direction.x * centerDistance,
      y,
      hutch.center.z + direction.z * centerDistance,
    )
  }

  function riskChallengeDuration(kind: RiskChallengeKind): number {
    return kind === 'night-dandelion' ? 95 : 55
  }

  function randomRiskDandelionPosition(): THREE.Vector3 {
    for (let i = 0; i < 80; i++) {
      const x = THREE.MathUtils.randFloat(-WORLD_HALF_X + 2, WORLD_HALF_X - 2)
      const z = THREE.MathUtils.randFloat(-WORLD_HALF_Z + 2, WORLD_HALF_Z - 2)
      const nearHouse = colliders.some((collider) => (
        x >= collider.min.x - 0.9 && x <= collider.max.x + 0.9
        && z >= collider.min.y - 0.9 && z <= collider.max.y + 0.9
      ))
      const farFromHutches = hutches.every((hutch) => Math.hypot(x - hutch.center.x, z - hutch.center.z) >= 9)
      if (nearHouse || !farFromHutches || Math.hypot(x - siggeG.position.x, z - siggeG.position.z) < 5) {
        continue
      }
      return new THREE.Vector3(x, terrainHeightAt(x, z), z)
    }
    return new THREE.Vector3(-INNER + 3, terrainHeightAt(-INNER + 3, -WORLD_HALF_Z + 3), -WORLD_HALF_Z + 3)
  }

  function activePredatorDistance(): number {
    let distance = Number.POSITIVE_INFINITY
    if (foxMode === 'chase') {
      distance = Math.min(distance, Math.hypot(foxG.position.x - siggeG.position.x, foxG.position.z - siggeG.position.z))
    }
    if (catMode === 'chase') {
      distance = Math.min(distance, Math.hypot(catG.position.x - siggeG.position.x, catG.position.z - siggeG.position.z))
    }
    return distance
  }

  function getRiskPointerTarget(target: THREE.Vector3): boolean {
    if (!titleStarted || gameOver || !activeRiskChallenge) {
      return false
    }
    if (activeRiskChallenge === 'night-dandelion') {
      target.copy(riskDandelion.position)
      return true
    }
    if (activeRiskChallenge === 'fox-jump') {
      if (foxMode !== 'chase') {
        return false
      }
      target.copy(foxG.position)
      return true
    }

    let closestDistanceSq = Number.POSITIVE_INFINITY
    let found = false
    if (foxMode === 'chase') {
      closestDistanceSq = foxG.position.distanceToSquared(siggeG.position)
      target.copy(foxG.position)
      found = true
    }
    if (catMode === 'chase') {
      const catDistanceSq = catG.position.distanceToSquared(siggeG.position)
      if (catDistanceSq < closestDistanceSq) {
        target.copy(catG.position)
      }
      found = true
    }
    return found
  }

  function updateRiskPointer(): void {
    if (!elRiskPointer || !elRiskPointerArrow || !elRiskPointerDistance || !getRiskPointerTarget(riskPointerTarget)) {
      elRiskPointer?.classList.add('risk-pointer--hidden')
      return
    }

    const dx = riskPointerTarget.x - siggeG.position.x
    const dz = riskPointerTarget.z - siggeG.position.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.2) {
      elRiskPointer.classList.add('risk-pointer--hidden')
      return
    }

    const worldAngle = Math.atan2(dx, dz)
    const relativeAngle = Math.atan2(Math.sin(worldAngle - cameraYaw), Math.cos(worldAngle - cameraYaw))
    const directionX = Math.sin(relativeAngle)
    const directionY = -Math.cos(relativeAngle)

    const width = window.innerWidth
    const height = window.innerHeight
    const horizontalInset = Math.min(62, Math.max(46, width * 0.06))
    const topInset = Math.min(128, Math.max(horizontalInset, height * 0.22))
    const leftEdge = horizontalInset
    const rightEdge = width - horizontalInset
    const topEdge = topInset
    const bottomEdge = height - horizontalInset
    const centerX = width * 0.5
    const centerY = height * 0.5
    const scaleX = directionX > 0.0001
      ? (rightEdge - centerX) / directionX
      : directionX < -0.0001
        ? (leftEdge - centerX) / directionX
        : Number.POSITIVE_INFINITY
    const scaleY = directionY > 0.0001
      ? (bottomEdge - centerY) / directionY
      : directionY < -0.0001
        ? (topEdge - centerY) / directionY
        : Number.POSITIVE_INFINITY
    const edgeScale = Math.min(scaleX, scaleY)

    elRiskPointer.style.setProperty('--risk-pointer-x', `${centerX + directionX * edgeScale}px`)
    elRiskPointer.style.setProperty('--risk-pointer-y', `${centerY + directionY * edgeScale}px`)
    elRiskPointerArrow.style.setProperty('--risk-pointer-angle', `${relativeAngle - Math.PI / 2}rad`)
    elRiskPointerDistance.textContent = `${Math.max(1, Math.ceil(distance))} m`
    elRiskPointer.classList.remove('risk-pointer--hidden')
  }

  function updateRiskHud(): void {
    if (elRiskBonus) {
      const bonuses: string[] = []
      if (cycleBoostLeft > 0) bonuses.push(`Dygn ×2 ${Math.ceil(cycleBoostLeft)} s`)
      if (nightMultiplierLeft > 0) bonuses.push(`Nätter ×2 ${Math.ceil(nightMultiplierLeft)} s`)
      if (carrotBoostLeft > 0) bonuses.push(`Morötter ×2 ${Math.ceil(carrotBoostLeft)} s`)
      elRiskBonus.textContent = bonuses.join(' · ')
      elRiskBonus.classList.toggle('risk-bonus--hidden', bonuses.length === 0)
    }

    if (!elRiskChallenge) {
      return
    }
    if (!titleStarted) {
      elRiskChallenge.innerHTML = '<strong>Riskuppdrag:</strong> välj kanin för att börja'
      return
    }
    if (gameOver) {
      elRiskChallenge.innerHTML = '<strong>Riskuppdrag:</strong> avslutat'
      return
    }
    if (!activeRiskChallenge) {
      elRiskChallenge.innerHTML = `<strong>Riskuppdrag klart!</strong> ${riskChallengeNotice}`
      return
    }

    const seconds = Math.max(0, Math.ceil(riskChallengeTimeLeft))
    if (activeRiskChallenge === 'fox-jump') {
      const distance = foxMode === 'chase'
        ? ` · räven ${Math.ceil(Math.hypot(foxG.position.x - siggeG.position.x, foxG.position.z - siggeG.position.z))} m bort`
        : ' · vänta på räven'
      elRiskChallenge.innerHTML = `<strong>Riskuppdrag:</strong> skutta över den jagande räven${distance} · ${seconds} s`
      return
    }
    if (activeRiskChallenge === 'night-dandelion') {
      const detail = isNightNow()
        ? `maskrosen är ${Math.ceil(riskDandelion.position.distanceTo(siggeG.position))} m bort`
        : 'maskrosen visar sig i natt'
      elRiskChallenge.innerHTML = `<strong>Riskuppdrag:</strong> ät den lysande nattmaskrosen · ${detail} · ${seconds} s`
      return
    }

    const predatorDistance = activePredatorDistance()
    const detail = Number.isFinite(predatorDistance)
      ? `närmaste rovdjur ${Math.ceil(predatorDistance)} m bort`
      : 'vänta på ett rovdjur'
    elRiskChallenge.innerHTML = `<strong>Riskuppdrag:</strong> ät en morot inom 3 m från ett jagande rovdjur · ${detail} · ${seconds} s`
  }

  function setRiskChallenge(kind: RiskChallengeKind): void {
    activeRiskChallenge = kind
    riskChallengeTimeLeft = riskChallengeDuration(kind)
    riskChallengePauseLeft = 0
    riskChallengeNotice = ''
    riskDandelion.visible = false
    if (kind === 'night-dandelion') {
      riskDandelion.position.copy(randomRiskDandelionPosition())
      riskDandelion.userData.baseY = riskDandelion.position.y
    }
    updateRiskHud()
  }

  function startNextRiskChallenge(): void {
    const kind = riskChallengeOrder[riskChallengeIndex % riskChallengeOrder.length]
    riskChallengeIndex += 1
    setRiskChallenge(kind)
  }

  function resetRiskChallenges(): void {
    activeRiskChallenge = null
    riskChallengeIndex = 0
    riskChallengeTimeLeft = 0
    riskChallengePauseLeft = 0
    riskChallengeNotice = ''
    cycleBoostLeft = 0
    nightMultiplierLeft = 0
    carrotBoostLeft = 0
    riskDandelion.visible = false
    startNextRiskChallenge()
  }

  function finishRiskChallenge(kind: RiskChallengeKind): void {
    if (activeRiskChallenge !== kind) {
      return
    }
    if (kind === 'fox-jump') {
      cycleBoostLeft = Math.max(cycleBoostLeft, RISK_CYCLE_BOOST_SECONDS)
      riskChallengeNotice = 'Dygnet går 2× snabbare i 20 sekunder.'
    } else if (kind === 'night-dandelion') {
      nightMultiplierLeft = Math.max(nightMultiplierLeft, RISK_NIGHT_MULTIPLIER_SECONDS)
      riskChallengeNotice = 'Varje avslutad natt räknas 2× i 45 sekunder.'
      audio.eat()
    } else {
      carrotBoostLeft = Math.max(carrotBoostLeft, RISK_CARROT_BOOST_SECONDS)
      riskChallengeNotice = 'Morötter ger 2× energi i 30 sekunder.'
    }
    activeRiskChallenge = null
    riskChallengeTimeLeft = 0
    riskChallengePauseLeft = RISK_REWARD_PAUSE_SECONDS
    riskDandelion.visible = false
    audio.chatter()
    updateRiskHud()
  }

  function expireRiskChallenge(): void {
    activeRiskChallenge = null
    riskChallengeTimeLeft = 0
    riskChallengePauseLeft = 2.5
    riskChallengeNotice = 'Tiden gick ut – ett nytt uppdrag kommer strax.'
    riskDandelion.visible = false
    updateRiskHud()
  }

  function tryFinishPredatorCarrotChallenge(): void {
    if (activeRiskChallenge === 'predator-carrot' && activePredatorDistance() <= 3) {
      finishRiskChallenge('predator-carrot')
    }
  }

  function updateRiskChallenges(dt: number, now: number): void {
    if (!titleStarted) {
      riskDandelion.visible = false
      updateRiskHud()
      return
    }
    if (gameOver) {
      riskDandelion.visible = false
      updateRiskHud()
      return
    }

    cycleBoostLeft = Math.max(0, cycleBoostLeft - dt)
    nightMultiplierLeft = Math.max(0, nightMultiplierLeft - dt)
    carrotBoostLeft = Math.max(0, carrotBoostLeft - dt)

    if (!activeRiskChallenge) {
      riskChallengePauseLeft = Math.max(0, riskChallengePauseLeft - dt)
      if (riskChallengePauseLeft <= 0) {
        startNextRiskChallenge()
      } else {
        updateRiskHud()
      }
      return
    }

    riskChallengeTimeLeft = Math.max(0, riskChallengeTimeLeft - dt)
    if (riskChallengeTimeLeft <= 0) {
      expireRiskChallenge()
      return
    }

    riskDandelion.visible = activeRiskChallenge === 'night-dandelion' && isNightNow()
    if (riskDandelion.visible) {
      riskDandelion.rotation.y += dt * 1.25
      riskDandelion.position.y = riskDandelion.userData.baseY + Math.sin(now * 3.2) * 0.08
      if (riskDandelion.position.distanceTo(siggeG.position) <= 0.85) {
        finishRiskChallenge('night-dandelion')
        return
      }
    }

    if (
      activeRiskChallenge === 'fox-jump'
      && foxMode === 'chase'
      && !onGround
      && Math.hypot(foxG.position.x - siggeG.position.x, foxG.position.z - siggeG.position.z) <= 1.05
      && siggeG.position.y - foxG.position.y >= 0.42
    ) {
      finishRiskChallenge('fox-jump')
      return
    }
    updateRiskHud()
  }

  function isNightNow(): boolean {
    return cycleClock >= DAY_SECONDS
  }

  function updateDayNight(dt: number) {
    const prevNight = wasNight
    if (!gameOver) {
      cycleClock = (cycleClock + dt * (cycleBoostLeft > 0 ? 2 : 1)) % CYCLE_SECONDS
    }
    const night = isNightNow()
    if (prevNight && !night && !gameOver) {
      survivedNights += nightMultiplierLeft > 0 ? 2 : 1
    }
    wasNight = night

    const sky = currentSky.copy(skyDay)
    const fog = currentFog.copy(fogDay)
    let sunIntensity = 1
    let moonIntensity = 0
    let hemiIntensity = 0.85
    let windowPower = 0
    let label = 'Dag'

    if (!night) {
      const dayT = THREE.MathUtils.clamp(cycleClock / DAY_SECONDS, 0, 1)
      const sunHeight = Math.sin(dayT * Math.PI)
      const dawn = 1 - THREE.MathUtils.clamp(cycleClock / TWILIGHT_SECONDS, 0, 1)
      const dusk = THREE.MathUtils.clamp((cycleClock - (DAY_SECONDS - TWILIGHT_SECONDS)) / TWILIGHT_SECONDS, 0, 1)
      const twilight = Math.max(dawn, dusk)
      sky.copy(skyDay).lerp(skyTwilight, twilight * 0.92)
      fog.copy(fogDay).lerp(fogTwilight, twilight * 0.85)
      sunIntensity = THREE.MathUtils.lerp(0.34, 1.08, sunHeight) * (1 - dusk * 0.35)
      hemiIntensity = THREE.MathUtils.lerp(0.48, 0.9, sunHeight) * (1 - dusk * 0.18)
      windowPower = Math.max(dusk * 0.4, dawn * 0.18)
      label = dawn > 0.05 ? 'Gryning' : dusk > 0.05 ? 'Skymning' : 'Dag'

      const sunX = Math.cos(Math.PI * (1 - dayT)) * 29
      const sunY = 2.6 + sunHeight * 29
      sun.position.set(sunX, sunY, 13)
      sunOrb.position.copy(sun.position)
      sunOrb.visible = true
      moonOrb.visible = false
    } else {
      const nightT = THREE.MathUtils.clamp((cycleClock - DAY_SECONDS) / NIGHT_SECONDS, 0, 1)
      const nightRise = THREE.MathUtils.clamp((cycleClock - DAY_SECONDS) / 4, 0, 1)
      sky.copy(skyTwilight).lerp(skyNight, nightRise)
      fog.copy(fogTwilight).lerp(fogNight, nightRise)
      sunIntensity = 0
      moonIntensity = 0.24 + Math.sin(nightT * Math.PI) * 0.16
      hemiIntensity = 0.08
      windowPower = 0.9 + Math.sin(nightT * Math.PI) * 0.28
      label = 'Natt'

      const moonX = Math.cos(Math.PI * (1 - nightT)) * 25
      const moonY = 7 + Math.sin(nightT * Math.PI) * 24
      moonLight.position.set(moonX, moonY, -14)
      moonOrb.position.copy(moonLight.position)
      moonOrb.visible = true
      sunOrb.visible = false
    }

    ;(scene.background as THREE.Color).copy(sky)
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(fog)
      scene.fog.near = night ? 16 : 28
      scene.fog.far = night ? 72 : 125
    }
    hemi.intensity = hemiIntensity
    sun.intensity = sunIntensity
    sun.color.set(label === 'Skymning' || label === 'Gryning' ? 0xffc58a : 0xfffaec)
    moonLight.intensity = moonIntensity
    for (const material of windowMaterials) {
      material.emissiveIntensity = windowPower * 1.15
    }
    if (elCycle) {
      const left = night ? CYCLE_SECONDS - cycleClock : DAY_SECONDS - cycleClock
      elCycle.textContent = `${label} ${Math.max(0, Math.ceil(left))} s`
    }
    if (elNightCount) {
      elNightCount.textContent = `${survivedNights}`
    }
  }

  function randomGardenPosition(): THREE.Vector3 {
    for (let i = 0; i < 40; i++) {
      const x = THREE.MathUtils.randFloat(-WORLD_HALF_X + 1.2, WORLD_HALF_X - 1.2)
      const z = THREE.MathUtils.randFloat(-WORLD_HALF_Z + 1.2, WORLD_HALF_Z - 1.2)
      const nearHouse = colliders.some((collider) => aabb2ContainsXZ(collider, x, z))
      const nearHutch = hutches.some((hutch) => aabb2ContainsXZ({
        min: hutch.aabb.min.clone().addScalar(-1.3),
        max: hutch.aabb.max.clone().addScalar(1.3),
        y0: hutch.aabb.y0,
        y1: hutch.aabb.y1,
      }, x, z))
      if (!nearHouse && !nearHutch && Math.hypot(x - siggeG.position.x, z - siggeG.position.z) > 3) {
        return new THREE.Vector3(x, terrainHeightAt(x, z) + 0.24, z)
      }
    }
    return new THREE.Vector3(0, terrainHeightAt(0, 15) + 0.24, 15)
  }

  function pickupLabel(kind: PickupKind): string {
    if (kind === 'light-armor') {
      return 'Lätt rustning'
    }
    if (kind === 'heavy-armor') {
      return 'Stark rustning'
    }
    if (kind === 'energy-potion') {
      return 'Energipotion'
    }
    if (kind === 'speed-potion') {
      return 'Fartpotion'
    }
    return 'Skyddspotion'
  }

  function createPickupGroup(kind: PickupKind) {
    const g = new THREE.Group()
    g.userData.baseY = 0.24

    if (kind === 'light-armor' || kind === 'heavy-armor') {
      const heavy = kind === 'heavy-armor'
      const armorMat = new THREE.MeshStandardMaterial({
        color: heavy ? 0x657286 : 0xa8b6c6,
        emissive: heavy ? 0x10172a : 0x0c151d,
        emissiveIntensity: 0.35,
        metalness: 0.55,
        roughness: 0.3,
      })
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.18, heavy ? 0.27 : 0.23, 0.34, 6), armorMat)
      plate.rotation.z = Math.PI / 2
      plate.position.y = 0.34
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.06), armorMat)
      band.position.y = 0.34
      g.add(plate, band)
    } else {
      const potionColor = kind === 'energy-potion' ? 0xff5964 : kind === 'speed-potion' ? 0x4fc3ff : 0xb487ff
      const potionMat = new THREE.MeshStandardMaterial({
        color: potionColor,
        emissive: potionColor,
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.02,
      })
      const glassBottle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.34, 12), potionMat)
      glassBottle.position.y = 0.3
      const stopper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x5c3b1f, roughness: 0.7 }))
      stopper.position.y = 0.52
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), potionMat)
      bubble.position.y = 0.16
      g.add(glassBottle, stopper, bubble)
    }

    return g
  }

  function spawnPickup() {
    if (pickups.length >= PICKUP_MAX) {
      return
    }
    const kinds: PickupKind[] = ['light-armor', 'heavy-armor', 'energy-potion', 'speed-potion', 'shield-potion']
    const weights = isNightNow() ? [3, 2, 2, 2, 3] : [2, 1, 3, 2, 1]
    const total = weights.reduce((sum, value) => sum + value, 0)
    let roll = Math.random() * total
    let kind = kinds[0]
    for (let i = 0; i < kinds.length; i++) {
      roll -= weights[i]
      if (roll <= 0) {
        kind = kinds[i]
        break
      }
    }
    const group = createPickupGroup(kind)
    group.position.copy(randomGardenPosition())
    scene.add(group)
    pickups.push({ group, kind, ttl: 42 })
  }

  function applyPickup(kind: PickupKind) {
    if (kind === 'light-armor') {
      armorCharges = Math.min(ARMOR_MAX, armorCharges + 1)
    } else if (kind === 'heavy-armor') {
      armorCharges = Math.min(ARMOR_MAX, armorCharges + 2)
    } else if (kind === 'energy-potion') {
      energy = Math.min(ENERGY_MAX, energy + 32)
    } else if (kind === 'speed-potion') {
      speedPotionLeft = Math.max(speedPotionLeft, SPEED_POTION_SECONDS)
    } else {
      shieldPotionLeft = Math.max(shieldPotionLeft, SHIELD_POTION_SECONDS)
    }
    if (elPickup) {
      elPickup.textContent = `${pickupLabel(kind)} plockad`
      elPickup.classList.remove('hud-pickup--hidden')
      pickupMessageLeft = 2.4
    }
  }

  function updatePickups(dt: number, now: number) {
    if (gameOver) {
      return
    }
    pickupSpawnNext -= dt
    if (pickupSpawnNext <= 0) {
      spawnPickup()
      pickupSpawnNext = THREE.MathUtils.randFloat(PICKUP_SPAWN_MIN, PICKUP_SPAWN_MAX)
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i]
      pickup.ttl -= dt
      pickup.group.rotation.y += dt * 1.9
      pickup.group.position.y = pickup.group.userData.baseY + Math.sin(now * 2.8 + i) * 0.08
      if (pickup.group.position.distanceTo(siggeG.position) < PICKUP_PICK) {
        applyPickup(pickup.kind)
        scene.remove(pickup.group)
        pickups.splice(i, 1)
      } else if (pickup.ttl <= 0) {
        scene.remove(pickup.group)
        pickups.splice(i, 1)
      }
    }
    if (pickupMessageLeft > 0) {
      pickupMessageLeft = Math.max(0, pickupMessageLeft - dt)
      if (pickupMessageLeft <= 0) {
        elPickup?.classList.add('hud-pickup--hidden')
      }
    }
  }

  function trySpawnFox() {
    if (foxMode !== 'hidden') {
      return
    }
    const ang = Math.random() * Math.PI * 2
    const r = INNER - 1.2
    foxP.set(Math.cos(ang) * r, 0.25, Math.sin(ang) * r)
    foxP.y = terrainHeightAt(foxP.x, foxP.z) + 0.25
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
    const to = foxMoveDelta.copy(target).sub(foxG.position)
    to.y = 0
    const dist = to.length()
    if (dist < 0.01) {
      return dist
    }
    const stepLen = Math.min(dist, speed * dt)
    to.normalize()
    foxG.position.addScaledVector(to, stepLen)
    const outside = resolvePredatorOutsideHutches(foxG.position.x, foxG.position.z, FOX_HUTCH_CLEARANCE)
    foxG.position.x = outside.x
    foxG.position.z = outside.z
    foxG.position.y = terrainHeightAt(foxG.position.x, foxG.position.z) + 0.25
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

    foxG.position.y = terrainHeightAt(foxG.position.x, foxG.position.z) + 0.25 + bob
    parts.body.position.y = parts.bodyY + bob * 0.35
    parts.chest.position.y = parts.chestY + bob * 0.45
    const biteOpen = foxBiteAnimLeft > 0
      ? Math.sin((1 - foxBiteAnimLeft / FOX_BITE_ANIM_TIME) * Math.PI)
      : 0
    const biteReach = biteOpen * 0.16
    const biteDrop = biteOpen * 0.035
    parts.head.position.y = parts.headY + headNod - biteDrop
    parts.head.position.z = parts.headZ + biteReach * 0.32
    parts.snout.position.y = parts.snoutY + headNod - biteDrop
    parts.snout.position.z = parts.snoutZ + biteReach
    parts.nose.position.y = parts.noseY + headNod - biteDrop
    parts.nose.position.z = parts.noseZ + biteReach
    parts.mouthLine.position.y = parts.mouthLineY + headNod - biteDrop
    parts.mouthLine.position.z = parts.mouthLineZ + biteReach
    parts.lowerJaw.position.y = parts.lowerJawY + headNod - biteDrop
    parts.lowerJaw.position.z = parts.lowerJawZ + biteReach
    parts.lowerJaw.rotation.x = parts.lowerJawRotX + biteOpen * 0.52
    const tailWave = Math.sin(foxWalkPhase + 1.4)
    parts.tail.rotation.x = parts.tailRotX + (moving ? 0.04 : 0.015) * tailWave
    parts.tail.rotation.z = parts.tailRotZ + (moving ? 0.13 : 0.04) * tailWave

    for (let i = 0; i < parts.legs.length; i++) {
      const leg = parts.legs[i] as THREE.Mesh
      const phase = i % 2 === 0 ? stride : counterStride
      leg.rotation.x = moving ? phase * 0.45 : THREE.MathUtils.lerp(leg.rotation.x, 0, Math.min(1, dt * 8))
    }
  }

  function startFoxSniff() {
    const hutch = hutches.reduce((nearest, candidate) => (
      candidate.center.distanceToSquared(foxG.position) < nearest.center.distanceToSquared(foxG.position) ? candidate : nearest
    ))
    const side = foxG.position.clone().sub(hutch.center).setY(0)
    if (side.lengthSq() < 0.01) side.set(0, 0, -1)
    side.normalize()
    setTargetOutsideHutch(foxTarget, hutch, foxG.position, FOX_HUTCH_CLEARANCE, 0.25)
    foxLeaveTarget.set(
      hutch.center.x + side.x * (INNER + 8),
      0.25,
      hutch.center.z + side.z * (INNER + 8),
    )
    foxSniffLeft = FOX_SNIFF_TIME
    foxMode = 'sniff'
  }

  function trySpawnCat() {
    if (catMode !== 'hidden') {
      return
    }
    const ang = Math.random() * Math.PI * 2
    const r = INNER - 1.0
    catP.set(Math.cos(ang) * r, 0.22, Math.sin(ang) * r)
    catP.y = terrainHeightAt(catP.x, catP.z) + 0.22
    catG.position.copy(catP)
    catG.visible = true
    catMode = 'chase'
  }

  function hideCat() {
    catMode = 'hidden'
    catG.visible = false
    catNext = THREE.MathUtils.randFloat(CAT_TIMER_MIN, CAT_TIMER_MAX)
  }

  function moveCatToward(target: THREE.Vector3, speed: number, dt: number): number {
    const to = catMoveDelta.copy(target).sub(catG.position)
    to.y = 0
    const dist = to.length()
    if (dist < 0.01) {
      return dist
    }
    const stepLen = Math.min(dist, speed * dt)
    to.normalize()
    catG.position.addScaledVector(to, stepLen)
    const outside = resolvePredatorOutsideHutches(catG.position.x, catG.position.z, CAT_HUTCH_CLEARANCE)
    catG.position.x = outside.x
    catG.position.z = outside.z
    catG.position.y = terrainHeightAt(catG.position.x, catG.position.z) + 0.22
    catG.rotation.y = Math.atan2(to.x, to.z)
    return dist - stepLen
  }

  function animateCat(moving: boolean, sniffing: boolean, dt: number, now: number) {
    const parts = catG.userData.parts
    if (!parts) {
      return
    }
    if (moving) {
      catWalkPhase += dt * 13
    } else {
      catWalkPhase = THREE.MathUtils.lerp(catWalkPhase, 0, Math.min(1, dt * 7))
    }

    const stride = Math.sin(catWalkPhase)
    const counterStride = Math.sin(catWalkPhase + Math.PI)
    const bob = moving ? Math.abs(stride) * 0.026 : sniffing ? Math.sin(now * 9) * 0.01 : 0
    const headNod = sniffing ? Math.sin(now * 14) * 0.028 : moving ? Math.sin(catWalkPhase + 0.4) * 0.012 : 0

    catG.position.y = terrainHeightAt(catG.position.x, catG.position.z) + 0.22 + bob
    parts.body.position.y = parts.bodyY + bob * 0.35
    parts.chest.position.y = parts.chestY + bob * 0.4
    const biteOpen = catBiteAnimLeft > 0
      ? Math.sin((1 - catBiteAnimLeft / CAT_BITE_ANIM_TIME) * Math.PI)
      : 0
    const biteReach = biteOpen * 0.12
    const biteDrop = biteOpen * 0.025
    parts.head.position.y = parts.headY + headNod - biteDrop
    parts.head.position.z = parts.headZ + biteReach * 0.28
    parts.snout.position.y = parts.snoutY + headNod - biteDrop
    parts.snout.position.z = parts.snoutZ + biteReach
    parts.nose.position.y = parts.noseY + headNod - biteDrop
    parts.nose.position.z = parts.noseZ + biteReach
    parts.mouthLine.position.y = parts.mouthLineY + headNod - biteDrop
    parts.mouthLine.position.z = parts.mouthLineZ + biteReach
    parts.lowerJaw.position.y = parts.lowerJawY + headNod - biteDrop
    parts.lowerJaw.position.z = parts.lowerJawZ + biteReach
    parts.lowerJaw.rotation.x = parts.lowerJawRotX + biteOpen * 0.44
    const tailWave = Math.sin(catWalkPhase + 1.1)
    parts.tail.rotation.x = parts.tailRotX + (moving ? 0.08 : 0.03) * tailWave
    parts.tail.rotation.z = parts.tailRotZ + (moving ? 0.2 : 0.08) * tailWave

    for (let i = 0; i < parts.legs.length; i++) {
      const leg = parts.legs[i] as THREE.Mesh
      const phase = i % 2 === 0 ? stride : counterStride
      leg.rotation.x = moving ? phase * 0.55 : THREE.MathUtils.lerp(leg.rotation.x, 0, Math.min(1, dt * 8))
    }
  }

  function startCatSniff() {
    const hutch = hutches.reduce((nearest, candidate) => (
      candidate.center.distanceToSquared(catG.position) < nearest.center.distanceToSquared(catG.position) ? candidate : nearest
    ))
    const side = catG.position.clone().sub(hutch.center).setY(0)
    if (side.lengthSq() < 0.01) side.set(0, 0, -1)
    side.normalize()
    setTargetOutsideHutch(catTarget, hutch, catG.position, CAT_HUTCH_CLEARANCE, 0.22)
    catLeaveTarget.set(
      hutch.center.x + side.x * (INNER + 8),
      0.22,
      hutch.center.z + side.z * (INNER + 8),
    )
    catSniffLeft = CAT_SNIFF_TIME
    catMode = 'sniff'
  }

  function updateCarrots(dt: number) {
    if (gameOver) {
      return
    }
    for (const c of carrots) {
      if (c.picked) {
        c.regrowLeft = Math.max(0, c.regrowLeft - dt)
        const growth = c.regrowTotal > 0 ? 1 - c.regrowLeft / c.regrowTotal : 1
        setCarrotPlantGrowth(c, growth)
        if (c.regrowLeft <= 0) {
          c.picked = false
          setCarrotPlantGrowth(c, 1)
        }
      } else {
        const d = c.root.position.distanceTo(siggeG.position)
        if (d < CARROT_PICK) {
          c.picked = true
          c.regrowTotal = THREE.MathUtils.randFloat(CARROT_REGROW_MIN, CARROT_REGROW_MAX)
          c.regrowLeft = c.regrowTotal
          setCarrotPlantGrowth(c, 0.06)
          const carrotEnergy = ENERGY_PER_CARROT * (carrotBoostLeft > 0 ? 2 : 1)
          energy = Math.min(ENERGY_MAX, energy + carrotEnergy)
          audio.eat()
          tryFinishPredatorCarrotChallenge()
        }
      }
    }
  }

  function createRabbitIcon(rabbit: CharacterId): HTMLSpanElement {
    const icon = document.createElement('span')
    icon.className = `rabbit-icon rabbit-icon--${rabbit}`
    icon.setAttribute('role', 'img')
    icon.setAttribute('aria-label', rabbit === 'sigge' ? 'Sigge' : 'Kurre')
    const face = document.createElement('span')
    face.className = 'rabbit-icon-face'
    icon.append(face)
    return icon
  }

  function renderHighscores(entries: HighscoreEntry[]): void {
    if (!elHighscoreList) {
      return
    }

    elHighscoreList.replaceChildren()
    if (entries.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'highscore-empty'
      empty.textContent = 'Ingen har klarat en natt ännu.'
      elHighscoreList.append(empty)
      return
    }

    entries.forEach((entry, index) => {
      const item = document.createElement('li')
      item.className = 'highscore-item'
      if (entry.id === submittedHighscoreId) {
        item.classList.add('highscore-item--current')
      }

      const rank = document.createElement('span')
      rank.className = 'highscore-rank'
      rank.textContent = `${index + 1}.`

      const name = document.createElement('span')
      name.className = 'highscore-player'
      name.textContent = entry.name

      const score = document.createElement('span')
      score.className = 'highscore-score'
      score.textContent = `${entry.nights} ${entry.nights === 1 ? 'natt' : 'nätter'}`

      item.append(rank, createRabbitIcon(entry.rabbit), name, score)
      elHighscoreList.append(item)
    })
  }

  function highscoreSourceLabel(source: HighscoreSource): string {
    return source === 'supabase' ? 'Gemensam topplista' : 'Visar lokal reservlista'
  }

  async function refreshHighscores(statusOverride?: string): Promise<void> {
    const generation = highscoreViewGeneration
    if (!statusOverride && elHighscoreStatus) {
      elHighscoreStatus.textContent = 'Läser topplistan…'
    }
    const result = await fetchHighscores()
    if (generation !== highscoreViewGeneration || !gameOver) {
      return
    }
    renderHighscores(result.entries)
    if (elHighscoreStatus) {
      elHighscoreStatus.textContent = statusOverride ?? highscoreSourceLabel(result.source)
    }
  }

  function prepareHighscoreForm(): void {
    highscoreViewGeneration += 1
    if (elHighscoreName) {
      try {
        elHighscoreName.value = localStorage.getItem('rabbit-highscore-player-name') ?? ''
      } catch {
        elHighscoreName.value = ''
      }
      elHighscoreName.disabled = false
    }
    if (elHighscoreSubmit) {
      elHighscoreSubmit.disabled = false
      elHighscoreSubmit.textContent = 'Spara'
    }
    if (elHighscoreStatus) {
      elHighscoreStatus.textContent = 'Läser topplistan…'
    }
  }

  async function submitHighscore(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!finishedRun || !elHighscoreName || !elHighscoreSubmit || submittedHighscoreId) {
      return
    }

    const name = sanitizeHighscoreName(elHighscoreName.value)
    if (!name) {
      elHighscoreName.focus()
      if (elHighscoreStatus) {
        elHighscoreStatus.textContent = 'Skriv in ett namn först.'
      }
      return
    }

    elHighscoreName.value = name
    elHighscoreName.disabled = true
    elHighscoreSubmit.disabled = true
    elHighscoreSubmit.textContent = 'Sparar…'
    if (elHighscoreStatus) {
      elHighscoreStatus.textContent = 'Sparar resultatet…'
    }

    try {
      const result = await saveHighscore(name, finishedRun.nights, finishedRun.rabbit)
      if (!gameOver) {
        return
      }
      submittedHighscoreId = result.entry.id
      try {
        localStorage.setItem('rabbit-highscore-player-name', name)
      } catch {
        // Namnet behöver inte kommas ihåg för att poängen ska kunna sparas.
      }
      elHighscoreSubmit.textContent = 'Sparad'
      const message = result.source === 'supabase'
        ? 'Resultatet är sparat i den gemensamma topplistan.'
        : 'Resultatet sparades på den här enheten. Nätlistan kunde inte nås.'
      await refreshHighscores(message)
    } catch (error) {
      elHighscoreName.disabled = false
      elHighscoreSubmit.disabled = false
      elHighscoreSubmit.textContent = 'Spara'
      if (elHighscoreStatus) {
        elHighscoreStatus.textContent = error instanceof Error ? error.message : 'Resultatet kunde inte sparas.'
      }
    }
  }

  function reduceEnergy(amount: number) {
    if (gameOver || amount <= 0) {
      return
    }
    energy = Math.max(0, energy - amount)
    if (energy <= 0) {
      gameOver = true
      energy = 0
      finishedRun = { nights: survivedNights, rabbit: selectedCharacter }
      submittedHighscoreId = null
      if (elGameOverDetail) {
        const playerName = selectedCharacter === 'sigge' ? 'Sigge' : 'Kurre'
        elGameOverDetail.textContent = `${playerName} överlevde ${survivedNights} ${survivedNights === 1 ? 'natt' : 'nätter'}.`
      }
      prepareHighscoreForm()
      elGameOverDialog?.classList.remove('gameover-dialog--hidden')
      void refreshHighscores()
      pVel.set(0, 0, 0)
      airborneForwardSpeed = 0
      resetTouchControls()
      for (const code of Object.keys(keys)) {
        keys[code] = false
      }
    }
  }

  function receiveBite(baseDamage: number) {
    if (shieldPotionLeft > 0) {
      reduceEnergy(baseDamage * 0.22)
      return
    }
    if (armorCharges > 0) {
      armorCharges -= 1
      reduceEnergy(baseDamage * 0.28)
      return
    }
    reduceEnergy(baseDamage)
  }

  function updateItemHud(dt: number) {
    if (!gameOver) {
      shieldPotionLeft = Math.max(0, shieldPotionLeft - dt)
      speedPotionLeft = Math.max(0, speedPotionLeft - dt)
    }
    siggeArmor.visible = armorCharges > 0 || shieldPotionLeft > 0
    siggeArmor.rotation.y = shieldPotionLeft > 0 ? Math.sin(performance.now() * 0.006) * 0.12 : 0
    if (elItems) {
      const shieldText = shieldPotionLeft > 0 ? ` · Skydd ${Math.ceil(shieldPotionLeft)} s` : ''
      const speedText = speedPotionLeft > 0 ? ` · Fart ${Math.ceil(speedPotionLeft)} s` : ''
      elItems.textContent = `Rustning ${armorCharges}/${ARMOR_MAX}${shieldText}${speedText}`
    }
  }

  let performanceSampleSeconds = 0
  let performanceSampleFrames = 0
  let fastPerformanceSamples = 0

  function applyRendererPixelRatio(nextPixelRatio: number) {
    const rounded = Math.round(nextPixelRatio * 100) / 100
    if (Math.abs(rounded - rendererPixelRatio) < 0.01) {
      return
    }
    rendererPixelRatio = rounded
    renderer.setPixelRatio(rendererPixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  function updateAdaptiveRenderQuality(dt: number) {
    if (!titleStarted || document.hidden) {
      return
    }
    performanceSampleSeconds += dt
    performanceSampleFrames += 1
    if (performanceSampleSeconds < 2.5) {
      return
    }

    const fps = performanceSampleFrames / performanceSampleSeconds
    performanceSampleSeconds = 0
    performanceSampleFrames = 0

    if (fps < 48 && rendererPixelRatio > renderProfile.minPixelRatio + 0.01) {
      fastPerformanceSamples = 0
      applyRendererPixelRatio(Math.max(renderProfile.minPixelRatio, rendererPixelRatio - 0.2))
      return
    }

    if (fps > 58 && rendererPixelRatio < renderProfile.maxPixelRatio - 0.01) {
      fastPerformanceSamples += 1
      if (fastPerformanceSamples >= 4) {
        fastPerformanceSamples = 0
        applyRendererPixelRatio(Math.min(renderProfile.maxPixelRatio, rendererPixelRatio + 0.1))
      }
      return
    }

    fastPerformanceSamples = 0
  }

  function onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    updateMobileOverlays()
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', updateMobileOverlays)
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
    if (e.code === 'Space' && !e.repeat && !gameOver) {
      jumpBufferLeft = JUMP_BUFFER_SECONDS
    }
  })
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false
  })

  function resetTouchControls() {
    resetTouchMove()
    resetTouchCamera()
    jumpBufferLeft = 0
    elJumpZone?.classList.remove('touch-zone--active')
  }

  function resetTouchCamera() {
    touchCamera.active = false
    touchCamera.pointerId = -1
  }

  function resetTouchMove() {
    touchMove.active = false
    touchMove.pointerId = -1
    touchMove.x = 0
    touchMove.y = 0
    elMoveZone?.classList.remove('touch-zone--active')
    if (elMoveStick) {
      elMoveStick.style.left = ''
      elMoveStick.style.top = ''
      elMoveStick.style.bottom = ''
    }
    if (elMoveKnob) {
      elMoveKnob.style.transform = ''
    }
  }

  function updateTouchMove(e: PointerEvent) {
    const rawX = e.clientX - touchMove.baseX
    const rawY = e.clientY - touchMove.baseY
    const len = Math.hypot(rawX, rawY)
    const scale = len > touchMove.radius ? touchMove.radius / len : 1
    const knobX = rawX * scale
    const knobY = rawY * scale
    const dx = THREE.MathUtils.clamp(knobX / touchMove.radius, -1, 1)
    const dy = THREE.MathUtils.clamp(knobY / touchMove.radius, -1, 1)
    const dead = 0.12
    touchMove.x = Math.abs(dx) < dead ? 0 : dx
    touchMove.y = Math.abs(dy) < dead ? 0 : dy
    if (elMoveKnob) {
      elMoveKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`
    }
  }

  elMoveZone?.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (touchMove.active) {
      return
    }
    const zoneRect = elMoveZone.getBoundingClientRect()
    const stickSize = elMoveStick?.getBoundingClientRect().width ?? Math.max(108, Math.min(window.innerWidth, window.innerHeight) * 0.18)
    const radius = stickSize * 0.34
    const margin = stickSize * 0.5
    const baseX = THREE.MathUtils.clamp(e.clientX, zoneRect.left + margin, zoneRect.right - margin)
    const baseY = THREE.MathUtils.clamp(e.clientY, zoneRect.top + margin, zoneRect.bottom - margin)
    touchMove.active = true
    touchMove.pointerId = e.pointerId
    touchMove.startX = e.clientX
    touchMove.startY = e.clientY
    touchMove.baseX = baseX
    touchMove.baseY = baseY
    touchMove.radius = radius
    touchMove.x = 0
    touchMove.y = 0
    elMoveZone.classList.add('touch-zone--active')
    if (elMoveStick) {
      elMoveStick.style.left = `${baseX}px`
      elMoveStick.style.top = `${baseY}px`
      elMoveStick.style.bottom = 'auto'
    }
    elMoveZone.setPointerCapture(e.pointerId)
    updateTouchMove(e)
  })
  elMoveZone?.addEventListener('pointermove', (e) => {
    if (!touchMove.active || e.pointerId !== touchMove.pointerId) {
      return
    }
    e.preventDefault()
    updateTouchMove(e)
  })
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elMoveZone?.addEventListener(eventName, (e) => {
      if (e instanceof PointerEvent && e.pointerId !== touchMove.pointerId) {
        return
      }
      resetTouchMove()
    })
  }
  elCameraZone?.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (touchCamera.active) {
      return
    }
    touchCamera.active = true
    touchCamera.pointerId = e.pointerId
    touchCamera.lastX = e.clientX
    touchCamera.lastY = e.clientY
    elCameraZone.setPointerCapture(e.pointerId)
  })
  elCameraZone?.addEventListener('pointermove', (e) => {
    if (!touchCamera.active || e.pointerId !== touchCamera.pointerId) {
      return
    }
    e.preventDefault()
    const dx = e.clientX - touchCamera.lastX
    const dy = e.clientY - touchCamera.lastY
    touchCamera.lastX = e.clientX
    touchCamera.lastY = e.clientY
    cameraYaw -= dx * 0.008
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.0045, -0.22, 0.68)
  })
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elCameraZone?.addEventListener(eventName, (e) => {
      if (e instanceof PointerEvent && e.pointerId !== touchCamera.pointerId) {
        return
      }
      resetTouchCamera()
    })
  }
  elJumpZone?.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    elJumpZone.classList.add('touch-zone--active')
    if (!gameOver) {
      jumpBufferLeft = JUMP_BUFFER_SECONDS
    }
  })
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elJumpZone?.addEventListener(eventName, () => {
      elJumpZone.classList.remove('touch-zone--active')
    })
  }
  elJumpZone?.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
  elMoveZone?.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
  window.addEventListener('blur', resetTouchControls)

  for (const button of characterButtons) {
    button.addEventListener('click', async () => {
      audio.start()
      selectedCharacter = button.dataset.character === 'kurre' ? 'kurre' : 'sigge'
      setPlayerCharacter(selectedCharacter)
      setNpcForSelection(selectedCharacter)
      npcGreetingLeft = 0
      npcGreetingArmed = true
      elNpcSpeech?.classList.add('npc-speech--hidden')
      siggeG.position.copy(spawns[selectedCharacter])
      siggeG.rotation.set(0, 0, 0)
      if (elPlayerName) {
        elPlayerName.textContent = selectedCharacter === 'sigge' ? 'Sigge' : 'Kurre'
      }
      if (isMobileLike()) {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen()
          }
        } catch {
          // Fullscreen is best-effort; browsers may reject it.
        }
        try {
          await (screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }).lock?.('landscape')
        } catch {
          // Orientation lock is also best-effort, especially on iOS.
        }
      }
      titleStarted = true
      mobileStarted = true
      resetRiskChallenges()
      last = performance.now() / 1000
      updateMobileOverlays()
    })
  }

  let last = performance.now() / 1000

  const debugEnabled = (
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
    new URLSearchParams(window.location.search).has('debug')
  )
  if (debugEnabled) {
    window.__siggeDebug = {
      setCycleClock: (seconds: number) => {
        cycleClock = THREE.MathUtils.euclideanModulo(seconds, CYCLE_SECONDS)
        wasNight = isNightNow()
        updateDayNight(0)
      },
      setEnergy: (value: number) => {
        energy = THREE.MathUtils.clamp(value, 0, ENERGY_MAX)
      },
      spawnPickup: (kind?: PickupKind) => {
        if (kind) {
          const group = createPickupGroup(kind)
          group.position.copy(randomGardenPosition())
          scene.add(group)
          pickups.push({ group, kind, ttl: 42 })
        } else {
          spawnPickup()
        }
      },
      setRiskChallenge: (kind: RiskChallengeKind) => {
        setRiskChallenge(kind)
      },
    }
  }

  function restartGame() {
    highscoreViewGeneration += 1
    finishedRun = null
    submittedHighscoreId = null
    energy = START_ENERGY
    gameOver = false
    onGround = true
    playerFacing = 0
    cameraYaw = 0
    cameraPitch = 0.18
    hopPhase = 0
    foxMode = 'hidden'
    foxNext = 5
    foxSniffLeft = 0
    foxWalkPhase = 0
    foxBiteCooldown = 0
    foxBiteAnimLeft = 0
    catMode = 'hidden'
    catNext = 12
    catSniffLeft = 0
    catWalkPhase = 0
    catBiteCooldown = 0
    catBiteAnimLeft = 0
    cycleClock = TWILIGHT_SECONDS * 0.45
    survivedNights = 0
    wasNight = false
    armorCharges = 0
    shieldPotionLeft = 0
    speedPotionLeft = 0
    pickupSpawnNext = 7
    pickupMessageLeft = 0
    resetRiskChallenges()
    npcGreetingLeft = 0
    npcGreetingArmed = true
    pVel.set(0, 0, 0)
    airborneForwardSpeed = 0
    jumpChain = 0
    lastJumpAt = Number.NEGATIVE_INFINITY
    siggeG.position.copy(spawns[selectedCharacter])
    siggeG.rotation.set(0, 0, 0)
    siggeVisual.position.set(0, 0, 0)
    siggeArmor.visible = false
    foxG.visible = false
    foxG.position.set(0, 0, 12)
    catG.visible = false
    catG.position.set(0, 0, -12)
    for (const c of carrots) {
      c.picked = false
      c.regrowLeft = 0
      c.regrowTotal = 0
      setCarrotPlantGrowth(c, 1)
    }
    while (pickups.length > 0) {
      const pickup = pickups.pop()
      if (pickup) {
        scene.remove(pickup.group)
      }
    }
    resetTouchControls()
    for (const code of Object.keys(keys)) {
      keys[code] = false
    }
    elGameOverDialog?.classList.add('gameover-dialog--hidden')
    elGameOver?.classList.add('hud-gameover--hidden')
    elFox?.classList.add('hud-fox--hidden')
    elSafe?.classList.add('hud-safe--hidden')
    elPickup?.classList.add('hud-pickup--hidden')
    elNpcSpeech?.classList.add('npc-speech--hidden')
    if (elEnergy) {
      elEnergy.style.width = `${(energy / ENERGY_MAX) * 100}%`
    }
    updateDayNight(0)
    updateItemHud(0)
    last = performance.now() / 1000
  }

  elHighscoreForm?.addEventListener('submit', (event) => {
    void submitHighscore(event)
  })
  elRestart?.addEventListener('click', restartGame)

  function updateNpcRabbits(dt: number, now: number) {
    for (const [index, rabbit] of Object.values(npcRabbits).entries()) {
      if (!rabbit.root.visible) {
        continue
      }

      if (rabbit.waitLeft > 0) {
        rabbit.waitLeft = Math.max(0, rabbit.waitLeft - dt)
        rabbit.visual.position.y = THREE.MathUtils.lerp(rabbit.visual.position.y, 0, Math.min(1, dt * 9))
        rabbit.root.rotation.y += Math.sin(now * 1.8 + index) * dt * 0.08
        continue
      }

      const dx = rabbit.target.x - rabbit.root.position.x
      const dz = rabbit.target.y - rabbit.root.position.z
      const distance = Math.hypot(dx, dz)
      if (distance < 0.055) {
        rabbit.patrolIndex = (rabbit.patrolIndex + 1) % NPC_PATROL_POINTS.length
        const [localX, localZ] = NPC_PATROL_POINTS[rabbit.patrolIndex]
        rabbit.target.set(rabbit.hutch.center.x + localX, rabbit.hutch.center.z + localZ)
        rabbit.waitLeft = 0.45 + ((rabbit.patrolIndex + index) % 3) * 0.28
        continue
      }

      const speed = 0.34 + index * 0.025
      const stepLength = Math.min(distance, speed * dt)
      rabbit.root.position.x += (dx / distance) * stepLength
      rabbit.root.position.z += (dz / distance) * stepLength
      rabbit.root.position.y = rabbit.hutch.aabb.y0
      rabbit.root.rotation.y = Math.atan2(dx, dz)
      rabbit.walkPhase += dt * 9.2
      rabbit.visual.position.y = 0.052 * (0.5 - 0.5 * Math.cos(rabbit.walkPhase * 2.6))
    }
  }

  function updateNpcGreeting(dt: number) {
    const npc = selectedCharacter === 'sigge' ? npcRabbits.kurre : npcRabbits.sigge
    if (!npc.root.visible || !titleStarted) {
      elNpcSpeech?.classList.add('npc-speech--hidden')
      return
    }

    const distance = Math.hypot(
      siggeG.position.x - npc.hutch.center.x,
      siggeG.position.z - npc.hutch.center.z,
    )
    if (distance > 5.2) {
      npcGreetingArmed = true
    } else if (distance < 3.8 && npcGreetingArmed) {
      npcGreetingArmed = false
      npcGreetingLeft = 3.4
      if (elNpcSpeech) {
        elNpcSpeech.textContent = `Hej ${selectedCharacter === 'sigge' ? 'Sigge' : 'Kurre'}!`
      }
      audio.chatter()
    }

    if (npcGreetingLeft <= 0) {
      elNpcSpeech?.classList.add('npc-speech--hidden')
      return
    }
    npcGreetingLeft = Math.max(0, npcGreetingLeft - dt)
    npcSpeechPosition.copy(npc.root.position)
    npcSpeechPosition.y += 1.08
    npcSpeechPosition.project(camera)
    if (npcSpeechPosition.z < -1 || npcSpeechPosition.z > 1) {
      elNpcSpeech?.classList.add('npc-speech--hidden')
      return
    }
    if (elNpcSpeech) {
      elNpcSpeech.style.left = `${(npcSpeechPosition.x * 0.5 + 0.5) * window.innerWidth}px`
      elNpcSpeech.style.top = `${(-npcSpeechPosition.y * 0.5 + 0.5) * window.innerHeight}px`
      elNpcSpeech.classList.remove('npc-speech--hidden')
    }
  }

  function step(t: number) {
    const now = t / 1000
    let dt = now - last
    last = now
    if (dt > 0.1) {
      dt = 0.1
    }
    renderCharacterPreviews(characterPreviews, now)
    if (mobileBlocked()) {
      elRiskPointer?.classList.add('risk-pointer--hidden')
      renderer.render(scene, camera)
      return
    }
    updateAdaptiveRenderQuality(dt)
    updateDayNight(dt)
    updateItemHud(dt)
    if (foxBiteCooldown > 0) {
      foxBiteCooldown = Math.max(0, foxBiteCooldown - dt)
    }
    if (foxBiteAnimLeft > 0) {
      foxBiteAnimLeft = Math.max(0, foxBiteAnimLeft - dt)
    }
    if (catBiteCooldown > 0) {
      catBiteCooldown = Math.max(0, catBiteCooldown - dt)
    }
    if (catBiteAnimLeft > 0) {
      catBiteAnimLeft = Math.max(0, catBiteAnimLeft - dt)
    }
    if (!gameOver) {
      reduceEnergy(ENERGY_DRAIN_PER_SEC * dt)
    }
    if (!gameOver && foxMode === 'hidden') {
      foxNext -= dt * (isNightNow() ? 1.25 : 0.75)
      if (foxNext <= 0) {
        trySpawnFox()
      }
    }
    if (!gameOver && catMode === 'hidden') {
      catNext -= dt * (isNightNow() ? 1.55 : 0.55)
      if (catNext <= 0) {
        trySpawnCat()
      }
    }

    const kUp = keys['ArrowUp'] || keys['KeyW']
    const kDown = keys['ArrowDown'] || keys['KeyS']
    const kLeft = keys['ArrowLeft'] || keys['KeyA']
    const kRight = keys['ArrowRight'] || keys['KeyD']

    const mobileMoving = touchMove.active && (touchMove.x !== 0 || touchMove.y !== 0)
    let moveX = 0
    let moveZ = 0
    let moveAmount = 0

    if (mobileMoving) {
      const cameraForwardX = Math.sin(cameraYaw)
      const cameraForwardZ = Math.cos(cameraYaw)
      const cameraRightX = Math.cos(cameraYaw)
      const cameraRightZ = -Math.sin(cameraYaw)
      const forwardInput = -touchMove.y
      const sideInput = -touchMove.x
      moveX = cameraForwardX * forwardInput + cameraRightX * sideInput
      moveZ = cameraForwardZ * forwardInput + cameraRightZ * sideInput
      moveAmount = Math.min(1, Math.hypot(moveX, moveZ))
      if (moveAmount > 0) {
        moveX /= moveAmount
        moveZ /= moveAmount
        playerFacing = Math.atan2(moveX, moveZ)
      }
    } else {
      const turnInput = (kLeft ? 1 : 0) - (kRight ? 1 : 0)
      if (!gameOver && turnInput !== 0) {
        playerFacing += THREE.MathUtils.clamp(turnInput, -1, 1) * TURN_SPD * dt
      }
      moveX = Math.sin(playerFacing)
      moveZ = Math.cos(playerFacing)
      moveAmount = THREE.MathUtils.clamp((kUp ? 1 : 0) - (kDown ? 1 : 0), -1, 1)
      if (!isMobileLike()) {
        cameraYaw = playerFacing
      }
    }

    const boost = (1 + energy * 0.0008) * (speedPotionLeft > 0 ? 1.22 : 1)
    const speed = gameOver ? 0 : moveAmount * MOVE * dt * boost
    pVel.x = moveX * speed
    pVel.z = moveZ * speed
    pVel.y -= GRAVITY * dt
    jumpBufferLeft = Math.max(0, jumpBufferLeft - dt)
    if (!gameOver && onGround && jumpBufferLeft > 0) {
      jumpChain = now - lastJumpAt <= JUMP_CHAIN_WINDOW ? Math.min(jumpChain + 1, 3) : 0
      lastJumpAt = now
      airborneForwardSpeed = Math.min(JUMP_FORWARD_BASE + jumpChain * JUMP_FORWARD_STEP, JUMP_FORWARD_MAX)
      jumpDirection.set(Math.sin(playerFacing), Math.cos(playerFacing))
      pVel.y = JUMP_V
      onGround = false
      jumpBufferLeft = 0
      audio.jump()
    }
    if (!onGround && airborneForwardSpeed > 0) {
      // Ett hopp är alltid ett riktat skutt framåt. Varje snabb landning–hopp-
      // kedja ökar farten tills maxvärdet nås, så kaninen kan fly från rovdjur.
      pVel.x = jumpDirection.x * airborneForwardSpeed * dt
      pVel.z = jumpDirection.y * airborneForwardSpeed * dt
    }
    let nx = siggeG.position.x + pVel.x
    let ny = siggeG.position.y + pVel.y * dt
    let nz = siggeG.position.z + pVel.z

    nx = THREE.MathUtils.clamp(nx, -INNER + PLAYER_R, INNER - PLAYER_R)
    nz = THREE.MathUtils.clamp(nz, -WORLD_HALF_Z + PLAYER_R, WORLD_HALF_Z - PLAYER_R)

    const prevX = siggeG.position.x
    const prevZ = siggeG.position.z
    for (const collider of colliders) {
      const out = resolveCircleAabb2(
        collider.min.x,
        collider.min.y,
        collider.max.x,
        collider.max.y,
        nx,
        nz,
        PLAYER_R,
      )
      nx = out.x
      nz = out.z
    }

    // Altanen blockerar från marknivå men kan passeras när kaninen har hoppat över kanten.
    for (const platform of platforms) {
      if (ny >= platform.topY - 0.03) {
        continue
      }
      const out = resolveCircleAabb2(
        platform.aabb.min.x,
        platform.aabb.min.y,
        platform.aabb.max.x,
        platform.aabb.max.y,
        nx,
        nz,
        PLAYER_R,
      )
      nx = out.x
      nz = out.z
    }

    const hutchOut = resolveHutchWalls(prevX, prevZ, nx, nz)
    nx = hutchOut.x
    nz = hutchOut.z

    siggeG.position.x = nx
    siggeG.position.z = nz
    const supportY = Math.max(hutchFloorY(nx, nz), raisedPlatformFloorY(nx, ny, nz))
    const groundedY = supportY + PLAYER_H
    // Fånga bara marken när kaninen faller. Tidigare fångades även första
    // uppåtriktade hoppsteget (<14 cm), vilket avbröt hoppet omedelbart.
    if (pVel.y <= 0 && ny <= groundedY + 0.14) {
      ny = groundedY
      pVel.y = 0
      onGround = true
      airborneForwardSpeed = 0
    } else {
      onGround = false
    }
    siggeG.position.y = ny
    siggeG.rotation.y = playerFacing

    // Skuttbounce i kroppen när man går fram/bak; kollaps när man stannar
    const strolling = onGround && Math.abs(moveAmount) > 0.01
    if (strolling) {
      hopPhase += dt * 11.5
      siggeVisual.position.y = 0.1 * (0.5 - 0.5 * Math.cos(hopPhase * 2.6))
      audio.footstep(Math.abs(moveAmount))
      if (hedges.some((hedge) => distanceToHedge(hedge, nx, nz) <= hedge.halfWidth + PLAYER_R * 0.45)) {
        audio.rustle()
      }
    } else {
      hopPhase = THREE.MathUtils.lerp(hopPhase, 0, dt * 4)
      siggeVisual.position.y = THREE.MathUtils.lerp(siggeVisual.position.y, 0, Math.min(1, dt * 12))
    }
    if (!onGround) {
      siggeVisual.position.y = 0
    }

    updateNpcRabbits(dt, now)

    updateRiskChallenges(dt, now)
    updateCarrots(dt)
    updatePickups(dt, now)

    const safe = inSafeZone(nx, ny, nz)
    elSafe?.classList.toggle('hud-safe--hidden', !safe)
    elGameOver?.classList.toggle('hud-gameover--hidden', !gameOver)
    if (
      safe ||
      ((foxMode === 'hidden' || foxMode === 'leave') && (catMode === 'hidden' || catMode === 'leave'))
    ) {
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
        const siggeToFox = foxToPlayer.copy(foxG.position).sub(siggeG.position)
        siggeToFox.y = 0
        if (siggeToFox.lengthSq() < 0.001) {
          siggeToFox.set(Math.sin(foxG.rotation.y), 0, Math.cos(foxG.rotation.y))
        }
        siggeToFox.normalize()
        foxTarget.set(
          siggeG.position.x + siggeToFox.x * FOX_ATTACK_DIST,
          0.25,
          siggeG.position.z + siggeToFox.z * FOX_ATTACK_DIST,
        )
        foxMoving = moveFoxToward(foxTarget, FOX_SPD * (0.9 + (100 - energy) * 0.00035), dt) > 0.08
        foxG.position.x = THREE.MathUtils.clamp(foxG.position.x, -INNER + 0.4, INNER - 0.4)
        foxG.position.z = THREE.MathUtils.clamp(foxG.position.z, -WORLD_HALF_Z + 0.4, WORLD_HALF_Z - 0.4)
        foxG.rotation.y = Math.atan2(siggeG.position.x - foxG.position.x, siggeG.position.z - foxG.position.z)
        if (
          foxBiteCooldown <= 0 &&
          Math.hypot(foxG.position.x - nx, foxG.position.z - nz) <= FOX_BITE
        ) {
          receiveBite(FOX_BITE_DAMAGE)
          foxBiteCooldown = FOX_BITE_COOLDOWN
          foxBiteAnimLeft = FOX_BITE_ANIM_TIME
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
      if (remaining < 0.2 || Math.abs(foxG.position.x) > INNER || Math.abs(foxG.position.z) > WORLD_HALF_Z) {
        hideFox()
      }
    }
    animateFox(foxMoving, foxSniffing, dt, now)

    let catMoving = false
    let catSniffing = false
    if (catMode === 'chase') {
      if (safe) {
        startCatSniff()
      } else {
        const siggeToCat = catToPlayer.copy(catG.position).sub(siggeG.position)
        siggeToCat.y = 0
        if (siggeToCat.lengthSq() < 0.001) {
          siggeToCat.set(Math.sin(catG.rotation.y), 0, Math.cos(catG.rotation.y))
        }
        siggeToCat.normalize()
        catTarget.set(
          siggeG.position.x + siggeToCat.x * CAT_ATTACK_DIST,
          0.22,
          siggeG.position.z + siggeToCat.z * CAT_ATTACK_DIST,
        )
        catMoving = moveCatToward(catTarget, CAT_SPD * (isNightNow() ? 1.08 : 0.92), dt) > 0.07
        catG.position.x = THREE.MathUtils.clamp(catG.position.x, -INNER + 0.35, INNER - 0.35)
        catG.position.z = THREE.MathUtils.clamp(catG.position.z, -WORLD_HALF_Z + 0.35, WORLD_HALF_Z - 0.35)
        catG.rotation.y = Math.atan2(siggeG.position.x - catG.position.x, siggeG.position.z - catG.position.z)
        if (
          catBiteCooldown <= 0 &&
          Math.hypot(catG.position.x - nx, catG.position.z - nz) <= CAT_BITE
        ) {
          receiveBite(CAT_BITE_DAMAGE)
          catBiteCooldown = CAT_BITE_COOLDOWN
          catBiteAnimLeft = CAT_BITE_ANIM_TIME
        }
      }
    } else if (catMode === 'sniff') {
      const remaining = moveCatToward(catTarget, CAT_SPD * 0.58, dt)
      catMoving = remaining > 0.07
      if (remaining < 0.07) {
        catSniffing = true
        catSniffLeft -= dt
        catG.rotation.y += Math.sin(performance.now() * 0.016) * dt * 1.1
        if (catSniffLeft <= 0) {
          catMode = 'leave'
        }
      }
    } else if (catMode === 'leave') {
      const remaining = moveCatToward(catLeaveTarget, CAT_SPD * 0.85, dt)
      catMoving = true
      if (remaining < 0.2 || Math.abs(catG.position.x) > INNER || Math.abs(catG.position.z) > WORLD_HALF_Z) {
        hideCat()
      }
    }
    animateCat(catMoving, catSniffing, dt, now)
    audio.update(foxMode === 'chase' || foxMode === 'sniff' || catMode === 'chase' || catMode === 'sniff')

    // Kamera: följer bakom Sigge, men kan vridas fritt på mobil.
    cameraForward.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw))
    cameraBack.copy(cameraForward).multiplyScalar(-1)
    const dist = 4.35
    const horizontalDist = Math.cos(cameraPitch) * dist
    cameraPosition.set(
      siggeG.position.x + cameraBack.x * horizontalDist,
      siggeG.position.y + 1.15 + Math.sin(cameraPitch) * dist,
      siggeG.position.z + cameraBack.z * horizontalDist,
    )
    camera.position.lerp(cameraPosition, 0.18)
    cameraTarget.set(siggeG.position.x, siggeG.position.y + 0.3, siggeG.position.z)
    camera.lookAt(cameraTarget)
    updateNpcGreeting(dt)
    updateRiskPointer()

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
