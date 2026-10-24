const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const RUNTIME = ['main.js', 'manifest.json', 'styles.css'];
const LOCAL_STATE = ['data.json', 'import-settings.json', 'reference-links.json', 'spatial-import.json', 'spatial-typography.json'];
const hash = buffer => buffer == null ? null : crypto.createHash('sha256').update(buffer).digest('hex');
const text = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const read = file => fs.existsSync(file) ? fs.readFileSync(file) : null;
const json = file => JSON.parse(text(file));
const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

function noLinks(file) {
  let current = path.parse(file).root;
  for (const part of path.relative(current, file).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink or junction is not an installation target: ' + current);
  }
}

function readConfig(configFile) {
  const filename = path.resolve(configFile), base = path.dirname(filename), config = json(filename);
  if (config.schemaVersion !== 1 || !Array.isArray(config.plugins) || !config.plugins.length || !Array.isArray(config.vaults) || !config.vaults.length) throw Error('Expected schemaVersion 1, plugins and vaults.');
  const ids = new Set();
  const plugins = config.plugins.map(item => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id) || typeof item.repository !== 'string') throw Error('Invalid or duplicate plugin entry.');
    ids.add(item.id);
    const repository = fs.realpathSync(path.resolve(base, item.repository));
    if (json(path.join(repository, 'manifest.json')).id !== item.id) throw Error('Source manifest ID mismatch: ' + item.id);
    return { id: item.id, repository };
  });
  const targets = new Set();
  const vaults = config.vaults.map(item => {
    if (typeof item.path !== 'string') throw Error('A vault needs a path.');
    const vault = path.resolve(base, item.path), configDir = item.configDir || '.obsidian';
    if (!fs.statSync(vault).isDirectory()) throw Error('Vault does not exist: ' + vault);
    if (path.isAbsolute(configDir) || !configDir.split(/[\\/]/).every(part => part && !['.', '..'].includes(part))) throw Error('configDir must be a relative folder inside the vault.');
    const directory = path.resolve(vault, configDir);
    if (!inside(vault, directory) || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw Error('Existing Obsidian config folder required: ' + directory);
    noLinks(directory);
    const resolved = fs.realpathSync(directory), key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (targets.has(key)) throw Error('Duplicate vault target: ' + vault);
    targets.add(key);
    for (const plugin of plugins) if (inside(vault, plugin.repository) || inside(plugin.repository, vault)) throw Error('Source repository and vault must be separate.');
    for (const plugin of plugins) {
      const install = path.join(directory, 'plugins', plugin.id);
      for (const file of [install, ...RUNTIME.map(name => path.join(install, name))]) noLinks(file);
      if (fs.existsSync(path.join(install, 'manifest.json')) && json(path.join(install, 'manifest.json')).id !== plugin.id) throw Error('Installed manifest ID mismatch: ' + install);
    }
    return { name: item.name || path.basename(vault), path: vault, directory };
  });
  const defaultBackup = path.join(process.env.LOCALAPPDATA || process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'ObsidianPluginSync', 'backups');
  const backupDirectory = path.resolve(base, config.backupDirectory || defaultBackup);
  noLinks(backupDirectory);
  for (const entry of [...vaults.map(v => v.path), ...plugins.map(p => p.repository)]) if (inside(entry, backupDirectory)) throw Error('Backups must be outside vaults and repositories.');
  return { filename, plugins, vaults, backupDirectory, sharedModules: config.sharedModules || null };
}

function expectedArtifacts(plugin) {
  const base = path.join(plugin.repository, 'src', plugin.id);
  const main = text(base + '.js').replace(/\/\/ @include ([a-z-]+)/g, (_, name) => text(path.join(plugin.repository, 'shared', name + '.js')));
  const manifest = text(base + '.manifest.json'), parsed = JSON.parse(manifest);
  if (parsed.id !== plugin.id || parsed.version !== json(path.join(plugin.repository, 'package.json')).version) throw Error('Source manifest/package mismatch: ' + plugin.id);
  const expected = { 'main.js': Buffer.from(main), 'manifest.json': Buffer.from(manifest), 'styles.css': Buffer.from(text(base + '.css')) };
  for (const name of RUNTIME) if (!expected[name].equals(fs.readFileSync(path.join(plugin.repository, name)))) throw Error('Stale generated artifact: ' + plugin.id + '/' + name + '. Rebuild and commit before deploying.');
  return { id: plugin.id, version: parsed.version, files: expected };
}

function sharedModules(config, write = false) {
  const shared = config.sharedModules;
  if (!shared) return [];
  const source = config.plugins.find(p => p.id === shared.sourcePlugin), target = config.plugins.find(p => p.id === shared.targetPlugin);
  if (!source || !target || source === target || !Array.isArray(shared.files)) throw Error('Invalid sharedModules configuration.');
  const changed = [];
  for (const name of shared.files) {
    if (!/^[a-z0-9-]+\.js$/.test(name)) throw Error('Invalid shared module filename.');
    const from = path.join(source.repository, 'shared', name), to = path.join(target.repository, 'shared', name), data = Buffer.from(text(from));
    if (read(to)?.equals(data)) continue;
    changed.push(name);
    if (write) fs.writeFileSync(to, data);
  }
  return changed;
}

function plan(config) {
  const artifacts = config.plugins.map(expectedArtifacts), entries = [];
  for (const vault of config.vaults) for (const artifact of artifacts) {
    const directory = path.join(vault.directory, 'plugins', artifact.id);
    const before = Object.fromEntries(RUNTIME.map(name => [name, read(path.join(directory, name))]));
    const previous = before['manifest.json'] ? JSON.parse(before['manifest.json'].toString('utf8').replace(/^\uFEFF/, '')).version : null;
    entries.push({ vault, artifact, directory, previous, before, changed: RUNTIME.filter(name => !before[name]?.equals(artifact.files[name])) });
  }
  return { config, entries, artifacts };
}

function verify(snapshot) {
  const differences = [];
  for (const entry of snapshot.entries) for (const name of RUNTIME) {
    if (hash(read(path.join(entry.directory, name))) !== hash(entry.artifact.files[name])) differences.push({ vault: entry.vault.name, plugin: entry.artifact.id, file: name });
  }
  return differences;
}

function apply(snapshot, provenance = {}, hooks = {}) {
  const { config } = snapshot, changed = snapshot.entries.filter(entry => entry.changed.length);
  if (!changed.length) return { changed: 0, backup: null, differences: verify(snapshot) };
  fs.mkdirSync(config.backupDirectory, { recursive: true });
  noLinks(config.backupDirectory);
  const lock = path.join(config.backupDirectory, '.sync-lock');
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') throw Error('Another sync is running, or its lock needs inspection: ' + lock); throw error; }
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex');
  const backup = path.join(config.backupDirectory, id), staged = [], completed = [], newDirectories = [];
  const report = { schemaVersion: 1, created: new Date().toISOString(), status: 'preparing', provenance, entries: [] };
  const saveReport = () => fs.writeFileSync(path.join(backup, 'deployment.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    fs.mkdirSync(backup);
    // Back up every target before touching any installed runtime file.
    for (const [index, entry] of changed.entries()) {
      const copy = path.join(backup, String(index), entry.artifact.id);
      fs.mkdirSync(copy, { recursive: true });
      for (const name of [...RUNTIME, ...LOCAL_STATE]) {
        const data = RUNTIME.includes(name) ? entry.before[name] : read(path.join(entry.directory, name));
        if (data != null) fs.writeFileSync(path.join(copy, name), data);
      }
      report.entries.push({ vault: entry.vault.path, configDir: path.relative(entry.vault.path, entry.vault.directory), plugin: entry.artifact.id, from: entry.previous, to: entry.artifact.version, backup: path.relative(backup, copy), files: Object.fromEntries(RUNTIME.map(name => [name, { before: hash(entry.before[name]), after: hash(entry.artifact.files[name]) }])) });
    }
    saveReport();
    for (const entry of changed) {
      if (!fs.existsSync(entry.directory)) { fs.mkdirSync(entry.directory, { recursive: true }); newDirectories.push(entry.directory); }
      for (const name of entry.changed) {
        const temp = path.join(entry.directory, '.' + name + '.sync-' + id + '.tmp');
        fs.writeFileSync(temp, entry.artifact.files[name], { flag: 'wx' });
        staged.push({ entry, name, temp, destination: path.join(entry.directory, name) });
      }
    }
    // A plugin manager changing a runtime file during preparation invalidates the plan.
    for (const entry of snapshot.entries) for (const name of RUNTIME) {
      if (hash(read(path.join(entry.directory, name))) !== hash(entry.before[name])) throw Error('Installed files changed during sync preparation. No planned update can be applied.');
    }
    report.status = 'installing'; saveReport();
    for (const item of staged) {
      hooks.beforeCommitFile?.(item, completed.length);
      fs.renameSync(item.temp, item.destination); completed.push(item);
    }
    const differences = verify(snapshot);
    if (differences.length) throw Error('Runtime verification failed after installation.');
    report.status = 'complete'; saveReport();
    return { changed: changed.length, backup, differences: [] };
  } catch (error) {
    const failures = [];
    for (const item of completed.reverse()) {
      try {
        if (hash(read(item.destination)) !== hash(item.entry.artifact.files[item.name])) throw Error('A different writer changed ' + item.destination);
        if (item.entry.before[item.name] == null) fs.unlinkSync(item.destination);
        else {
          const temp = item.destination + '.restore-' + id;
          fs.writeFileSync(temp, item.entry.before[item.name], { flag: 'wx' }); fs.renameSync(temp, item.destination);
        }
      } catch (failure) { failures.push(failure.message); }
    }
    report.status = failures.length ? 'rollback-needs-attention' : 'rolled-back'; report.error = error.message; report.rollbackErrors = failures;
    if (fs.existsSync(backup)) saveReport();
    throw Error(error.message + ' Backups: ' + backup + (failures.length ? '. Rollback needs attention: ' + failures.join('; ') : '. Previous runtime restored.'));
  } finally {
    for (const item of staged) if (fs.existsSync(item.temp)) fs.unlinkSync(item.temp);
    for (const directory of newDirectories.reverse()) if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
    fs.rmdirSync(lock);
  }
}

module.exports = { RUNTIME, LOCAL_STATE, hash, readConfig, expectedArtifacts, sharedModules, plan, verify, apply };
