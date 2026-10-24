const fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');
const integration = process.argv.includes('--integration');
const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs') && name !== 'run.cjs' && name.endsWith('.integration.cjs') === integration).sort();
if (!files.length) throw new Error('No test files selected.');
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {stdio:'inherit', env:process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Passed ${files.length} test files.`);
