const fs = require('node:fs'), path = require('node:path');
const root = __dirname, id = 'classic-notebook';
const source = fs.readFileSync(path.join(root, 'src', id + '.js'), 'utf8').replace(/\/\/ @include ([a-z-]+)/g, (_, name) => fs.readFileSync(path.join(root, 'shared', name + '.js'), 'utf8'));
for (const [name, content] of [
  ['main.js', source],
  ['styles.css', fs.readFileSync(path.join(root, 'src', id + '.css'))],
  ['manifest.json', fs.readFileSync(path.join(root, 'src', id + '.manifest.json'))]
]) fs.writeFileSync(path.join(root, name), content);
console.log('Built ' + id);
