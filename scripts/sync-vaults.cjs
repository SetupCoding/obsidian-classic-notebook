const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const sync = require('./lib/vault-sync.cjs');
const root = path.resolve(__dirname, '..');

function runNode(repository, args, extraEnvironment = {}) {
  const result = spawnSync(process.execPath, args, { cwd: repository, stdio: 'inherit', env: { ...process.env, ...extraEnvironment } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Validation failed in ' + path.basename(repository) + ': node ' + args.join(' '));
}
function git(repository, args) {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error('Git inspection failed in ' + repository);
  return result.stdout.trim();
}

function main(args = process.argv.slice(2)) {
  const action = args.shift() || 'plan';
  if (!['plan', 'sync', 'check', 'shared'].includes(action)) throw Error('Usage: node scripts/sync-vaults.cjs [plan|sync|check|shared] [--config file]');
  let filename = path.join(root, 'sync-vaults.local.json');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--config') throw Error('Expected --config file.');
    filename = path.resolve(args[1]);
  }
  if (!fs.existsSync(filename)) throw Error('Create the ignored local configuration from sync-vaults.example.json: ' + filename);
  const config = sync.readConfig(filename);
  const sharedChanges = sync.sharedModules(config, action === 'shared');
  if (action === 'shared') { console.log(sharedChanges.length ? 'Updated companion copies: ' + sharedChanges.join(', ') + '. Build, test and commit both repositories.' : 'Shared module copies already match.'); return; }
  if (sharedChanges.length) throw Error('Shared companion files diverged: ' + sharedChanges.join(', ') + '. Run the shared action, review and commit both repositories.');
  const snapshot = sync.plan(config);
  for (const entry of snapshot.entries) console.log(entry.vault.name + ' | ' + entry.artifact.id + ' | ' + (entry.previous || 'not installed') + ' -> ' + entry.artifact.version + ' | ' + (entry.changed.length ? 'update ' + entry.changed.join(', ') : 'identical'));
  if (action === 'plan') { console.log('Preview only. Vault-local settings and import profiles are never deployed.'); return; }
  if (action === 'check') {
    const differences = sync.verify(snapshot);
    if (differences.length) throw Error(differences.length + ' runtime files differ from the source repositories.');
    console.log('All configured vault runtimes match the source repositories.'); return;
  }
  const provenance = {};
  for (const plugin of config.plugins) {
    if (git(plugin.repository, ['status', '--porcelain', '--untracked-files=normal'])) throw Error('Commit or preserve pending source changes before syncing: ' + plugin.repository);
    provenance[plugin.id] = { commit: git(plugin.repository, ['rev-parse', 'HEAD']), version: snapshot.artifacts.find(a => a.id === plugin.id).version };
    runNode(plugin.repository, ['build.cjs']);
    runNode(plugin.repository, ['--check', 'main.js']);
    runNode(plugin.repository, ['tests/run.cjs']);
    if (plugin.id === 'classic-notebook') {
      const eslint = path.join(plugin.repository, 'node_modules/eslint/bin/eslint.js');
      if (!fs.existsSync(eslint)) throw Error('Install development dependencies with npm ci in Classic Notebook first.');
      runNode(plugin.repository, [eslint, 'main.js']);
    }
    if (plugin.id === 'gm-note-shortcuts') {
      const classic = config.plugins.find(source => source.id === 'classic-notebook');
      if (!classic) throw Error('Include Classic Notebook in the source configuration to validate the companion integration.');
      runNode(plugin.repository, ['tests/run.cjs', '--integration'], { CLASSIC_NOTEBOOK_DIR: classic.repository });
    }
  }
  for (const plugin of config.plugins) {
    const current = sync.expectedArtifacts(plugin), tested = snapshot.artifacts.find(a => a.id === plugin.id);
    if (sync.RUNTIME.some(name => !current.files[name].equals(tested.files[name]))) throw Error('Source artifacts changed during validation.');
    if (git(plugin.repository, ['status', '--porcelain', '--untracked-files=normal']) || git(plugin.repository, ['rev-parse', 'HEAD']) !== provenance[plugin.id].commit) throw Error('Source checkout changed during validation.');
  }
  const result = sync.apply(snapshot, provenance);
  console.log(result.changed ? 'Updated ' + result.changed + ' plugin installations. Backup: ' + result.backup : 'Already synchronized. No runtime files were rewritten.');
  if (result.changed) console.log('Reload the affected Obsidian vault windows to load the new plugin code.');
}

if (require.main === module) try { main(); } catch (error) { console.error('Sync stopped: ' + error.message); process.exitCode = 1; }
module.exports = { main };
