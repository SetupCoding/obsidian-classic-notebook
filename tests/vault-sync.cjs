const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const sync = require('../scripts/lib/vault-sync.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-sync-test-'));
let next = 0;
function fixture() {
  const root = path.join(temporary, String(next++)); fs.mkdirSync(root);
  const ids = ['classic-notebook', 'gm-note-shortcuts'];
  const plugins = ids.map(id => {
    const repo = path.join(root, id); fs.mkdirSync(path.join(repo, 'src'), { recursive: true }); fs.mkdirSync(path.join(repo, 'shared'));
    const files = { 'main.js': 'module.exports = "new runtime";\n', 'styles.css': '.example { color: blue; }\n', 'manifest.json': JSON.stringify({ id, version: '2.0.0' }, null, 2) + '\n' };
    for (const [name, data] of Object.entries(files)) { fs.writeFileSync(path.join(repo, name), data); fs.writeFileSync(path.join(repo, 'src', id + (name === 'main.js' ? '.js' : name === 'styles.css' ? '.css' : '.manifest.json')), data); }
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    fs.writeFileSync(path.join(repo, 'shared', 'common.js'), 'shared source\n');
    return { id, repository: repo };
  });
  const vaults = ['A', 'B'].map(name => {
    const vault = path.join(root, name), configDir = name === 'A' ? '.obsidian' : '.custom-config';
    fs.mkdirSync(path.join(vault, configDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'a note.md'), '# Keep my note\n');
    for (const id of ids) {
      const dir = path.join(vault, configDir, 'plugins', id); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'main.js'), 'old code ' + name);
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, version: '1.0.0' }));
      fs.writeFileSync(path.join(dir, 'styles.css'), 'old style ' + name);
      fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ vault: name, privateSetting: true }));
      fs.writeFileSync(path.join(dir, 'reference-links.json'), JSON.stringify({ privateLinks: name }));
    }
    return { name, path: vault, configDir };
  });
  const raw = { schemaVersion: 1, plugins, vaults, backupDirectory: path.join(root, 'backups'), sharedModules: { sourcePlugin: ids[0], targetPlugin: ids[1], files: ['common.js'] } };
  const file = path.join(root, 'local.json');
  const save = () => fs.writeFileSync(file, JSON.stringify(raw)); save();
  return { root, raw, file, save, config: () => sync.readConfig(file) };
}
const bytes = snapshot => snapshot.entries.flatMap(e => sync.RUNTIME.map(name => [path.join(e.directory, name), fs.readFileSync(path.join(e.directory, name))]));
try {
  const f = fixture(), config = f.config(), before = sync.plan(config), original = bytes(before);
  const settings = before.entries.flatMap(e => ['data.json', 'reference-links.json'].map(name => [path.join(e.directory, name), fs.readFileSync(path.join(e.directory, name))]));
  assert.equal(before.entries.length, 4); assert(before.entries.every(e => e.changed.length === 3));
  for (const [file, content] of original) assert.deepEqual(fs.readFileSync(file), content, 'planning is read-only');
  const installed = sync.apply(before, { fixture: 'tested commit' });
  assert.equal(installed.changed, 4); assert.equal(sync.verify(before).length, 0);
  for (const [file, content] of settings) assert.deepEqual(fs.readFileSync(file), content, 'each vault keeps its own settings and import profiles');
  const record = JSON.parse(fs.readFileSync(path.join(installed.backup, 'deployment.json')));
  assert.equal(record.status, 'complete'); assert.equal(record.entries.length, 4);
  for (const item of record.entries) {
    const backup = path.join(installed.backup, item.backup);
    assert(fs.readFileSync(path.join(backup, 'main.js'), 'utf8').startsWith('old code'));
    assert(fs.existsSync(path.join(backup, 'data.json')));
  }
  const mtimes = bytes(before).map(([file]) => [file, fs.statSync(file).mtimeMs]);
  const repeated = sync.apply(sync.plan(config)); assert.equal(repeated.changed, 0); assert.equal(repeated.backup, null);
  for (const [file, stamp] of mtimes) assert.equal(fs.statSync(file).mtimeMs, stamp, 'repeat sync does not rewrite unchanged files');
  fs.writeFileSync(path.join(config.plugins[0].repository, 'main.js'), 'corrupt generated output');
  assert.throws(() => sync.plan(config), /Stale generated artifact/, 'drift must fail before a rebuild can hide it');

  const failed = fixture(), planned = sync.plan(failed.config()), old = bytes(planned);
  const editedData = path.join(planned.entries[0].directory, 'data.json');
  assert.throws(() => sync.apply(planned, {}, { beforeCommitFile(item, count) {
    if (count === 1) fs.writeFileSync(editedData, 'a concurrent local preference');
    if (count === 4) throw Error('simulated second-target write failure');
  } }), /Previous runtime restored/);
  for (const [file, content] of old) assert.deepEqual(fs.readFileSync(file), content, 'partial installs restore all previous runtime bytes');
  assert.equal(fs.readFileSync(editedData, 'utf8'), 'a concurrent local preference', 'rollback never restores stale settings over live edits');
  for (const e of planned.entries) assert(!fs.readdirSync(e.directory).some(name => name.endsWith('.tmp')));

  const racing = fixture(), racePlan = sync.plan(racing.config());
  const changedFile = path.join(racePlan.entries[0].directory, 'main.js'); fs.writeFileSync(changedFile, 'changed by another plugin manager');
  assert.throws(() => sync.apply(racePlan), /changed during sync preparation/);
  assert.equal(fs.readFileSync(changedFile, 'utf8'), 'changed by another plugin manager');

  const locked = fixture(), lockedConfig = locked.config(); fs.mkdirSync(path.join(lockedConfig.backupDirectory, '.sync-lock'), { recursive: true });
  assert.throws(() => sync.apply(sync.plan(lockedConfig)), /Another sync/);

  const invalid = fixture(); invalid.raw.vaults.push(invalid.raw.vaults[0]); invalid.save(); assert.throws(invalid.config, /Duplicate vault/);
  const escape = fixture(); escape.raw.vaults[0].configDir = '../outside'; escape.save(); assert.throws(escape.config, /relative folder/);
  const backup = fixture(); backup.raw.backupDirectory = path.join(backup.raw.vaults[0].path, 'backups'); backup.save(); assert.throws(backup.config, /outside vaults/);
  const mismatch = fixture(); fs.writeFileSync(path.join(mismatch.raw.vaults[0].path, '.obsidian/plugins/classic-notebook/manifest.json'), '{"id":"different-plugin"}'); assert.throws(mismatch.config, /Installed manifest ID mismatch/);
  const link = fixture(), external = path.join(link.root, 'external'); fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(link.raw.vaults[0].path, '.linked-config'), 'junction'); link.raw.vaults[0].configDir = '.linked-config'; link.save();
  assert.throws(link.config, /Symlink or junction/);

  const shared = fixture(), sharedConfig = shared.config(), companion = path.join(sharedConfig.plugins[1].repository, 'shared/common.js');
  fs.writeFileSync(companion, 'different companion implementation'); assert.deepEqual(sync.sharedModules(sharedConfig), ['common.js']);
  assert.equal(fs.readFileSync(companion, 'utf8'), 'different companion implementation', 'shared check is read-only');
  sync.sharedModules(sharedConfig, true); assert.deepEqual(sync.sharedModules(sharedConfig), []); assert.equal(fs.readFileSync(companion, 'utf8'), 'shared source\n');

  console.log('PASS: multi-vault runtime parity, read-only plans, non-mutating drift detection, independent settings/custom config folders, backups, idempotence, partial-failure rollback, concurrent edits, locks, path/junction guards and canonical shared modules.');
} finally {
  const resolved = fs.realpathSync(temporary), tempRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('notebook-sync-test-')) throw Error('Refusing cleanup outside the allocated test directory.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
