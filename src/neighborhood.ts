import * as THREE from 'three'

export type Box3XZ = { min: THREE.Vector2; max: THREE.Vector2; y0: number; y1: number }
export type RampSpec = {
  x: number
  zBottom: number
  zTop: number
  w: number
  yBottom: number
  yTop: number
}
export type HutchSpec = { w: number; d: number; doorX: number; doorW: number }
export type HutchZone = {
  name: 'Sigge' | 'Kurre'
  center: THREE.Vector3
  aabb: Box3XZ
  ramp: RampSpec
  spec: HutchSpec
  spawn: THREE.Vector3
}

export const WORLD_HALF_X = 48
export const WORLD_HALF_Z = 70

// Ortofotots norra del (röda huset) ligger högre än gc-vägen och vita huset.
export function terrainHeightAt(_x: number, z: number): number {
  if (z <= -12) return 2.4
  if (z >= 10) return 0
  const t = THREE.MathUtils.smoothstep(z, -12, 10)
  return THREE.MathUtils.lerp(2.4, 0, t)
}

type NeighborhoodResult = {
  colliders: Box3XZ[]
  hutches: HutchZone[]
  spawns: Record<'sigge' | 'kurre', THREE.Vector3>
  carrotPatches: THREE.Vector2[]
  windowLights: THREE.PointLight[]
  windowMaterials: THREE.MeshStandardMaterial[]
}

const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)

function gableRoof(w: number, d: number, eaveY: number, ridgeY: number, mat: THREE.Material) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -w / 2, eaveY, -d / 2, w / 2, eaveY, -d / 2, -w / 2, ridgeY, 0, w / 2, ridgeY, 0,
    -w / 2, eaveY, d / 2, w / 2, eaveY, d / 2,
  ], 3))
  geo.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 0, 2, 4, 1, 5, 3, 0, 4, 5, 0, 5, 1])
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, mat)
}

function addTerrain(scene: THREE.Scene) {
  const cols = 32
  const rows = 46
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const grassA = new THREE.Color(0x4e843f)
  const grassB = new THREE.Color(0x67964e)
  for (let rz = 0; rz <= rows; rz++) {
    const z = -WORLD_HALF_Z + (rz / rows) * WORLD_HALF_Z * 2
    for (let cx = 0; cx <= cols; cx++) {
      const x = -WORLD_HALF_X + (cx / cols) * WORLD_HALF_X * 2
      const y = terrainHeightAt(x, z)
      positions.push(x, y, z)
      const variation = (Math.sin(x * 0.43) + Math.cos(z * 0.31)) * 0.045
      const c = grassA.clone().lerp(grassB, THREE.MathUtils.clamp(0.52 + variation, 0, 1))
      colors.push(c.r, c.g, c.b)
    }
  }
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const a = z * (cols + 1) + x
      const b = a + 1
      const c = a + cols + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }))
  ground.receiveShadow = true
  scene.add(ground)
}

function addRibbon(scene: THREE.Scene, points: [number, number][], width: number, material: THREE.Material, lift = 0.035) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
  const segments = Math.max(10, points.length * 8)
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = curve.getPoint(t)
    const tangent = curve.getTangent(t).normalize()
    const nx = -tangent.z
    const nz = tangent.x
    for (const side of [-1, 1]) {
      const x = p.x + nx * width * 0.5 * side
      const z = p.z + nz * width * 0.5 * side
      positions.push(x, terrainHeightAt(x, z) + lift, z)
    }
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const road = new THREE.Mesh(geo, material)
  road.receiveShadow = true
  scene.add(road)
}

function addHedge(scene: THREE.Scene, x1: number, z1: number, x2: number, z2: number, height = 1.3, width = 0.85) {
  const length = Math.hypot(x2 - x1, z2 - z1)
  const y = Math.max(terrainHeightAt(x1, z1), terrainHeightAt(x2, z2)) + height * 0.5
  const mat = new THREE.MeshStandardMaterial({ color: 0x245d2b, roughness: 0.92 })
  const hedge = box(width, height, length, mat)
  hedge.position.set((x1 + x2) / 2, y, (z1 + z2) / 2)
  hedge.rotation.y = Math.atan2(x2 - x1, z2 - z1)
  hedge.castShadow = true
  scene.add(hedge)
  const capGeo = new THREE.SphereGeometry(width * 0.65, 9, 6)
  for (let d = 0; d <= length; d += 1.25) {
    const t = length === 0 ? 0 : d / length
    const cap = new THREE.Mesh(capGeo, mat)
    cap.scale.set(1, 0.66, 1.2)
    cap.position.set(THREE.MathUtils.lerp(x1, x2, t), y + height * 0.36, THREE.MathUtils.lerp(z1, z2, t))
    scene.add(cap)
  }
}

function addWindow(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  facing: 1 | -1,
  trim: THREE.Material,
  glass: THREE.MeshStandardMaterial,
  windowLights: THREE.PointLight[],
) {
  const frame = box(width + 0.22, height + 0.22, 0.08, trim)
  frame.position.set(x, y, z)
  const pane = box(width, height, 0.1, glass)
  pane.position.set(x, y, z + facing * 0.055)
  const mullion = box(0.055, height, 0.12, trim)
  mullion.position.set(x, y, z + facing * 0.115)
  parent.add(frame, pane, mullion)
  const light = new THREE.PointLight(0xffb35a, 0, 7, 2)
  light.position.set(x, y, z + facing * 0.5)
  parent.add(light)
  windowLights.push(light)
}

function addSimpleHouse(
  scene: THREE.Scene,
  colliders: Box3XZ[],
  windowLights: THREE.PointLight[],
  windowMaterials: THREE.MeshStandardMaterial[],
  x: number,
  z: number,
  w: number,
  d: number,
  wallColor: number,
  roofColor: number,
  rotation = 0,
  height = 2.7,
) {
  const ground = terrainHeightAt(x, z)
  const g = new THREE.Group()
  const wall = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.72 })
  const roof = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.82 })
  const trim = new THREE.MeshStandardMaterial({ color: 0xf3eee4, roughness: 0.62 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x7295a2, emissive: 0xffad52, emissiveIntensity: 0, roughness: 0.2 })
  windowMaterials.push(glass)
  const body = box(w, height, d, wall)
  body.position.y = height / 2
  g.add(body, gableRoof(w + 0.65, d + 0.85, height + 0.06, height + 1.2, roof))
  addWindow(g, -w * 0.22, height * 0.58, d / 2 + 0.045, Math.min(1.2, w * 0.18), 0.82, 1, trim, glass, windowLights)
  addWindow(g, w * 0.22, height * 0.58, d / 2 + 0.045, Math.min(1.2, w * 0.18), 0.82, 1, trim, glass, windowLights)
  g.position.set(x, ground, z)
  g.rotation.y = rotation
  scene.add(g)
  const cw = Math.abs(Math.cos(rotation)) * w + Math.abs(Math.sin(rotation)) * d
  const cd = Math.abs(Math.sin(rotation)) * w + Math.abs(Math.cos(rotation)) * d
  colliders.push({ min: new THREE.Vector2(x - cw / 2 - 0.2, z - cd / 2 - 0.2), max: new THREE.Vector2(x + cw / 2 + 0.2, z + cd / 2 + 0.2), y0: ground, y1: ground + height + 1.2 })
  return g
}

function addWhiteHouse(scene: THREE.Scene, colliders: Box3XZ[], windowLights: THREE.PointLight[], windowMaterials: THREE.MeshStandardMaterial[]) {
  const x = 8
  const z = 31
  const w = 13.5
  const d = 9
  const ground = terrainHeightAt(x, z)
  const g = new THREE.Group()
  const siding = new THREE.MeshStandardMaterial({ color: 0xeee9dc, roughness: 0.72 })
  const white = new THREE.MeshStandardMaterial({ color: 0xfaf8ef, roughness: 0.6 })
  const roof = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.82 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x7899a8, emissive: 0xffb35a, emissiveIntensity: 0, roughness: 0.18 })
  const deck = new THREE.MeshStandardMaterial({ color: 0x8d8170, roughness: 0.86 })
  windowMaterials.push(glass)

  const body = box(w, 5.4, d, siding)
  body.position.y = 2.7
  g.add(body, gableRoof(w + 0.85, d + 1, 5.48, 7.15, roof))

  // Fronten från referensfotot: mittveranda i två våningar, balkong och symmetriska fönster.
  const porchW = 5.4
  const porchD = 1.65
  const porchFloor = box(porchW, 0.16, porchD, deck)
  porchFloor.position.set(0, 0.1, d / 2 + porchD / 2)
  g.add(porchFloor)
  for (const px of [-porchW / 2, -0.95, 0.95, porchW / 2]) {
    const post = box(0.16, 5.0, 0.16, white)
    post.position.set(px, 2.55, d / 2 + porchD - 0.18)
    g.add(post)
  }
  const balcony = box(porchW, 0.18, porchD, white)
  balcony.position.set(0, 2.85, d / 2 + porchD / 2)
  g.add(balcony)
  for (let px = -porchW / 2; px <= porchW / 2 + 0.01; px += 0.32) {
    const baluster = box(0.055, 0.82, 0.055, white)
    baluster.position.set(px, 3.32, d / 2 + porchD - 0.08)
    g.add(baluster)
  }
  const rail = box(porchW + 0.1, 0.11, 0.12, white)
  rail.position.set(0, 3.76, d / 2 + porchD - 0.08)
  g.add(rail)
  const balconyRoof = gableRoof(porchW + 0.6, porchD + 0.75, 5.5, 6.8, roof)
  balconyRoof.position.z = d / 2 + porchD / 2
  g.add(balconyRoof)

  const doorFrame = box(1.15, 2.2, 0.09, white)
  doorFrame.position.set(0, 1.18, d / 2 + 0.07)
  const door = box(0.88, 1.92, 0.12, new THREE.MeshStandardMaterial({ color: 0xe5dfd2, roughness: 0.62 }))
  door.position.set(0, 1.06, d / 2 + 0.14)
  const doorWindow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), glass)
  doorWindow.position.set(0, 1.52, d / 2 + 0.205)
  g.add(doorFrame, door, doorWindow)
  for (const [wx, wy] of [[-4.2, 1.65], [4.2, 1.65], [-1.45, 4.35], [1.45, 4.35]] as [number, number][]) {
    addWindow(g, wx, wy, d / 2 + 0.05, wy > 3 ? 1.05 : 1.45, wy > 3 ? 1.0 : 1.25, 1, white, glass, windowLights)
  }
  g.position.set(x, ground, z)
  scene.add(g)
  colliders.push({ min: new THREE.Vector2(x - w / 2 - 0.25, z - d / 2 - 0.25), max: new THREE.Vector2(x + w / 2 + 0.25, z + d / 2 + porchD + 0.25), y0: ground, y1: ground + 7.2 })

  // Fristående garage på höger sida, som på fasadbilden och ortofotot.
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, 19.2, 31.2, 7.0, 8.2, 0xe8e2d5, 0x292929, 0, 2.65)
}

function addRedHouse(scene: THREE.Scene, colliders: Box3XZ[], windowLights: THREE.PointLight[], windowMaterials: THREE.MeshStandardMaterial[]) {
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, -2, -31, 16.5, 9.2, 0xb92d24, 0x463a32, 0, 2.8)
  // Den grå sammanbyggda delen/garaget i ortofotots östra sida.
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, 10.2, -31, 8.4, 8.8, 0x777a75, 0x3f403d, 0, 2.55)
  const patioMat = new THREE.MeshStandardMaterial({ color: 0x9b8d78, roughness: 0.94 })
  const patio = box(7.2, 0.12, 3.4, patioMat)
  patio.position.set(-2.5, terrainHeightAt(-2.5, -24.2) + 0.06, -24.2)
  scene.add(patio)
}

function addOutbuilding(scene: THREE.Scene, colliders: Box3XZ[], x: number, z: number, w: number, d: number, color: number, rotation = 0) {
  const y = terrainHeightAt(x, z)
  const g = new THREE.Group()
  const wall = new THREE.MeshStandardMaterial({ color, roughness: 0.82 })
  const roof = new THREE.MeshStandardMaterial({ color: 0x373431, roughness: 0.9 })
  const body = box(w, 2.05, d, wall)
  body.position.y = 1.025
  g.add(body, gableRoof(w + 0.35, d + 0.42, 2.08, 2.72, roof))
  g.position.set(x, y, z)
  g.rotation.y = rotation
  scene.add(g)
  const cw = Math.abs(Math.cos(rotation)) * w + Math.abs(Math.sin(rotation)) * d
  const cd = Math.abs(Math.sin(rotation)) * w + Math.abs(Math.cos(rotation)) * d
  colliders.push({ min: new THREE.Vector2(x - cw / 2, z - cd / 2), max: new THREE.Vector2(x + cw / 2, z + cd / 2), y0: y, y1: y + 2.8 })
}

function addHutch(scene: THREE.Scene, name: 'Sigge' | 'Kurre', x: number, z: number, rotation = 0): HutchZone {
  const g = new THREE.Group()
  const frame = new THREE.MeshStandardMaterial({ color: name === 'Sigge' ? 0x735036 : 0x493426, roughness: 0.72 })
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xcbd2cd, roughness: 0.32, metalness: 0.35 })
  const shelf = new THREE.MeshStandardMaterial({ color: 0x926947, roughness: 0.8 })
  const dark = new THREE.MeshBasicMaterial({ color: 0x130d09 })
  const w = 2.8
  const d = 2.6
  const h = 1.65
  const rail = 0.075
  const wire = 0.014
  const add = (sx: number, sy: number, sz: number, px: number, py: number, pz: number, mat: THREE.Material = frame) => {
    const mesh = box(sx, sy, sz, mat)
    mesh.position.set(px, py, pz)
    g.add(mesh)
  }
  for (const px of [-w / 2, w / 2]) for (const pz of [-d / 2, d / 2]) add(rail, h, rail, px, h / 2, pz)
  for (const py of [rail / 2, h - rail / 2]) {
    for (const pz of [-d / 2, d / 2]) add(w + rail, rail, rail, 0, py, pz)
    for (const px of [-w / 2, w / 2]) add(rail, rail, d + rail, px, py, 0)
  }
  for (let i = 1; i < 7; i++) {
    const px = -w / 2 + (w * i) / 7
    add(wire, h - rail * 2, wire, px, h / 2, d / 2 + wire, wireMat)
    add(wire, h - rail * 2, wire, px, h / 2, -d / 2 - wire, wireMat)
  }
  for (let i = 1; i < 6; i++) {
    const pz = -d / 2 + (d * i) / 6
    add(wire, h - rail * 2, wire, w / 2 + wire, h / 2, pz, wireMat)
    add(wire, h - rail * 2, wire, -w / 2 - wire, h / 2, pz, wireMat)
  }
  for (let i = 1; i < 5; i++) {
    const py = rail + ((h - rail * 2) * i) / 5
    add(w - rail, wire, wire, 0, py, d / 2 + wire, wireMat)
    add(w - rail, wire, wire, 0, py, -d / 2 - wire, wireMat)
    add(wire, wire, d - rail, w / 2 + wire, py, 0, wireMat)
    add(wire, wire, d - rail, -w / 2 - wire, py, 0, wireMat)
  }
  const spec: HutchSpec = { w, d, doorX: -0.62, doorW: 0.72 }
  add(0.62, 0.43, 0.04, spec.doorX, 0.31, d / 2 + 0.035, dark)
  add(0.8, 0.055, 0.06, spec.doorX, 0.55, d / 2 + 0.06)
  add(0.055, 0.48, 0.06, spec.doorX - spec.doorW / 2, 0.31, d / 2 + 0.06)
  add(0.055, 0.48, 0.06, spec.doorX + spec.doorW / 2, 0.31, d / 2 + 0.06)
  add(0.82, 0.52, 0.68, -0.78, 0.26, -0.72, shelf)
  add(0.42, 0.3, 0.045, -0.78, 0.23, -0.36, dark)
  add(0.96, 0.08, 0.7, 0.5, 0.67, -0.65, shelf)
  const ramp: RampSpec = { x: 0.28, zBottom: 0.83, zTop: -0.32, w: 0.54, yBottom: 0.08, yTop: 0.67 }
  const run = ramp.zBottom - ramp.zTop
  const rise = ramp.yTop - ramp.yBottom
  const rampG = new THREE.Group()
  rampG.position.set(ramp.x, (ramp.yBottom + ramp.yTop) / 2, (ramp.zBottom + ramp.zTop) / 2)
  rampG.rotation.x = Math.atan2(rise, run)
  rampG.add(box(ramp.w, 0.045, Math.hypot(run, rise), shelf))
  g.add(rampG)
  const y = terrainHeightAt(x, z)
  g.position.set(x, y, z)
  g.rotation.y = rotation
  scene.add(g)
  // Burarna är axelparallella i spelkartan; rotation reserveras för små visuella finjusteringar.
  const center = new THREE.Vector3(x, y + 0.5, z)
  const aabb: Box3XZ = { min: new THREE.Vector2(x - w / 2, z - d / 2), max: new THREE.Vector2(x + w / 2, z + d / 2), y0: y, y1: y + h }
  const spawn = new THREE.Vector3(x + spec.doorX, terrainHeightAt(x + spec.doorX, z + d / 2 + 1.15), z + d / 2 + 1.15)
  return { name, center, aabb, ramp, spec, spawn }
}

function addForest(scene: THREE.Scene) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x65452f, roughness: 0.96 })
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x174d2a, roughness: 0.92 })
  const pineLightMat = new THREE.MeshStandardMaterial({ color: 0x27623a, roughness: 0.92 })
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.3, 7)
  const crownGeo = new THREE.ConeGeometry(1.12, 3.9, 9)
  const topGeo = new THREE.ConeGeometry(0.78, 2.9, 9)
  const positions: [number, number, number][] = []
  let seed = 8731
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const blocked = (x: number, z: number) => (
    (z > 13 && z < 49 && x > -6 && x < 28) ||
    (z > -44 && z < -17 && x > -21 && x < 17) ||
    Math.abs(z + 4) < 5 || Math.abs(z + 49) < 6
  )
  for (let i = 0; i < 170; i++) {
    let x = THREE.MathUtils.lerp(-47, 47, rnd())
    let z = THREE.MathUtils.lerp(-68, 68, rnd())
    const easternForest = x > 28
    const middleWood = z > 1 && z < 18
    const edgeWood = Math.abs(x) > 42 || Math.abs(z) > 63
    if ((!easternForest && !middleWood && !edgeWood) || blocked(x, z)) continue
    if (middleWood && x > 18) x += 6
    const scale = 0.82 + rnd() * 0.75
    positions.push([x, z, scale])
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length)
  const crowns = new THREE.InstancedMesh(crownGeo, pineMat, positions.length)
  const tops = new THREE.InstancedMesh(topGeo, pineLightMat, positions.length)
  const dummy = new THREE.Object3D()
  positions.forEach(([x, z, s], i) => {
    const y = terrainHeightAt(x, z)
    dummy.position.set(x, y + 1.15 * s, z)
    dummy.scale.setScalar(s)
    dummy.rotation.y = (i * 2.399) % (Math.PI * 2)
    dummy.updateMatrix()
    trunks.setMatrixAt(i, dummy.matrix)
    dummy.position.y = y + 3.25 * s
    dummy.updateMatrix()
    crowns.setMatrixAt(i, dummy.matrix)
    dummy.position.y = y + 4.7 * s
    dummy.scale.setScalar(s * 0.82)
    dummy.updateMatrix()
    tops.setMatrixAt(i, dummy.matrix)
  })
  trunks.castShadow = true
  crowns.castShadow = true
  scene.add(trunks, crowns, tops)
}

export function buildNeighborhood(scene: THREE.Scene): NeighborhoodResult {
  const colliders: Box3XZ[] = []
  const windowLights: THREE.PointLight[] = []
  const windowMaterials: THREE.MeshStandardMaterial[] = []
  addTerrain(scene)

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x555754, roughness: 0.98 })
  const gcAsphalt = new THREE.MeshStandardMaterial({ color: 0x666966, roughness: 0.98 })
  const gravel = new THREE.MeshStandardMaterial({ color: 0x9b927f, roughness: 1 })
  addRibbon(scene, [[-52, -50], [-25, -49], [3, -50], [26, -48], [52, -44]], 7.2, asphalt)
  addRibbon(scene, [[-52, -8], [-28, -7], [-4, -5], [22, -3], [52, 1]], 3.0, gcAsphalt)
  addRibbon(scene, [[-52, 49], [-32, 48], [-10, 49], [8, 52], [18, 48], [19, 39]], 6.2, asphalt)
  addRibbon(scene, [[18, 72], [18, 57], [18, 45]], 6.2, asphalt)
  addRibbon(scene, [[-14, -46], [-13, -38], [-10, -28]], 3.2, gravel)
  addRibbon(scene, [[17, -46], [15, -38], [12, -30]], 3.2, gravel)
  addRibbon(scene, [[17, 44], [17, 36], [18, 30]], 3.4, gravel)
  addRibbon(scene, [[-12, 47], [-8, 37], [-5, 29]], 3.2, gravel)

  addRedHouse(scene, colliders, windowLights, windowMaterials)
  addWhiteHouse(scene, colliders, windowLights, windowMaterials)

  // Husen och komplementbyggnaderna runt huvudtomterna, skalenligt grupperade från ortofotot.
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, -32, -59, 12, 8, 0xc49a70, 0x7d4e38, 0.04)
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, 27, -37, 12.5, 8.5, 0x5f686d, 0x292d30, 0.08)
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, -31, 25, 13, 9, 0xbcc0b9, 0x34393b, 0.03)
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, 36, 24, 11.5, 8.2, 0xa7aaa6, 0x303437, Math.PI / 2)
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, -30, 61, 13, 8.5, 0xd5c2a3, 0x4b3b32, 0.05)
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, 1, 64, 12, 8.5, 0xb7b8b0, 0x33383a, -0.04)
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, 32, 59, 11, 8, 0x9fa6a5, 0x303335, Math.PI / 2)

  addOutbuilding(scene, colliders, -18.5, -28, 5.4, 4.2, 0xd7d1c1)
  addOutbuilding(scene, colliders, -20, -19, 3.8, 3.2, 0x9a3329)
  addOutbuilding(scene, colliders, -16, 28, 4.2, 3.6, 0x777d7b)
  addOutbuilding(scene, colliders, 29, 31, 5.2, 4.2, 0x8f928c)
  addOutbuilding(scene, colliders, -39, 38, 5.3, 4.4, 0xa8a8a0)
  addOutbuilding(scene, colliders, 38, -32, 4.2, 3.6, 0x5e6261)

  // Tomthäckar: röda tomtens södra häck följer släntkrönet mot gc-vägen.
  addHedge(scene, -22, -18, 15, -16, 1.45, 0.95)
  addHedge(scene, -22, -46, -22, -18, 1.35)
  addHedge(scene, 16, -44, 16, -16, 1.4)
  addHedge(scene, -22, -46, 16, -44, 1.25)
  addHedge(scene, -15, 17, -15, 42, 1.15)
  addHedge(scene, -15, 17, 24, 16, 1.15)
  addHedge(scene, 24, 16, 24, 42, 1.15)
  addHedge(scene, -15, 42, 24, 42, 1.05)
  addHedge(scene, -46, 12, -18, 13, 1.35)

  const siggeHutch = addHutch(scene, 'Sigge', -5, -14.2)
  const kurreHutch = addHutch(scene, 'Kurre', -7.5, 27)
  addForest(scene)

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh)) {
      obj.castShadow = obj.castShadow || obj.position.y > 0.3
      obj.receiveShadow = true
    }
  })

  return {
    colliders,
    hutches: [siggeHutch, kurreHutch],
    spawns: { sigge: siggeHutch.spawn.clone(), kurre: kurreHutch.spawn.clone() },
    carrotPatches: [new THREE.Vector2(-10, -22), new THREE.Vector2(2, 22)],
    windowLights,
    windowMaterials,
  }
}
