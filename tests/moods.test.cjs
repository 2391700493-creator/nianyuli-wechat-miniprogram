const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_MOODS, MOOD_PALETTE, MOOD_NAME_LIMIT, MOOD_MAX, moodKey, normalizeMoods, userMoods, moodOptions, moodColor, hexToHsv, hsvToHex, clampValue, barStyles, VALUE_MIN } = require('../utils/moods')

test('normalizeMoods 去重、截断、清洗非法项', () => {
  const list = normalizeMoods([
    { name: ' 开心 ', color: '#B08F3D' },
    { name: '开心', color: '#4a7a6a' },
    { name: '', color: '#4a7a6a' },
    { name: '坏色', color: 'red' },
    { name: '无色' },
    '不是对象',
    { name: '破防', color: '#7a6b99' }
  ])
  assert.deepEqual(list, [{ name: '开心', color: '#B08F3D' }, { name: '破防', color: '#7a6b99' }])
  assert.equal(normalizeMoods(Array.from({ length: 20 }, (_, i) => ({ name: `心情${i}`, color: '#4a7a6a' }))).length, 12)
  assert.deepEqual(normalizeMoods(null), [])
})

test('userMoods 未配置时回默认表，moodOptions 标记选中', () => {
  assert.deepEqual(userMoods(undefined), DEFAULT_MOODS)
  assert.deepEqual(userMoods({ moods: [] }), DEFAULT_MOODS)
  const options = moodOptions([{ name: '平静', color: '#4a7a6a' }], '平静')
  assert.deepEqual(options, [{ name: '平静', color: '#4a7a6a', key: 'calm', selected: true }])
  assert.equal(moodOptions(undefined, '开心').find(item => item.name === '开心').selected, true)
})

test('moodColor 兜底：自定义 > 历史默认 > 灰，空心情返回空串', () => {
  assert.equal(moodColor('破防', { moods: [{ name: '破防', color: '#7a6b99' }] }), '#7a6b99')
  assert.equal(moodColor('生气', undefined), '#a33b2d')
  assert.equal(moodColor('难过', { moods: [{ name: '平静', color: '#4a7a6a' }] }), '#a66e2e')
  assert.equal(moodColor('不存在的心情', undefined), '#8e8e93')
  assert.equal(moodColor('', undefined), '')
})

test('调色板与默认心情均使用合法色值', () => {
  const hex = /^#[0-9a-fA-F]{6}$/
  MOOD_PALETTE.forEach(color => assert.match(color, hex))
  DEFAULT_MOODS.forEach(item => assert.match(item.color, hex))
  assert.equal(moodKey('开心'), 'happy')
  assert.equal(moodKey('自创'), '')
})

test('hexToHsv / hsvToHex 往返转换：单通道误差不超过 2', () => {
  const colors = [...MOOD_PALETTE, ...DEFAULT_MOODS.map(item => item.color), '#ff0000', '#00ff00', '#0000ff', '#123456', '#abcdef']
  colors.forEach(color => {
    const hsv = hexToHsv(color)
    const back = hsvToHex(hsv.h, hsv.s, hsv.v)
    const a = parseInt(color.slice(1), 16)
    const b = parseInt(back.slice(1), 16)
    for (let i = 0; i < 3; i += 1) {
      const diff = Math.abs(((a >> (16 - i * 8)) & 255) - ((b >> (16 - i * 8)) & 255))
      assert.ok(diff <= 2, `${color} -> ${back} 第 ${i} 通道差 ${diff}`)
    }
  })
  // 非法输入兜底，不抛错
  assert.deepEqual(hexToHsv('zzz'), { h: 24, s: 44, v: 65 })
  assert.deepEqual(hexToHsv(''), { h: 24, s: 44, v: 65 })
  // 纯红纯绿纯蓝的色相应落在主色区间
  assert.equal(hexToHsv('#ff0000').h, 0)
  assert.equal(hexToHsv('#00ff00').h, 120)
  assert.equal(hexToHsv('#0000ff').h, 240)
})

test('hsvToHex 越界输入被夹紧在合法范围', () => {
  const hex = /^#[0-9a-fA-F]{6}$/
  assert.match(hsvToHex(-30, 150, 200), hex)
  assert.match(hsvToHex(400, -10, -10), hex)
  assert.equal(hsvToHex(0, 100, 100), '#FF0000')
  assert.equal(hsvToHex(0, 0, 100), '#FFFFFF')
  // 明暗滑块下限，避免纯黑在白底圆点上不可见
  assert.equal(clampValue(0), VALUE_MIN)
  assert.equal(clampValue(5), VALUE_MIN)
  assert.equal(clampValue(50), 50)
  assert.equal(clampValue(200), 100)
})

test('barStyles 输出三条渐变与合法滑块位置', () => {
  const bars = barStyles({ h: 210, s: 60, v: 70 })
  const hex = /^#[0-9a-fA-F]{6}$/
  assert.match(bars.preview, hex)
  assert.match(bars.hueThumb, hex)
  assert.match(bars.satThumb, hex)
  assert.match(bars.valThumb, hex)
  assert.match(bars.satBar, /^linear-gradient\(/)
  assert.match(bars.valBar, /^linear-gradient\(/)
  assert.match(bars.hueBar, /^linear-gradient\(/)
  assert.equal(bars.huePos, '58.333333333333336%')
  assert.equal(bars.satPos, '60%')
  // 明暗位置按 VALUE_MIN 归一化
  assert.equal(barStyles({ h: 0, s: 0, v: VALUE_MIN }).valPos, '0%')
  assert.equal(barStyles({ h: 0, s: 0, v: 100 }).valPos, '100%')
  assert.equal(barStyles({ h: 0, s: 0, v: 0 }).huePos, '0%')
  assert.equal(barStyles({ h: 360, s: 0, v: 0 }).huePos, '100%')
})
