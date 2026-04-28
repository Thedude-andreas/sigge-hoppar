import './style.css'
import * as THREE from 'three'
import { BUILD_TAG } from './version'

/* --- Constant world layout --- */
const INNER = 17.5
const GROUND = 0
const SIGGE_SCALE = 0.72
const PLAYER_H = 0
const PLAYER_R = 0.29
const GRAVITY = 18
const JUMP_V = 7.2
const MOVE = 5.7
const FOX_SPD = 4.9
const FOX_TIMER_MIN = 8
const FOX_TIMER_MAX = 18
const FOX_SNIFF_TIME = 2.7
const FOX_SNIFF_DIST = 1.35
const CARROT_PICK = 0.85
const FOX_BITE = 0.74
const ENERGY_MAX = 100
const ENERGY_PER_CARROT = 18
const ENERGY_DRAIN_PER_SEC = 1.4
const FOX_BITE_DAMAGE = 24
const FOX_BITE_COOLDOWN = 1.15
const FOX_BITE_ANIM_TIME = 0.42
const FOX_ATTACK_DIST = 0.68
const START_ENERGY = 45

/* --- AABB (Vector2: x, z) --- */
type Box3XZ = { min: THREE.Vector2; max: THREE.Vector2; y0: number; y1: number }
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

  // Morotsland: fyrkantig jordbädd med raka planteringsrader.
  const carrotPatchCenter = new THREE.Vector2(8, -6)
  const carrotPatchW = 8.6
  const carrotPatchD = 5.8
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x5a3821, roughness: 0.96 })
  const soilDarkMat = new THREE.MeshStandardMaterial({ color: 0x3d2819, roughness: 0.98 })
  const patch = new THREE.Mesh(new THREE.BoxGeometry(carrotPatchW, 0.08, carrotPatchD), soilMat)
  patch.position.set(carrotPatchCenter.x, 0.04, carrotPatchCenter.y)
  scene.add(patch)
  for (const rowZ of [-1.85, -0.62, 0.62, 1.85]) {
    const row = new THREE.Mesh(new THREE.BoxGeometry(carrotPatchW - 0.6, 0.035, 0.16), soilDarkMat)
    row.position.set(carrotPatchCenter.x, 0.095, carrotPatchCenter.y + rowZ)
    scene.add(row)
  }

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

  // Svensk enplansvilla: låg röd träpanel, vita omfattningar och inbyggt garage på ena gaveln.
  const houseW = 13
  const houseD = 8
  const houseH = 2.65
  const houseG = new THREE.Group()
  const redMat = new THREE.MeshStandardMaterial({ color: 0xba2a20, roughness: 0.5 })
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f2e8, roughness: 0.55 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d332b, roughness: 0.7 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x8db6c9, roughness: 0.18, metalness: 0.05 })
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
    houseG.add(trim, glass, crossV, crossH)
  }

  const addGableWindow = (x: number, y: number, z: number) => {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.3), whiteMat)
    trim.position.set(x, y, z)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.62, 0.96), glassMat)
    glass.position.set(x - 0.015, y, z)
    houseG.add(trim, glass)
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

  // Carrots
  const carrots: THREE.Object3D[] = []
  const carrotMat = new THREE.MeshStandardMaterial({ color: 0xe9781d, emissive: 0x1f0a00, roughness: 0.72 })
  const carrotTopMat = new THREE.MeshStandardMaterial({ color: 0xf28a24, roughness: 0.68 })
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x286f22, roughness: 0.75 })
  const makeCarrot = (lean: number) => {
    const g = new THREE.Group()

    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 0.24, 12), carrotTopMat)
    shoulder.position.y = 0.18
    g.add(shoulder)

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.34, 12), carrotMat)
    tip.rotation.x = Math.PI
    tip.position.y = 0.13
    g.add(tip)

    for (let i = 0; i < 7; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.44 + (i % 3) * 0.07, 5), stemMat)
      const angle = (i / 7) * Math.PI * 2 + lean
      const tilt = 0.35 + (i % 2) * 0.18
      blade.position.set(Math.cos(angle) * 0.045, 0.43, Math.sin(angle) * 0.045)
      blade.rotation.set(Math.sin(angle) * tilt, angle, -Math.cos(angle) * tilt)
      g.add(blade)
    }

    return g
  }
  const carrotRows = [-1.85, -0.62, 0.62, 1.85]
  const carrotCols = [-3.2, -1.6, 0, 1.6, 3.2]
  for (let row = 0; row < carrotRows.length; row++) {
    for (let col = 0; col < carrotCols.length; col++) {
      if ((row === 0 && col === 4) || (row === 3 && col === 0)) {
        continue
      }
      const g = makeCarrot(row * 0.45 + col * 0.18)
      const offsetX = ((row + col) % 2 === 0 ? -0.08 : 0.08)
      const offsetZ = col % 2 === 0 ? 0.04 : -0.04
      g.position.set(
        carrotPatchCenter.x + carrotCols[col] + offsetX,
        0.08,
        carrotPatchCenter.y + carrotRows[row] + offsetZ,
      )
      g.rotation.y = ((row + col) % 3 - 1) * 0.08
      scene.add(g)
      carrots.push(g)
    }
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
  siggeVisual.scale.setScalar(SIGGE_SCALE)
  siggeG.add(siggeVisual)
  siggeG.position.set(0, PLAYER_H, 0)
  scene.add(siggeG)

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

  return {
    scene,
    siggeG,
    siggeVisual,
    foxG,
    carrots,
    houseAabb,
    hutchAabb,
    hutchCenter,
    rampSpec,
    hutchSpec,
  }
}

function main() {
  const root = document.getElementById('app')!
  // HUD: läs in efter att DOM:en finns; index.html ersätts i bygget med rätt "Kod:" redan
  const elEnergy = document.getElementById('energy-bar') as HTMLDivElement | null
  const elFox = document.getElementById('hud-fox') as HTMLParagraphElement | null
  const elSafe = document.getElementById('hud-safe') as HTMLParagraphElement | null
  const elGameOver = document.getElementById('hud-gameover') as HTMLParagraphElement | null
  const elGameOverDialog = document.getElementById('gameover-dialog') as HTMLDivElement | null
  const elRestart = document.getElementById('restart-game') as HTMLButtonElement | null
  const elMoveZone = document.getElementById('move-zone') as HTMLDivElement | null
  const elMoveStick = document.getElementById('move-stick') as HTMLDivElement | null
  const elMoveKnob = document.getElementById('move-knob') as HTMLDivElement | null
  const elCameraZone = document.getElementById('camera-zone') as HTMLDivElement | null
  const elJumpZone = document.getElementById('jump-zone') as HTMLButtonElement | null
  const elStartScreen = document.getElementById('start-screen') as HTMLDivElement | null
  const elRotateScreen = document.getElementById('rotate-screen') as HTMLDivElement | null
  const elStartFullscreen = document.getElementById('start-fullscreen') as HTMLButtonElement | null
  const rev = document.getElementById('hud-rev')
  if (rev) {
    rev.textContent = `Kod: ${BUILD_TAG}`
  }
  const { scene, siggeG, siggeVisual, foxG, carrots, houseAabb, hutchAabb, hutchCenter, rampSpec, hutchSpec } = buildScene()

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
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
  let touchJumpQueued = false
  const pVel = new THREE.Vector3(0, 0, 0)
  const foxP = new THREE.Vector3(0, 0, 12)
  /** Var Sigge tittar (Y-rotation) — kameran följer bakifrån. */
  let playerFacing = 0
  let cameraYaw = 0
  let cameraPitch = 0.18
  let hopPhase = 0
  const TURN_SPD = 2.2
  let energy = START_ENERGY
  let onGround = true
  let gameOver = false
  let foxMode: FoxMode = 'hidden'
  let foxNext = 5
  let foxSniffLeft = 0
  let foxWalkPhase = 0
  let foxBiteCooldown = 0
  let foxBiteAnimLeft = 0
  let mobileStarted = !isMobileLike()
  const foxTarget = new THREE.Vector3()
  const foxLeaveTarget = new THREE.Vector3()

  function isMobileLike(): boolean {
    return navigator.maxTouchPoints > 0 || window.matchMedia('(hover: none), (pointer: coarse)').matches
  }

  function isPortrait(): boolean {
    return window.innerHeight > window.innerWidth
  }

  function mobileBlocked(): boolean {
    return isMobileLike() && (!mobileStarted || isPortrait())
  }

  function updateMobileOverlays() {
    const mobile = isMobileLike()
    const portrait = isPortrait()
    elStartScreen?.classList.toggle('mobile-overlay--hidden', !mobile || mobileStarted || portrait)
    elRotateScreen?.classList.toggle('mobile-overlay--hidden', !mobile || !portrait)
    if (!mobile) {
      mobileStarted = true
    }
    if (mobileBlocked()) {
      resetTouchControls()
    }
  }

  function inSafeZone(x: number, y: number, z: number): boolean {
    return (
      aabb2ContainsXZ(hutchAabb, x, z) && y + PLAYER_H * 0.3 >= hutchAabb.y0 && y < hutchAabb.y1 + 0.2
    )
  }

  function hutchFloorY(x: number, z: number): number {
    if (!aabb2ContainsXZ(hutchAabb, x, z)) {
      return GROUND
    }

    const localX = x - hutchCenter.x
    const localZ = z - hutchCenter.z
    let floorY = GROUND

    const onShelf = (
      localX >= 0.43 - 0.43 - PLAYER_R * 0.35 &&
      localX <= 0.43 + 0.43 + PLAYER_R * 0.35 &&
      localZ >= -0.48 - 0.31 - PLAYER_R * 0.35 &&
      localZ <= -0.48 + 0.31 + PLAYER_R * 0.35
    )
    if (onShelf) {
      floorY = Math.max(floorY, rampSpec.yTop)
    }

    const onRamp = (
      localX >= rampSpec.x - rampSpec.w / 2 - PLAYER_R * 0.25 &&
      localX <= rampSpec.x + rampSpec.w / 2 + PLAYER_R * 0.25 &&
      localZ >= rampSpec.zTop &&
      localZ <= rampSpec.zBottom
    )
    if (onRamp) {
      const t = THREE.MathUtils.clamp((rampSpec.zBottom - localZ) / (rampSpec.zBottom - rampSpec.zTop), 0, 1)
      floorY = Math.max(floorY, THREE.MathUtils.lerp(rampSpec.yBottom, rampSpec.yTop, t))
    }

    return floorY
  }

  function inHutchDoor(localX: number): boolean {
    return Math.abs(localX - hutchSpec.doorX) <= hutchSpec.doorW / 2
  }

  function resolveHutchWalls(prevX: number, prevZ: number, x: number, z: number): { x: number; z: number } {
    const halfW = hutchSpec.w / 2
    const halfD = hutchSpec.d / 2
    const prevLocalX = prevX - hutchCenter.x
    const prevLocalZ = prevZ - hutchCenter.z
    const localX = x - hutchCenter.x
    const localZ = z - hutchCenter.z
    const prevInside = Math.abs(prevLocalX) <= halfW && Math.abs(prevLocalZ) <= halfD
    const nextInside = Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD
    const nearDoor = inHutchDoor((prevLocalX + localX) / 2)
    const throughDoor = nearDoor && (
      (prevLocalZ <= halfD && localZ >= halfD - PLAYER_R) ||
      (prevLocalZ >= halfD && localZ <= halfD + PLAYER_R)
    )

    if (throughDoor) {
      return { x, z }
    }

    if (prevInside) {
      return {
        x: hutchCenter.x + THREE.MathUtils.clamp(localX, -halfW + PLAYER_R, halfW - PLAYER_R),
        z: hutchCenter.z + THREE.MathUtils.clamp(localZ, -halfD + PLAYER_R, halfD - PLAYER_R),
      }
    }

    if (nextInside) {
      const dxLeft = Math.abs(prevLocalX + halfW)
      const dxRight = Math.abs(prevLocalX - halfW)
      const dzBack = Math.abs(prevLocalZ + halfD)
      const dzFront = Math.abs(prevLocalZ - halfD)
      const nearest = Math.min(dxLeft, dxRight, dzBack, dzFront)
      if (nearest === dxLeft) {
        return { x: hutchCenter.x - halfW - PLAYER_R, z }
      }
      if (nearest === dxRight) {
        return { x: hutchCenter.x + halfW + PLAYER_R, z }
      }
      if (nearest === dzBack) {
        return { x, z: hutchCenter.z - halfD - PLAYER_R }
      }
      return { x, z: hutchCenter.z + halfD + PLAYER_R }
    }

    const overlapsHutchBand = Math.abs(localX) <= halfW + PLAYER_R && Math.abs(localZ) <= halfD + PLAYER_R
    if (overlapsHutchBand) {
      const fromLeft = Math.abs(localX + halfW)
      const fromRight = Math.abs(localX - halfW)
      const fromBack = Math.abs(localZ + halfD)
      const fromFront = Math.abs(localZ - halfD)
      const nearest = Math.min(fromLeft, fromRight, fromBack, fromFront)
      if (nearest === fromLeft) {
        return { x: hutchCenter.x - halfW - PLAYER_R, z }
      }
      if (nearest === fromRight) {
        return { x: hutchCenter.x + halfW + PLAYER_R, z }
      }
      if (nearest === fromBack) {
        return { x, z: hutchCenter.z - halfD - PLAYER_R }
      }
      if (!inHutchDoor(localX)) {
        return { x, z: hutchCenter.z + halfD + PLAYER_R }
      }
    }

    return { x, z }
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
    if (gameOver) {
      return
    }
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

  function reduceEnergy(amount: number) {
    if (gameOver || amount <= 0) {
      return
    }
    energy = Math.max(0, energy - amount)
    if (energy <= 0) {
      gameOver = true
      energy = 0
      elGameOverDialog?.classList.remove('gameover-dialog--hidden')
      pVel.set(0, 0, 0)
      resetTouchControls()
      for (const code of Object.keys(keys)) {
        keys[code] = false
      }
    }
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
  })
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false
  })

  function resetTouchControls() {
    resetTouchMove()
    resetTouchCamera()
    touchJumpQueued = false
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
      touchJumpQueued = true
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

  elStartFullscreen?.addEventListener('click', async () => {
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
    mobileStarted = true
    updateMobileOverlays()
  })

  let last = performance.now() / 1000

  function restartGame() {
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
    pVel.set(0, 0, 0)
    siggeG.position.set(0, PLAYER_H, 0)
    siggeG.rotation.set(0, 0, 0)
    siggeVisual.position.set(0, 0, 0)
    foxG.visible = false
    foxG.position.set(0, 0, 12)
    for (const c of carrots) {
      c.userData.picked = false
      c.visible = true
    }
    resetTouchControls()
    for (const code of Object.keys(keys)) {
      keys[code] = false
    }
    elGameOverDialog?.classList.add('gameover-dialog--hidden')
    elGameOver?.classList.add('hud-gameover--hidden')
    elFox?.classList.add('hud-fox--hidden')
    elSafe?.classList.add('hud-safe--hidden')
    if (elEnergy) {
      elEnergy.style.width = `${(energy / ENERGY_MAX) * 100}%`
    }
    last = performance.now() / 1000
  }

  elRestart?.addEventListener('click', restartGame)

  function step(t: number) {
    const now = t / 1000
    let dt = now - last
    last = now
    if (dt > 0.1) {
      dt = 0.1
    }
    if (mobileBlocked()) {
      renderer.render(scene, camera)
      return
    }
    if (foxBiteCooldown > 0) {
      foxBiteCooldown = Math.max(0, foxBiteCooldown - dt)
    }
    if (foxBiteAnimLeft > 0) {
      foxBiteAnimLeft = Math.max(0, foxBiteAnimLeft - dt)
    }
    if (!gameOver) {
      reduceEnergy(ENERGY_DRAIN_PER_SEC * dt)
    }
    if (!gameOver && foxMode === 'hidden') {
      foxNext -= dt
      if (foxNext <= 0) {
        trySpawnFox()
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

    const boost = 1 + energy * 0.0008
    const speed = gameOver ? 0 : moveAmount * MOVE * dt * boost
    pVel.x = moveX * speed
    pVel.z = moveZ * speed
    pVel.y -= GRAVITY * dt
    const jumpPressed = keys['Space'] || touchJumpQueued
    if (!gameOver && onGround && jumpPressed) {
      pVel.y = JUMP_V
      onGround = false
    }
    touchJumpQueued = false
    let nx = siggeG.position.x + pVel.x
    let ny = Math.max(0, siggeG.position.y + pVel.y * dt)
    let nz = siggeG.position.z + pVel.z

    nx = THREE.MathUtils.clamp(nx, -INNER + PLAYER_R, INNER - PLAYER_R)
    nz = THREE.MathUtils.clamp(nz, -INNER + PLAYER_R, INNER - PLAYER_R)

    const prevX = siggeG.position.x
    const prevZ = siggeG.position.z
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

    const hutchOut = resolveHutchWalls(prevX, prevZ, nx, nz)
    nx = hutchOut.x
    nz = hutchOut.z

    siggeG.position.x = nx
    siggeG.position.z = nz
    const supportY = hutchFloorY(nx, nz)
    const groundedY = supportY + PLAYER_H
    if (ny <= groundedY + 0.14) {
      ny = groundedY
      pVel.y = 0
      onGround = true
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
    elGameOver?.classList.toggle('hud-gameover--hidden', !gameOver)
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
        const siggeToFox = foxG.position.clone().sub(siggeG.position)
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
        foxG.position.z = THREE.MathUtils.clamp(foxG.position.z, -INNER + 0.4, INNER - 0.4)
        foxG.rotation.y = Math.atan2(siggeG.position.x - foxG.position.x, siggeG.position.z - foxG.position.z)
        if (
          foxBiteCooldown <= 0 &&
          new THREE.Vector2(foxG.position.x, foxG.position.z).distanceTo(new THREE.Vector2(nx, nz)) <= FOX_BITE
        ) {
          reduceEnergy(FOX_BITE_DAMAGE)
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
      if (remaining < 0.2 || Math.abs(foxG.position.x) > INNER || Math.abs(foxG.position.z) > INNER) {
        hideFox()
      }
    }
    animateFox(foxMoving, foxSniffing, dt, now)

    // Kamera: följer bakom Sigge, men kan vridas fritt på mobil.
    const f = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw))
    const back = f.clone().multiplyScalar(-1)
    const dist = 4.35
    const horizontalDist = Math.cos(cameraPitch) * dist
    const camP = new THREE.Vector3(
      siggeG.position.x + back.x * horizontalDist,
      siggeG.position.y + 1.15 + Math.sin(cameraPitch) * dist,
      siggeG.position.z + back.z * horizontalDist,
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
