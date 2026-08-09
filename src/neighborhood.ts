import * as THREE from 'three'

export type Box3XZ = { min: THREE.Vector2; max: THREE.Vector2; y0: number; y1: number }
export type RaisedPlatform = { aabb: Box3XZ; topY: number }
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

// Lokal ortofotoreferens från Lantmäteriets skärmbild 1000040391.jpg.
// Skalstock: x=169..540 motsvarar 50 m. Origo ligger på gc-vägens mittlinje.
export const ORTHO_METERS_PER_PIXEL = 50 / 371
export const ORTHO_ORIGIN_PX = { x: 350, y: 660 } as const
export const WORLD_HALF_X = 49
export const WORLD_HALF_Z = 82

type OrthoPixel = readonly [number, number]

function orthoPoint([pixelX, pixelY]: OrthoPixel): [number, number] {
  return [
    (pixelX - ORTHO_ORIGIN_PX.x) * ORTHO_METERS_PER_PIXEL,
    (pixelY - ORTHO_ORIGIN_PX.y) * ORTHO_METERS_PER_PIXEL,
  ]
}

function orthoLength(pixels: number): number {
  return pixels * ORTHO_METERS_PER_PIXEL
}

const GC_CENTERLINE_PX: OrthoPixel[] = [
  [0, 735], [120, 710], [260, 680], [390, 650], [540, 620], [709, 585],
]

function interpolatePolylineZAtX(points: OrthoPixel[], worldX: number): number {
  const worldPoints = points.map(orthoPoint)
  for (let i = 0; i < worldPoints.length - 1; i++) {
    const [x1, z1] = worldPoints[i]
    const [x2, z2] = worldPoints[i + 1]
    if (worldX >= Math.min(x1, x2) && worldX <= Math.max(x1, x2)) {
      const t = THREE.MathUtils.clamp((worldX - x1) / (x2 - x1), 0, 1)
      return THREE.MathUtils.lerp(z1, z2, t)
    }
  }
  return worldX < worldPoints[0][0] ? worldPoints[0][1] : worldPoints.at(-1)![1]
}

// Ortofotots norra del (röda huset) ligger högre än gc-vägen. Även vita
// tomten har en egen platå som sluttar söderut ner mot lokalgatan.
export function terrainHeightAt(x: number, z: number): number {
  const gcCenterZ = interpolatePolylineZAtX(GC_CENTERLINE_PX, x)
  const slopeTopZ = gcCenterZ - orthoLength(78)
  const slopeBottomZ = gcCenterZ - orthoLength(8)
  let redLotHeight = 0
  if (z <= slopeTopZ) redLotHeight = 2.6
  else if (z < slopeBottomZ) {
    const t = THREE.MathUtils.smoothstep(z, slopeTopZ, slopeBottomZ)
    redLotHeight = THREE.MathUtils.lerp(2.6, 0, t)
  }

  // Inmätt i ortofotots lokala pixlar. Det vita huset står på den plana
  // gården; från dess södra gräsyta faller marken till gatan vid y≈1075.
  const pixelX = x / ORTHO_METERS_PER_PIXEL + ORTHO_ORIGIN_PX.x
  const pixelY = z / ORTHO_METERS_PER_PIXEL + ORTHO_ORIGIN_PX.y
  const westEdge = THREE.MathUtils.smoothstep(pixelX, 270, 315)
  const eastEdge = 1 - THREE.MathUtils.smoothstep(pixelX, 485, 525)
  const northEdge = THREE.MathUtils.smoothstep(pixelY, 825, 875)
  const streetEdge = 1 - THREE.MathUtils.smoothstep(pixelY, 1025, 1075)
  const whiteLotHeight = 1.35 * westEdge * eastEdge * northEdge * streetEdge

  return Math.max(redLotHeight, whiteLotHeight)
}

type NeighborhoodResult = {
  colliders: Box3XZ[]
  platforms: RaisedPlatform[]
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
  // Tätare nät gör att den renderade terrängen följer samma höjdfunktion som
  // vägarna. Med det tidigare grova nätet kunde gröna trianglar skära igenom asfalt.
  const cols = 72
  const rows = 120
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

function addRibbon(scene: THREE.Scene, points: [number, number][], width: number, material: THREE.Material, lift = 0.1) {
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
      // Moturs sett ovanifrån: vägens framsida och normal ska peka uppåt.
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const road = new THREE.Mesh(geo, material)
  road.receiveShadow = true
  road.renderOrder = 2
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
  const windowRows = height > 4.2 ? [1.55, 3.75] : [height * 0.58]
  for (const windowY of windowRows) {
    addWindow(g, -w * 0.22, windowY, d / 2 + 0.045, Math.min(1.2, w * 0.18), 0.82, 1, trim, glass, windowLights)
    addWindow(g, w * 0.22, windowY, d / 2 + 0.045, Math.min(1.2, w * 0.18), 0.82, 1, trim, glass, windowLights)
  }
  g.position.set(x, ground, z)
  g.rotation.y = rotation
  scene.add(g)
  const cw = Math.abs(Math.cos(rotation)) * w + Math.abs(Math.sin(rotation)) * d
  const cd = Math.abs(Math.sin(rotation)) * w + Math.abs(Math.cos(rotation)) * d
  colliders.push({ min: new THREE.Vector2(x - cw / 2 - 0.2, z - cd / 2 - 0.2), max: new THREE.Vector2(x + cw / 2 + 0.2, z + cd / 2 + 0.2), y0: ground, y1: ground + height + 1.2 })
  return g
}

function addWhiteHouse(
  scene: THREE.Scene,
  colliders: Box3XZ[],
  platforms: RaisedPlatform[],
  windowLights: THREE.PointLight[],
  windowMaterials: THREE.MeshStandardMaterial[],
) {
  const [x, z] = orthoPoint([405, 1000])
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
  // Referensfasaden med fönster, altan och balkong vetter mot söder (+Z).
  g.rotation.y = 0
  scene.add(g)
  // Huskroppen blockerar bara sin egen rektangel; altanen är en separat plattform nedan.
  colliders.push({
    min: new THREE.Vector2(x - w / 2 - 0.25, z - d / 2 - 0.25),
    max: new THREE.Vector2(x + w / 2 + 0.25, z + d / 2 + 0.25),
    y0: ground,
    y1: ground + 7.2,
  })
  platforms.push({
    aabb: {
      min: new THREE.Vector2(x - porchW / 2, z + d / 2),
      max: new THREE.Vector2(x + porchW / 2, z + d / 2 + porchD),
      y0: ground,
      y1: ground + 0.18,
    },
    topY: ground + 0.18,
  })
}

function addRedHouse(scene: THREE.Scene, colliders: Box3XZ[], windowLights: THREE.PointLight[], windowMaterials: THREE.MeshStandardMaterial[]) {
  const [redX, redZ] = orthoPoint([372, 470])
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, redX, redZ, orthoLength(145), orthoLength(82), 0xb92d24, 0x463a32, -0.03, 2.8)
  // Grå grannvilla direkt öster om det röda huset, separat enligt ortofotot.
  const [greyX, greyZ] = orthoPoint([503, 430])
  addSimpleHouse(scene, colliders, windowLights, windowMaterials, greyX, greyZ, orthoLength(105), orthoLength(92), 0x777a75, 0x3f403d, -0.03, 2.65)
  const patioMat = new THREE.MeshStandardMaterial({ color: 0x9b8d78, roughness: 0.94 })
  const [patioX, patioZ] = orthoPoint([375, 525])
  const patio = box(orthoLength(62), 0.12, orthoLength(30), patioMat)
  patio.position.set(patioX, terrainHeightAt(patioX, patioZ) + 0.06, patioZ)
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
  // Skogspolygoner inmätta i ortofotots pixlar: mittbältet, östra skogen samt kartkanterna.
  const forestRegions: Array<readonly [number, number, number, number, number]> = [
    [0, 650, 709, 855, 115],
    [515, 520, 709, 1260, 92],
    [0, 430, 125, 940, 42],
    [0, 1170, 709, 1260, 38],
  ]
  const blockedPx = (pixelX: number, pixelY: number) => (
    // Röda respektive vita tomtens öppna gårdsytor.
    (pixelX > 105 && pixelX < 590 && pixelY > 335 && pixelY < 620) ||
    (pixelX > 235 && pixelX < 505 && pixelY > 850 && pixelY < 1170) ||
    // Gc-vägen ska vara tydligt avläsbar genom skogen.
    Math.abs(orthoPoint([pixelX, pixelY])[1] - interpolatePolylineZAtX(GC_CENTERLINE_PX, orthoPoint([pixelX, pixelY])[0])) < 4.6
  )
  for (const [minX, minY, maxX, maxY, count] of forestRegions) {
    for (let i = 0; i < count; i++) {
      const pixelX = THREE.MathUtils.lerp(minX, maxX, rnd())
      const pixelY = THREE.MathUtils.lerp(minY, maxY, rnd())
      if (blockedPx(pixelX, pixelY)) continue
      const [x, z] = orthoPoint([pixelX, pixelY])
      positions.push([x, z, 0.78 + rnd() * 0.8])
    }
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
  const platforms: RaisedPlatform[] = []
  const windowLights: THREE.PointLight[] = []
  const windowMaterials: THREE.MeshStandardMaterial[] = []
  addTerrain(scene)

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x4c504e, roughness: 0.98, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  const gcShoulder = new THREE.MeshStandardMaterial({ color: 0xa29986, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 })
  const gcAsphalt = new THREE.MeshStandardMaterial({ color: 0x525755, roughness: 0.98, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -5 })
  const gravel = new THREE.MeshStandardMaterial({ color: 0xa69c87, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 })
  const addMappedRibbon = (pixels: OrthoPixel[], widthPixels: number, material: THREE.Material, lift = 0.1) => {
    addRibbon(scene, pixels.map(orthoPoint), orthoLength(widthPixels), material, lift)
  }
  const addMappedHouse = (center: OrthoPixel, widthPx: number, depthPx: number, wall: number, roof: number, rotation = 0, height = 2.7) => {
    const [x, z] = orthoPoint(center)
    addSimpleHouse(scene, colliders, windowLights, windowMaterials, x, z, orthoLength(widthPx), orthoLength(depthPx), wall, roof, rotation, height)
  }
  const addMappedOutbuilding = (center: OrthoPixel, widthPx: number, depthPx: number, color: number, rotation = 0) => {
    const [x, z] = orthoPoint(center)
    addOutbuilding(scene, colliders, x, z, orthoLength(widthPx), orthoLength(depthPx), color, rotation)
  }
  const addMappedHedge = (from: OrthoPixel, to: OrthoPixel, height = 1.3, widthPx = 6) => {
    const [x1, z1] = orthoPoint(from)
    const [x2, z2] = orthoPoint(to)
    addHedge(scene, x1, z1, x2, z2, height, orthoLength(widthPx))
  }

  // Vägar och gångvägar följer inmätta mittlinjer i ortofotot.
  addMappedRibbon([[0, 352], [160, 360], [330, 348], [500, 326], [709, 305]], 48, asphalt, 0.12)
  // GC-vägen mellan tomterna får en grusad skuldra och fri sikt genom skogsbältet.
  addMappedRibbon(GC_CENTERLINE_PX, 29, gcShoulder, 0.09)
  addMappedRibbon(GC_CENTERLINE_PX, 19, gcAsphalt, 0.14)
  addMappedRibbon([[0, 1078], [100, 1076], [205, 1068], [286, 1067], [320, 1045], [322, 930]], 42, asphalt, 0.12)
  // Lokalgatan fortsätter österut söder om vita tomten och svänger upp vid tomtgränsen.
  addMappedRibbon([[0, 1138], [100, 1144], [205, 1130], [292, 1128], [380, 1138], [475, 1138], [520, 1100], [520, 1010]], 42, asphalt, 0.12)
  addMappedRibbon([[318, 930], [338, 885]], 35, asphalt)
  addMappedRibbon([[270, 352], [282, 405], [292, 455]], 23, gravel)
  addMappedRibbon([[445, 335], [455, 385], [468, 440]], 24, gravel)
  addMappedRibbon([[345, 1118], [365, 1060], [385, 1015]], 25, gravel)
  addMappedRibbon([[270, 1065], [275, 985], [285, 910]], 23, gravel)

  addRedHouse(scene, colliders, windowLights, windowMaterials)
  addWhiteHouse(scene, colliders, platforms, windowLights, windowMaterials)

  // Omgivande villor, inritade som ortofotorektanglar.
  addMappedHouse([193, 285], 116, 82, 0xc49a70, 0x7d4e38, 0.04)
  addMappedHouse([368, 230], 126, 78, 0xc8785e, 0x714739, -0.03)
  // Närmaste grannen väster om röda huset: ljusgrå villa i två plan.
  addMappedHouse([203, 515], 128, 112, 0xc8cdca, 0x34383a, 0.05, 5.25)
  addMappedHouse([663, 365], 88, 92, 0x666e72, 0x292d30, Math.PI / 2)
  addMappedHouse([85, 875], 128, 92, 0xbcc0b9, 0x34393b, 0.02)
  addMappedHouse([223, 900], 118, 92, 0xaeb3ae, 0x303538, 0.04)
  addMappedHouse([62, 1240], 105, 82, 0xd5c2a3, 0x4b3b32, 0.03)
  addMappedHouse([226, 1240], 112, 84, 0xb7b8b0, 0x33383a, -0.04)
  addMappedHouse([510, 1232], 92, 82, 0x9fa6a5, 0x303335, Math.PI / 2)

  // Friggebodar och uthus.
  addMappedOutbuilding([314, 580], 36, 31, 0xd7d1c1)
  // Ytan vid [492, 535] är morotslandet på röda gården, inte ett uthus.
  // Objektet vid [335, 872] är Kurres bur och ritas separat nedan, inte som uthus.
  addMappedOutbuilding([475, 935], 38, 34, 0x8f928c)
  addMappedOutbuilding([78, 1000], 42, 34, 0xa8a8a0)
  addMappedOutbuilding([625, 438], 36, 31, 0x5e6261)

  // Röda tomtens häck. Den södra linjen är släntkrön; gc-vägen ligger 8–10 m nedanför.
  addMappedHedge([250, 590], [535, 558], 1.45, 7)
  addMappedHedge([270, 385], [250, 590], 1.35, 7)
  addMappedHedge([545, 350], [535, 558], 1.4, 7)
  addMappedHedge([270, 385], [330, 375], 1.2, 6)
  addMappedHedge([470, 350], [545, 350], 1.2, 6)
  // Tomtavgränsningar runt vita huset och västra grannarna.
  addMappedHedge([250, 860], [485, 855], 1.1, 6)
  addMappedHedge([485, 855], [500, 1110], 1.1, 6)
  addMappedHedge([245, 855], [245, 1045], 1.1, 6)
  addMappedHedge([0, 820], [155, 825], 1.25, 7)

  // Burarnas centrum är inmätta; Sigges bur ligger nu tydligt innanför södra häcken.
  const [siggeX, siggeZ] = orthoPoint([370, 552])
  const [kurreX, kurreZ] = orthoPoint([340, 890])
  const siggeHutch = addHutch(scene, 'Sigge', siggeX, siggeZ)
  const kurreHutch = addHutch(scene, 'Kurre', kurreX, kurreZ)
  addForest(scene)

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh)) {
      obj.castShadow = obj.castShadow || obj.position.y > 0.3
      obj.receiveShadow = true
    }
  })

  return {
    colliders,
    platforms,
    hutches: [siggeHutch, kurreHutch],
    spawns: { sigge: siggeHutch.spawn.clone(), kurre: kurreHutch.spawn.clone() },
    carrotPatches: [
      // Röda gården, öster om uteplatsen.
      new THREE.Vector2(...orthoPoint([492, 535])),
      // Vita gården, på den fria remsan mellan huset och den östra häcken.
      new THREE.Vector2(...orthoPoint([474, 1015])),
    ],
    windowLights,
    windowMaterials,
  }
}
