// 心情 = 用户数据 { name, color }。默认内置 6 种，可增删、改色。
// 展示兜底顺序：用户自定义色 > 旧 moodKey 色点 > 中性灰，历史事件不受删词影响。
const DEFAULT_MOODS = [
  { name: '难过', color: '#a66e2e' },
  { name: '委屈', color: '#996b7a' },
  { name: '生气', color: '#a33b2d' },
  { name: '平静', color: '#4a7a6a' },
  { name: '开心', color: '#b08f3d' },
  { name: '感动', color: '#6b8fa3' }
]

// 低饱和取色板（心情圆点配色）
const MOOD_PALETTE = ['#a66e2e', '#a33b2d', '#996b7a', '#b08f3d', '#4a7a6a', '#6b8fa3', '#5b7a99', '#7a6b99', '#4a8a99', '#8e8e93']

const MOOD_NAME_LIMIT = 4
const MOOD_MAX = 12

// 情绪 → 旧样式类（app.wxss .dot-*），保留供历史兜底
const MOOD_KEYS = { 难过: 'sad', 委屈: 'wronged', 生气: 'angry', 平静: 'calm', 开心: 'happy', 感动: 'moved' }

function moodKey(name) {
  return MOOD_KEYS[name] || ''
}

function normalizeMoods(list) {
  const seen = new Set()
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    const name = String((item && item.name) || '').trim().slice(0, MOOD_NAME_LIMIT)
    const color = String((item && item.color) || '')
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(color) || seen.has(name)) continue
    seen.add(name)
    out.push({ name, color })
    if (out.length >= MOOD_MAX) break
  }
  return out
}

// 用户心情表；未配置/为空时回默认
function userMoods(data) {
  const list = normalizeMoods(data && (data.moods || data))
  return list.length ? list : DEFAULT_MOODS.map(item => ({ ...item }))
}

function moodOptions(moods, selectedMood = '') {
  return userMoods(moods).map(item => ({
    ...item,
    key: moodKey(item.name),
    selected: item.name === selectedMood
  }))
}

// 心情展示色：自定义 > 历史默认 > 灰
function moodColor(name, moods) {
  if (!name) return ''
  const found = userMoods(moods).find(item => item.name === name)
  if (found && found.color) return found.color
  const legacy = { sad: '#a66e2e', wronged: '#a66e2e', angry: '#a33b2d', calm: '#4a7a6a', happy: '#3b6d11', moved: '#3b6d11' }
  return legacy[moodKey(name)] || '#8e8e93'
}

// ===== 调色滑块用的 HSV ↔ HEX 互转（纯计算，无依赖） =====
// 明度下限：接近纯黑在白底圆点上会看不见
const VALUE_MIN = 15

function hexToHsv(hex) {
  const raw = String(hex || '').replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return { h: 24, s: 44, v: 65 }
  const n = parseInt(raw, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h: Math.round(h), s: Math.round((max ? d / max : 0) * 100), v: Math.round(max * 100) }
}

function hsvToHex(h, s, v) {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.min(100, Math.max(0, s)) / 100
  const val = Math.min(100, Math.max(0, v)) / 100
  const c = val * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - c
  const seg = Math.floor(hue / 60) % 6
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg]
  return '#' + rgb.map(item => Math.round((item + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

const clampValue = v => Math.min(100, Math.max(VALUE_MIN, v))
const HUE_BAR = 'linear-gradient(to right, #FF0000 0%, #FFFF00 16.6%, #00FF00 33.3%, #00FFFF 50%, #0000FF 66.6%, #FF00FF 83.3%, #FF0000 100%)'

// 三条滑块的渐变背景 + 色块位置，随 HSV 实时计算
function barStyles(hsv) {
  const { h, s, v } = hsv
  return {
    preview: hsvToHex(h, s, v),
    hueThumb: hsvToHex(h, 100, 100),
    satThumb: hsvToHex(h, s, 100),
    valThumb: hsvToHex(h, s, v),
    hueBar: HUE_BAR,
    satBar: `linear-gradient(to right, ${hsvToHex(h, 0, v)}, ${hsvToHex(h, 100, v)})`,
    valBar: `linear-gradient(to right, ${hsvToHex(h, s, 0)}, ${hsvToHex(h, s, 100)})`,
    huePos: `${(h / 360) * 100}%`,
    satPos: `${s}%`,
    valPos: `${((v - VALUE_MIN) / (100 - VALUE_MIN)) * 100}%`
  }
}

module.exports = {
  DEFAULT_MOODS, MOOD_PALETTE, MOOD_NAME_LIMIT, MOOD_MAX, VALUE_MIN,
  moodKey, normalizeMoods, userMoods, moodOptions, moodColor,
  hexToHsv, hsvToHex, clampValue, barStyles
}
