/**
 * 按事件总数从内向外排列；同圈等角分散，圈间错位避让。
 * 坐标统一指头像中心，头像、名字、中心的「我」都参与碰撞检测。
 */
const CANVAS = { w: 670, h: 720 }
const VIEW = CANVAS
const CENTER = { x: 335, y: 350 }
const SCALE = 1
const RING_R = [130, 220, 290]
const RING_PHASE = [0, 0, 0]
const AVATAR = 76
const CAP = [4, 4, 4]
const NAME_MAX_W = 144
const NAME_H = 24
const GAP = 6
const MIN_GAP = 12
const RING_NAME = ['内圈', '中圈', '外圈']
const RING_START = [180, 270, 10]

function recordCount(person) {
  const count = Number(person.count)
  return Number.isFinite(count) ? Math.max(0, count) : 0
}

function comparePeople(a, b) {
  const diff = recordCount(b) - recordCount(a)
  if (diff) return diff
  // 用持久化 ID 固定同记录数的次序，卡片拖动排序不影响图的位置。
  const aid = String(a.id), bid = String(b.id)
  return aid < bid ? -1 : aid > bid ? 1 : 0
}

function ringQuota(n) {
  const total = Math.min(Math.max(0, n), CAP.reduce((sum, cap) => sum + cap, 0))
  const inner = Math.min(CAP[0], Math.ceil(total / 3))
  const mid = Math.min(CAP[1], Math.ceil((total - inner) / 2))
  return [inner, mid, total - inner - mid]
}

function assignRings(sorted) {
  const list = Array.isArray(sorted) ? sorted : []
  const [inner, mid, outer] = ringQuota(list.length)
  // 同记录数可以占相邻圈，避免一圈拥挤而其他圈空着。
  return [list.slice(0, inner), list.slice(inner, inner + mid), list.slice(inner + mid, inner + mid + outer)]
}

function startAngle(n, ringIndex = 0, phase = 0) {
  const base = (RING_START[ringIndex] || 0) * Math.PI / 180
  return base + (n > 0 && n % 2 === 0 ? Math.PI / n : 0) + phase
}

function place(angle, radius, cx = CENTER.x, cy = CENTER.y) {
  return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) }
}

function ringLayout(list, ringIndex, phase = 0, slots = list.length) {
  const step = 2 * Math.PI / slots
  const a0 = startAngle(slots, ringIndex, phase)
  return list.map((person, i) => ({
    ...person, ...place(a0 + Math.floor(i * slots / list.length) * step, RING_R[ringIndex]), size: AVATAR, ring: ringIndex
  }))
}

// ── 精确碰撞判定 ──

/** 名字矩形：位于头像正下方 */
function nameRect(star) {
  return {
    x: star.x - NAME_MAX_W / 2,
    y: star.y + star.size / 2 + GAP,
    w: NAME_MAX_W,
    h: NAME_H
  }
}

/** 圆与矩形是否相交 */
function circleHitsRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w))
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h))
  return Math.hypot(cx - nx, cy - ny) < r
}

function rectsHit(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

/** 两个星点是否相撞（头像圆 vs 头像圆、名字矩形、头像 vs 对方名字） */
function collides(a, b) {
  // 1. 头像圆 vs 头像圆
  if (Math.hypot(a.x - b.x, a.y - b.y) < (a.size + b.size) / 2 + MIN_GAP) return true
  const ra = nameRect(a)
  const rb = nameRect(b)
  // 2. 名字矩形 vs 名字矩形
  if (rectsHit(ra, rb)) return true
  // 3. A 的头像 vs B 的名字
  if (circleHitsRect(a.x, a.y, a.size / 2, rb)) return true
  // 4. B 的头像 vs A 的名字
  if (circleHitsRect(b.x, b.y, b.size / 2, ra)) return true
  return false
}

/** 名字也必须完整落在画布内，避免 overflow:hidden 裁掉文字。 */
function inCanvas(star) {
  const box = extentOf(star)
  return box.left >= 8 && box.right <= CANVAS.w - 8 && box.top >= 8 && box.bottom <= CANVAS.h - 8
}

function extentOf(star) {
  const r = nameRect(star)
  return { left: r.x, right: r.x + r.w, top: star.y - star.size / 2, bottom: r.y + r.h }
}

function clearsCenter(star) {
  // 中心半径 42 + 光晕 10，另留 6rpx 空隙。
  return Math.hypot(star.x - CENTER.x, star.y - CENTER.y) >= star.size / 2 + 58 &&
    !circleHitsRect(CENTER.x, CENTER.y, 58, nameRect(star))
}

function allClear(stars) {
  for (let i = 0; i < stars.length; i++) {
    if (!inCanvas(stars[i]) || !clearsCenter(stars[i])) return false
    for (let j = i + 1; j < stars.length; j++) {
      if (collides(stars[i], stars[j])) return false
    }
  }
  return true
}

function onItsRing(star) {
  return Math.abs(Math.hypot(star.x - CENTER.x, star.y - CENTER.y) - RING_R[star.ring]) < 1
}

// 布局只依赖各圈人数，按人数缓存几何结果，搜索和刷新无需重复求解。
const layoutCache = new Map()
function solve(groups) {
  const key = groups.map(g => g.length).join(',')
  if (layoutCache.has(key)) return layoutCache.get(key)
  const candidates = groups.map((group, ri) => {
    if (!group.length) return [{ stars: [], phase: 0 }]
    const result = []
    for (let step = 0; step < 72; step++) {
      const phase = step * Math.PI / 36
      const stars = ringLayout(group, ri, phase)
      if (allClear(stars)) result.push({ stars, phase })
    }
    return result
  })
  function find(ri, placed, phases) {
    if (ri === 3) return phases
    for (const candidate of candidates[ri]) {
      if (candidate.stars.some(star => placed.some(other => collides(star, other)))) continue
      const result = find(ri + 1, placed.concat(candidate.stars), phases.concat(candidate.phase))
      if (result) return result
    }
    return null
  }
  const phases = find(0, [], [])
  layoutCache.set(key, phases)
  return phases
}

function build(people) {
  const sorted = (Array.isArray(people) ? people : [])
    .filter(p => p && typeof p === 'object' && !Array.isArray(p))
    .slice().sort(comparePeople)
  let stars = [], phases = [0, 0, 0]
  // 只在画布确实容纳不下时减少末位人物，保留原尺寸与远近顺序。
  for (let keep = Math.min(sorted.length, CAP.reduce((sum, cap) => sum + cap, 0)); keep > 0; keep--) {
    const groups = assignRings(sorted.slice(0, keep))
    let solved = solve(groups)
    let slots = groups.map(group => group.length)
    if (!solved) {
      // 某些人数等角排列恰好互相遮挡，先借用完整十二席布局的空位。
      // 保留同圈和远近次序，不因少一人就退化成隐藏多人。
      const fullGroups = CAP.map(cap => Array.from({ length: cap }, () => ({})))
      solved = solve(fullGroups)
      slots = CAP
    }
    if (!solved) continue
    phases = solved
    stars = groups.flatMap((group, ri) => ringLayout(group, ri, phases[ri], slots[ri]))
    break
  }
  return {
    stars, phases, size: AVATAR,
    rings: RING_R.map((r, i) => ({
      r: r * 2, cx: CENTER.x, cy: CENTER.y, name: RING_NAME[i],
      count: stars.filter(s => s.ring === i).length, size: AVATAR
    })),
    hidden: sorted.length - stars.length,
    center: { ...CENTER }, view: VIEW, canvas: CANVAS, scale: SCALE
  }
}

/**
 * 初始 scroll-left：让画布水平居中在视口里。
 * 注意小程序 scroll-left 单位是 px，而视口/画布尺寸是 rpx，
 * 调用方必须先用 SelectorQuery 实测像素尺寸再换算。
 * 返回整数，避免半像素导致设备上出现 1px 抖动。
 */
function initialScrollLeft(canvasWidthPx, viewWidthPx) {
  return Math.max(0, Math.round((canvasWidthPx - viewWidthPx) / 2))
}

module.exports = {
  build,
  comparePeople,
  assignRings,
  ringQuota,
  startAngle,
  place,
  extentOf,
  nameRect,
  collides,
  inCanvas,
  allClear,
  onItsRing,
  ringLayout,
  initialScrollLeft,
  VIEW, CANVAS, CENTER, SCALE, RING_R, RING_PHASE, AVATAR, CAP, RING_NAME, NAME_MAX_W, NAME_H, GAP, MIN_GAP
}
