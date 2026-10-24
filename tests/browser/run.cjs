const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
for (const name of fs.readdirSync(__dirname).filter(name=>name.endsWith('.cjs')&&name!=='run.cjs').sort()) {
  const result = spawnSync(process.execPath,[path.join(__dirname,name)],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
