const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../design-reference/guanju-prototype.html'), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function extract(name) {
  const start = script.indexOf('      function ' + name + '(');
  const end = script.indexOf('\n      }', start) + 8;
  assert.ok(start >= 0 && end > start, name);
  return script.slice(start, end);
}
const context = vm.createContext({ PEOPLE: {}, eventSortTime: e => Date.parse(e.date) || 0 });
for (const name of ['tagsForEvent', 'tagsOf', 'tagUsage', 'renameTagsInList']) vm.runInContext(extract(name), context);
const run = expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
// A person's blank impression must never inherit another person's or a legacy global tag.
assert.deepEqual(run("tagsForEvent({tags:['旧标签'], tagsByPerson:{wang:['帮忙'], li:[]}}, 'li')"), []);
assert.deepEqual(run("tagsForEvent({tags:['旧标签'], tagsByPerson:{wang:['帮忙']}}, 'li')"), []);
assert.deepEqual(run("tagsForEvent({tags:['旧标签']}, 'wang')"), ['旧标签']);
// Person summaries come only from events, even with old manual/hidden tag data.
assert.deepEqual(run("tagsOf([{tagsByPerson:{wang:['帮忙'],li:['取消']}}], ['手动标签'], ['帮忙'], 'wang')"), [{name:'帮忙',count:1}]);
assert.deepEqual(run("renameTagsInList(['主动','帮忙'], '主动', '帮忙')"), ['帮忙']);
vm.runInContext("var shared={id:'e1',date:'2026-09-29',tagsByPerson:{wang:['帮忙'],li:['帮忙']}}; PEOPLE={wang:{name:'小王',events:[shared],manualTags:[]},li:{name:'李四',events:[shared],manualTags:[]},other:{name:'其他',events:[],manualTags:['帮忙']}}", context);
const usage = run("tagUsage('帮忙')");
assert.equal(usage.events.length, 1);
assert.equal(usage.persons.length, 2);
assert.equal(usage.events[0].who, '小王、李四');
const ids = [...source.split('<script>')[0].matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
console.log('通过：脚本语法、多人印象隔离、旧数据兼容、人物汇总、用词合并、共享事件计数、HTML ID 唯一性');
