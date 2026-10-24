const fs = require('node:fs'), path = require('node:path');
const readText = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const root = __dirname, id = 'classic-notebook';
const source = readText(path.join(root, 'src', id + '.js')).replace(/\/\/ @include ([a-z-]+)/g, (_, name) => readText(path.join(root, 'shared', name + '.js')));
for (const [name, content] of [
  ['main.js', source],
  ['styles.css', readText(path.join(root, 'src', id + '.css'))],
  ['manifest.json', readText(path.join(root, 'src', id + '.manifest.json'))]
]) fs.writeFileSync(path.join(root, name), content);
console.log('Built ' + id);
