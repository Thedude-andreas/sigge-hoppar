import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const TICK_RATE = 30

const INNER = 17.5
const GROUND = 0
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
const CAT_SPD = 5.35
const CAT_TIMER_MIN = 13
const CAT_TIMER_MAX = 28
const CAT_SNIFF_TIME = 2.2
const CAT_SNIFF_DIST = 1.2
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

const houseAabb = {
  minX: -16.6,
  minZ: 4.0,
  maxX: -3.0,
  maxZ: 12.6,
}
const hutchCenter = { x: 5.2, z: 6.2 }
const hutchSpec = {
  w: 2.6,
  d: 2.5,
  doorX: -0.62,
  doorW: 0.68,
}
const hutchAabb = {
  minX: hutchCenter.x - hutchSpec.w / 2,
  minZ: hutchCenter.z - hutchSpec.d / 2,
  maxX: hutchCenter.x + hutchSpec.w / 2,
  maxZ: hutchCenter.z + hutchSpec.d / 2,
  y0: 0,
  y1: 1.55,
}
const rampSpec = {
  x: 0.28,
  zBottom: 0.78,
  zTop: -0.31,
  w: 0.52,
  yBottom: 0.08,
  yTop: 0.65,
}
const pickupKinds = ['light-armor', 'heavy-armor', 'energy-potion', 'speed-potion', 'shield-potion']
const fallbackColors = ['#f0d08b', '#d66b50', '#6bbf70', '#5da4d9', '#b887ff', '#f2c94c']

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      players: players.size,
      uptime: process.uptime(),
    }))
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not found')
})
const wss = new WebSocketServer({ server: httpServer })
const players = new Map()
let pickupId = 1
let lastTick = nowSeconds()

const world = createWorld()

function nowSeconds() {
  return Date.now() / 1000
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function randFloat(min, max) {
  return min + Math.random() * (max - min)
}

function distance2(x1, z1, x2, z2) {
  return Math.hypot(x1 - x2, z1 - z2)
}

function containsAabb(aabb, x, z) {
  return x >= aabb.minX && x <= aabb.maxX && z >= aabb.minZ && z <= aabb.maxZ
}

function resolveCircleAabb2(minX, minZ, maxX, maxZ, x, z, r) {
  const cx = clamp(x, minX, maxX)
  const cz = clamp(z, minZ, maxZ)
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

function createCarrotState() {
  const carrots = []
  const addCarrots = (center, rows, cols, skip) => {
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < cols.length; col++) {
        if (skip(row, col)) {
          continue
        }
        const offsetX = (row + col) % 2 === 0 ? -0.08 : 0.08
        const offsetZ = col % 2 === 0 ? 0.04 : -0.04
        carrots.push({
          x: center.x + cols[col] + offsetX,
          y: 0.08,
          z: center.z + rows[row] + offsetZ,
          picked: false,
          regrowLeft: 0,
          regrowTotal: 0,
        })
      }
    }
  }

  addCarrots({ x: 8, z: -6 }, [-1.85, -0.62, 0.62, 1.85], [-3.2, -1.6, 0, 1.6, 3.2], (row, col) => (
    (row === 0 && col === 4) || (row === 3 && col === 0)
  ))
  addCarrots({ x: -12.2, z: -9.2 }, [-1.45, -0.48, 0.48, 1.45], [-2.55, -1.25, 0, 1.25, 2.55], (row, col) => (
    (row === 1 && col === 0) || (row === 2 && col === 4)
  ))
  return carrots
}

function createPredator(kind) {
  return {
    kind,
    mode: 'hidden',
    x: 0,
    y: kind === 'fox' ? 0.25 : 0.22,
    z: kind === 'fox' ? 12 : -12,
    rotation: 0,
    next: kind === 'fox' ? 5 : 12,
    sniffLeft: 0,
    biteCooldown: 0,
    biteAnimLeft: 0,
    moving: false,
    sniffing: false,
    target: { x: 0, y: kind === 'fox' ? 0.25 : 0.22, z: 0 },
    leaveTarget: { x: 0, y: kind === 'fox' ? 0.25 : 0.22, z: 0 },
  }
}

function createWorld() {
  return {
    cycleClock: TWILIGHT_SECONDS * 0.45,
    survivedNights: 0,
    wasNight: false,
    carrots: createCarrotState(),
    pickups: [],
    pickupSpawnNext: 7,
    fox: createPredator('fox'),
    cat: createPredator('cat'),
  }
}

function resetWorld() {
  const fresh = createWorld()
  world.cycleClock = fresh.cycleClock
  world.survivedNights = fresh.survivedNights
  world.wasNight = fresh.wasNight
  world.carrots = fresh.carrots
  world.pickups = fresh.pickups
  world.pickupSpawnNext = fresh.pickupSpawnNext
  world.fox = fresh.fox
  world.cat = fresh.cat
  pickupId = 1
}

function sanitizeAlias(value) {
  const alias = String(value ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, 18)
  return alias || `Sigge ${players.size + 1}`
}

function sanitizeColor(value) {
  const color = String(value ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color.toLowerCase()
  }
  return fallbackColors[players.size % fallbackColors.length]
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function broadcast(payload) {
  for (const player of players.values()) {
    send(player.ws, payload)
  }
}

function spawnPosition() {
  const preferred = [
    { x: 0, z: 0 },
    { x: 1.1, z: 0.5 },
    { x: -1.1, z: -0.5 },
    { x: 0.8, z: -1.0 },
    { x: -0.8, z: 1.0 },
  ]
  for (const pos of preferred) {
    if ([...players.values()].every((player) => distance2(pos.x, pos.z, player.x, player.z) > 0.75)) {
      return pos
    }
  }
  return randomGardenPosition()
}

function createPlayer(ws, hello) {
  const id = crypto.randomUUID()
  const pos = spawnPosition()
  return {
    id,
    ws,
    alias: sanitizeAlias(hello.alias),
    color: sanitizeColor(hello.color),
    x: pos.x,
    y: PLAYER_H,
    z: pos.z,
    facing: 0,
    velY: 0,
    onGround: true,
    energy: START_ENERGY,
    armorCharges: 0,
    shieldPotionLeft: 0,
    speedPotionLeft: 0,
    gameOver: false,
    moving: false,
    input: {
      mobileMoving: false,
      moveX: 0,
      moveZ: 0,
      moveAmount: 0,
      turnInput: 0,
      jump: false,
    },
  }
}

function resetPlayer(player) {
  const pos = spawnPosition()
  player.x = pos.x
  player.y = PLAYER_H
  player.z = pos.z
  player.facing = 0
  player.velY = 0
  player.onGround = true
  player.energy = START_ENERGY
  player.armorCharges = 0
  player.shieldPotionLeft = 0
  player.speedPotionLeft = 0
  player.gameOver = false
  player.moving = false
  player.input.jump = false
}

function isNightNow() {
  return world.cycleClock >= DAY_SECONDS
}

function updateDayNight(dt) {
  const prevNight = world.wasNight
  world.cycleClock = (world.cycleClock + dt) % CYCLE_SECONDS
  const night = isNightNow()
  if (prevNight && !night) {
    world.survivedNights += 1
  }
  world.wasNight = night
}

function inSafeZone(x, y, z) {
  return containsAabb(hutchAabb, x, z) && y + PLAYER_H * 0.3 >= hutchAabb.y0 && y < hutchAabb.y1 + 0.2
}

function hutchFloorY(x, z) {
  if (!containsAabb(hutchAabb, x, z)) {
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
    const t = clamp((rampSpec.zBottom - localZ) / (rampSpec.zBottom - rampSpec.zTop), 0, 1)
    floorY = Math.max(floorY, lerp(rampSpec.yBottom, rampSpec.yTop, t))
  }

  return floorY
}

function inHutchDoor(localX) {
  return Math.abs(localX - hutchSpec.doorX) <= hutchSpec.doorW / 2
}

function resolveHutchWalls(prevX, prevZ, x, z) {
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
      x: hutchCenter.x + clamp(localX, -halfW + PLAYER_R, halfW - PLAYER_R),
      z: hutchCenter.z + clamp(localZ, -halfD + PLAYER_R, halfD - PLAYER_R),
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

function reduceEnergy(player, amount) {
  if (player.gameOver || amount <= 0) {
    return
  }
  player.energy = Math.max(0, player.energy - amount)
  if (player.energy <= 0) {
    player.energy = 0
    player.gameOver = true
    player.velY = 0
    player.moving = false
  }
}

function receiveBite(player, baseDamage) {
  if (player.shieldPotionLeft > 0) {
    reduceEnergy(player, baseDamage * 0.22)
    return
  }
  if (player.armorCharges > 0) {
    player.armorCharges -= 1
    reduceEnergy(player, baseDamage * 0.28)
    return
  }
  reduceEnergy(player, baseDamage)
}

function simulatePlayer(player, dt) {
  if (player.gameOver) {
    player.moving = false
    return
  }

  reduceEnergy(player, ENERGY_DRAIN_PER_SEC * dt)
  if (player.gameOver) {
    return
  }

  player.shieldPotionLeft = Math.max(0, player.shieldPotionLeft - dt)
  player.speedPotionLeft = Math.max(0, player.speedPotionLeft - dt)

  const input = player.input
  let moveX = 0
  let moveZ = 0
  let moveAmount = clamp(Number(input.moveAmount) || 0, -1, 1)

  if (input.mobileMoving) {
    moveX = clamp(Number(input.moveX) || 0, -1, 1)
    moveZ = clamp(Number(input.moveZ) || 0, -1, 1)
    const len = Math.hypot(moveX, moveZ)
    if (len > 0.001) {
      moveX /= len
      moveZ /= len
      moveAmount = clamp(Math.abs(moveAmount), 0, 1)
      player.facing = Math.atan2(moveX, moveZ)
    }
  } else {
    const turnInput = clamp(Number(input.turnInput) || 0, -1, 1)
    if (turnInput !== 0) {
      player.facing += turnInput * 2.2 * dt
    }
    moveX = Math.sin(player.facing)
    moveZ = Math.cos(player.facing)
  }

  const boost = (1 + player.energy * 0.0008) * (player.speedPotionLeft > 0 ? 1.22 : 1)
  const speed = moveAmount * MOVE * dt * boost
  const dx = moveX * speed
  const dz = moveZ * speed

  player.velY -= GRAVITY * dt
  if (player.onGround && input.jump) {
    player.velY = JUMP_V
    player.onGround = false
  }
  input.jump = false

  let nx = player.x + dx
  let ny = Math.max(0, player.y + player.velY * dt)
  let nz = player.z + dz

  nx = clamp(nx, -INNER + PLAYER_R, INNER - PLAYER_R)
  nz = clamp(nz, -INNER + PLAYER_R, INNER - PLAYER_R)

  const prevX = player.x
  const prevZ = player.z
  const hOut = resolveCircleAabb2(
    houseAabb.minX,
    houseAabb.minZ,
    houseAabb.maxX,
    houseAabb.maxZ,
    nx,
    nz,
    PLAYER_R,
  )
  nx = hOut.x
  nz = hOut.z

  const hutchOut = resolveHutchWalls(prevX, prevZ, nx, nz)
  nx = hutchOut.x
  nz = hutchOut.z

  const supportY = hutchFloorY(nx, nz)
  const groundedY = supportY + PLAYER_H
  if (ny <= groundedY + 0.14) {
    ny = groundedY
    player.velY = 0
    player.onGround = true
  } else {
    player.onGround = false
  }

  player.x = nx
  player.y = ny
  player.z = nz
  player.moving = player.onGround && Math.abs(moveAmount) > 0.01
}

function randomGardenPosition() {
  for (let i = 0; i < 40; i++) {
    const x = randFloat(-INNER + 1.2, INNER - 1.2)
    const z = randFloat(-INNER + 1.2, INNER - 1.2)
    const nearHouse = containsAabb(houseAabb, x, z)
    const nearHutch = containsAabb({
      minX: hutchAabb.minX - 1.3,
      minZ: hutchAabb.minZ - 1.3,
      maxX: hutchAabb.maxX + 1.3,
      maxZ: hutchAabb.maxZ + 1.3,
    }, x, z)
    const nearPlayer = [...players.values()].some((player) => distance2(x, z, player.x, player.z) <= 3)
    if (!nearHouse && !nearHutch && !nearPlayer) {
      return { x, y: 0.24, z }
    }
  }
  return { x: 0, y: 0.24, z: -10 }
}

function pickupLabel(kind) {
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

function applyPickup(player, kind) {
  if (kind === 'light-armor') {
    player.armorCharges = Math.min(ARMOR_MAX, player.armorCharges + 1)
  } else if (kind === 'heavy-armor') {
    player.armorCharges = Math.min(ARMOR_MAX, player.armorCharges + 2)
  } else if (kind === 'energy-potion') {
    player.energy = Math.min(ENERGY_MAX, player.energy + 32)
  } else if (kind === 'speed-potion') {
    player.speedPotionLeft = Math.max(player.speedPotionLeft, SPEED_POTION_SECONDS)
  } else {
    player.shieldPotionLeft = Math.max(player.shieldPotionLeft, SHIELD_POTION_SECONDS)
  }
  send(player.ws, {
    type: 'pickup',
    kind,
    label: pickupLabel(kind),
  })
}

function spawnPickup() {
  if (world.pickups.length >= PICKUP_MAX) {
    return
  }
  const weights = isNightNow() ? [3, 2, 2, 2, 3] : [2, 1, 3, 2, 1]
  const total = weights.reduce((sum, value) => sum + value, 0)
  let roll = Math.random() * total
  let kind = pickupKinds[0]
  for (let i = 0; i < pickupKinds.length; i++) {
    roll -= weights[i]
    if (roll <= 0) {
      kind = pickupKinds[i]
      break
    }
  }
  const position = randomGardenPosition()
  world.pickups.push({
    id: `pickup-${pickupId++}`,
    kind,
    x: position.x,
    y: position.y,
    z: position.z,
    ttl: 42,
  })
}

function updateCarrots(dt) {
  for (const carrot of world.carrots) {
    if (carrot.picked) {
      carrot.regrowLeft = Math.max(0, carrot.regrowLeft - dt)
      if (carrot.regrowLeft <= 0) {
        carrot.picked = false
        carrot.regrowLeft = 0
        carrot.regrowTotal = 0
      }
      continue
    }

    for (const player of players.values()) {
      if (player.gameOver) {
        continue
      }
      if (Math.hypot(carrot.x - player.x, carrot.y - player.y, carrot.z - player.z) < CARROT_PICK) {
        carrot.picked = true
        carrot.regrowTotal = randFloat(CARROT_REGROW_MIN, CARROT_REGROW_MAX)
        carrot.regrowLeft = carrot.regrowTotal
        player.energy = Math.min(ENERGY_MAX, player.energy + ENERGY_PER_CARROT)
        break
      }
    }
  }
}

function updatePickups(dt) {
  world.pickupSpawnNext -= dt
  if (world.pickupSpawnNext <= 0) {
    spawnPickup()
    world.pickupSpawnNext = randFloat(PICKUP_SPAWN_MIN, PICKUP_SPAWN_MAX)
  }

  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const pickup = world.pickups[i]
    pickup.ttl -= dt
    let consumed = false
    for (const player of players.values()) {
      if (player.gameOver) {
        continue
      }
      if (distance2(pickup.x, pickup.z, player.x, player.z) < PICKUP_PICK) {
        applyPickup(player, pickup.kind)
        consumed = true
        break
      }
    }
    if (consumed || pickup.ttl <= 0) {
      world.pickups.splice(i, 1)
    }
  }
}

function activeUnsafePlayers() {
  return [...players.values()].filter((player) => (
    !player.gameOver && !inSafeZone(player.x, player.y, player.z)
  ))
}

function nearestUnsafePlayer(x, z) {
  let nearest = null
  let nearestDist = Infinity
  for (const player of activeUnsafePlayers()) {
    const dist = distance2(x, z, player.x, player.z)
    if (dist < nearestDist) {
      nearest = player
      nearestDist = dist
    }
  }
  return nearest
}

function spawnPredator(predator) {
  const ang = Math.random() * Math.PI * 2
  const r = INNER - (predator.kind === 'fox' ? 1.2 : 1.0)
  predator.x = Math.cos(ang) * r
  predator.y = predator.kind === 'fox' ? 0.25 : 0.22
  predator.z = Math.sin(ang) * r
  predator.rotation = 0
  predator.mode = 'chase'
}

function hidePredator(predator) {
  predator.mode = 'hidden'
  predator.moving = false
  predator.sniffing = false
  predator.next = randFloat(
    predator.kind === 'fox' ? FOX_TIMER_MIN : CAT_TIMER_MIN,
    predator.kind === 'fox' ? FOX_TIMER_MAX : CAT_TIMER_MAX,
  )
}

function movePredatorToward(predator, target, speed, dt) {
  const dx = target.x - predator.x
  const dz = target.z - predator.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.01) {
    return dist
  }
  const stepLen = Math.min(dist, speed * dt)
  const nx = dx / dist
  const nz = dz / dist
  predator.x += nx * stepLen
  predator.z += nz * stepLen
  predator.rotation = Math.atan2(nx, nz)
  return dist - stepLen
}

function startPredatorSniff(predator) {
  let sideX = predator.x - hutchCenter.x
  let sideZ = predator.z - hutchCenter.z
  const len = Math.hypot(sideX, sideZ)
  if (len < 0.01) {
    sideX = 0
    sideZ = -1
  } else {
    sideX /= len
    sideZ /= len
  }
  const sniffDist = predator.kind === 'fox' ? FOX_SNIFF_DIST : CAT_SNIFF_DIST
  predator.target = {
    x: hutchCenter.x + sideX * sniffDist,
    y: predator.y,
    z: hutchCenter.z + sideZ * sniffDist,
  }
  predator.leaveTarget = {
    x: hutchCenter.x + sideX * (INNER + 8),
    y: predator.y,
    z: hutchCenter.z + sideZ * (INNER + 8),
  }
  predator.sniffLeft = predator.kind === 'fox' ? FOX_SNIFF_TIME : CAT_SNIFF_TIME
  predator.mode = 'sniff'
}

function updatePredator(predator, dt) {
  predator.moving = false
  predator.sniffing = false
  predator.biteCooldown = Math.max(0, predator.biteCooldown - dt)
  predator.biteAnimLeft = Math.max(0, predator.biteAnimLeft - dt)

  if (predator.mode === 'hidden') {
    const target = nearestUnsafePlayer(predator.x, predator.z)
    if (!target) {
      return
    }
    predator.next -= dt * (isNightNow() ? predator.kind === 'fox' ? 1.25 : 1.55 : predator.kind === 'fox' ? 0.75 : 0.55)
    if (predator.next <= 0) {
      spawnPredator(predator)
    }
    return
  }

  if (predator.mode === 'chase') {
    const targetPlayer = nearestUnsafePlayer(predator.x, predator.z)
    if (!targetPlayer) {
      startPredatorSniff(predator)
      return
    }
    let awayX = predator.x - targetPlayer.x
    let awayZ = predator.z - targetPlayer.z
    const len = Math.hypot(awayX, awayZ)
    if (len < 0.001) {
      awayX = Math.sin(predator.rotation)
      awayZ = Math.cos(predator.rotation)
    } else {
      awayX /= len
      awayZ /= len
    }
    const attackDist = predator.kind === 'fox' ? FOX_ATTACK_DIST : CAT_ATTACK_DIST
    const target = {
      x: targetPlayer.x + awayX * attackDist,
      y: predator.y,
      z: targetPlayer.z + awayZ * attackDist,
    }
    const speed = predator.kind === 'fox'
      ? FOX_SPD * (0.9 + (100 - targetPlayer.energy) * 0.00035)
      : CAT_SPD * (isNightNow() ? 1.08 : 0.92)
    predator.moving = movePredatorToward(predator, target, speed, dt) > (predator.kind === 'fox' ? 0.08 : 0.07)
    predator.x = clamp(predator.x, -INNER + 0.4, INNER - 0.4)
    predator.z = clamp(predator.z, -INNER + 0.4, INNER - 0.4)
    predator.rotation = Math.atan2(targetPlayer.x - predator.x, targetPlayer.z - predator.z)
    const biteDist = predator.kind === 'fox' ? FOX_BITE : CAT_BITE
    if (predator.biteCooldown <= 0 && distance2(predator.x, predator.z, targetPlayer.x, targetPlayer.z) <= biteDist) {
      receiveBite(targetPlayer, predator.kind === 'fox' ? FOX_BITE_DAMAGE : CAT_BITE_DAMAGE)
      predator.biteCooldown = predator.kind === 'fox' ? FOX_BITE_COOLDOWN : CAT_BITE_COOLDOWN
      predator.biteAnimLeft = predator.kind === 'fox' ? FOX_BITE_ANIM_TIME : CAT_BITE_ANIM_TIME
    }
    return
  }

  if (predator.mode === 'sniff') {
    const remaining = movePredatorToward(predator, predator.target, (predator.kind === 'fox' ? FOX_SPD * 0.55 : CAT_SPD * 0.58), dt)
    predator.moving = remaining > (predator.kind === 'fox' ? 0.08 : 0.07)
    if (remaining < (predator.kind === 'fox' ? 0.08 : 0.07)) {
      predator.sniffing = true
      predator.sniffLeft -= dt
      predator.rotation += Math.sin(nowSeconds() * (predator.kind === 'fox' ? 14 : 16)) * dt * (predator.kind === 'fox' ? 0.9 : 1.1)
      if (predator.sniffLeft <= 0) {
        predator.mode = 'leave'
      }
    }
    return
  }

  if (predator.mode === 'leave') {
    const remaining = movePredatorToward(predator, predator.leaveTarget, (predator.kind === 'fox' ? FOX_SPD * 0.8 : CAT_SPD * 0.85), dt)
    predator.moving = true
    if (remaining < 0.2 || Math.abs(predator.x) > INNER || Math.abs(predator.z) > INNER) {
      hidePredator(predator)
    }
  }
}

function carrotSnapshot(carrot) {
  const growth = carrot.picked && carrot.regrowTotal > 0
    ? clamp(1 - carrot.regrowLeft / carrot.regrowTotal, 0.06, 1)
    : 1
  return {
    picked: carrot.picked,
    growth,
  }
}

function playerSnapshot(player) {
  return {
    id: player.id,
    alias: player.alias,
    color: player.color,
    x: player.x,
    y: player.y,
    z: player.z,
    facing: player.facing,
    energy: player.energy,
    armorCharges: player.armorCharges,
    shieldPotionLeft: player.shieldPotionLeft,
    speedPotionLeft: player.speedPotionLeft,
    gameOver: player.gameOver,
    onGround: player.onGround,
    moving: player.moving,
  }
}

function predatorSnapshot(predator) {
  return {
    mode: predator.mode,
    x: predator.x,
    y: predator.y,
    z: predator.z,
    rotation: predator.rotation,
    moving: predator.moving,
    sniffing: predator.sniffing,
    biteAnimLeft: predator.biteAnimLeft,
  }
}

function snapshot() {
  return {
    type: 'snapshot',
    serverTime: nowSeconds(),
    world: {
      cycleClock: world.cycleClock,
      survivedNights: world.survivedNights,
    },
    players: [...players.values()].map(playerSnapshot),
    carrots: world.carrots.map(carrotSnapshot),
    pickups: world.pickups.map((pickup) => ({
      id: pickup.id,
      kind: pickup.kind,
      x: pickup.x,
      y: pickup.y,
      z: pickup.z,
      ttl: pickup.ttl,
    })),
    predators: {
      fox: predatorSnapshot(world.fox),
      cat: predatorSnapshot(world.cat),
    },
  }
}

function tick() {
  const current = nowSeconds()
  const dt = Math.min(0.1, Math.max(0.001, current - lastTick))
  lastTick = current

  if (players.size === 0) {
    return
  }

  updateDayNight(dt)
  for (const player of players.values()) {
    simulatePlayer(player, dt)
  }
  updateCarrots(dt)
  updatePickups(dt)
  updatePredator(world.fox, dt)
  updatePredator(world.cat, dt)
  broadcast(snapshot())
}

wss.on('connection', (ws) => {
  let player = null

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      send(ws, { type: 'error', message: 'Ogiltigt meddelande.' })
      return
    }

    if (message.type === 'hello') {
      if (player) {
        return
      }
      player = createPlayer(ws, message)
      players.set(player.id, player)
      send(ws, { type: 'welcome', id: player.id })
      broadcast({ type: 'notice', kind: 'join', alias: player.alias })
      return
    }

    if (!player) {
      return
    }

    if (message.type === 'input') {
      player.input.mobileMoving = Boolean(message.mobileMoving)
      player.input.moveX = clamp(Number(message.moveX) || 0, -1, 1)
      player.input.moveZ = clamp(Number(message.moveZ) || 0, -1, 1)
      player.input.moveAmount = clamp(Number(message.moveAmount) || 0, -1, 1)
      player.input.turnInput = clamp(Number(message.turnInput) || 0, -1, 1)
      player.input.jump = player.input.jump || Boolean(message.jump)
      return
    }

    if (message.type === 'restart') {
      resetPlayer(player)
    }
  })

  ws.on('close', () => {
    if (!player) {
      return
    }
    players.delete(player.id)
    broadcast({ type: 'notice', kind: 'leave', alias: player.alias })
    if (players.size === 0) {
      resetWorld()
    }
  })
})

setInterval(tick, 1000 / TICK_RATE)

httpServer.listen(PORT, HOST, () => {
  console.log(`Sigge multiplayer server lyssnar på ws://${HOST}:${PORT}`)
})
