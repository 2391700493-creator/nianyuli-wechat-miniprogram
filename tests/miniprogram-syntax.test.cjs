const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const files = ['app.js']
for (const directory of ['pages', 'components', 'custom-tab-bar', 'utils', 'config']) {
  for (const file of fs.readdirSync(path.join(root, directory), { recursive: true })) {
    if (file.endsWith('.js')) files.push(path.join(directory, file))
  }
}

// 普通 CommonJS 测试会容忍顶层重名函数；模块语法检查可提前拦住
// 微信增强编译器拒绝的这类声明冲突。这里只解析，不改变运行方式。
for (const file of files) {
  test(`小程序脚本可解析且无顶层声明冲突：${file}`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(path.join(root, file), 'utf8'), encoding: 'utf8'
    })
    assert.equal(result.status, 0, `${file}\n${result.stderr}`)
  })
}
