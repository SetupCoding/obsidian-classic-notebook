const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.setContent(`<style>
      * { box-sizing:border-box; } body { margin:0; --background-primary:#fff; --background-secondary:#eee; --background-secondary-alt:#ddd; --background-modifier-border:#ccc; --text-normal:#222; --text-muted:#666; --text-faint:#888; --text-accent:purple; }
      .workspace { height:100vh;display:flex; } .left-sidebar { width:260px; } .workspace-main { flex:1; } .workspace-drawer-vault-actions .clickable-icon { display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center; } .workspace-sidedock-vault-profile { display:flex; } .status-bar { position:fixed;right:0;bottom:0;width:120px;height:26px; }
    </style><body class="classic-notebook cn-classic-colors theme-light"><div class="workspace"><div class="left-sidebar"><div class="workspace-sidedock-vault-profile"><div class="workspace-drawer-vault-switcher" title="Original tooltip"><div class="workspace-drawer-vault-switcher-icon">↕</div><div class="workspace-drawer-vault-name">A very long fictional notebook name with many words</div></div><div class="workspace-drawer-vault-actions"><span class="clickable-icon">?</span><span class="clickable-icon">⚙</span></div></div><div id="original-next"></div></div><main class="workspace-main"></main><aside class="workspace-ribbon mod-left"></aside></div><div class="status-bar">Status</div></body>`);
    await page.addStyleTag({ path: path.join(root, 'styles.css') });
    await page.evaluate(() => {
      window.module = { exports: {} }; window.require = () => ({ Plugin: class {}, ItemView: class {}, FileView: class {}, Modal: class {} });
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'main.js'), 'utf8') });
    await page.evaluate(() => {
      window.vaultClicks = { vault:0, settings:0 }, window.cleanups = [], window.updates = [];
      const profile = document.querySelector('.workspace-sidedock-vault-profile');
      window.originalProfile = profile; window.originalParent = profile.parentElement;
      profile.querySelector('.workspace-drawer-vault-switcher').onclick = () => vaultClicks.vault++;
      profile.querySelector('.workspace-drawer-vault-actions').lastElementChild.onclick = () => vaultClicks.settings++;
      window.plugin = new module.exports();
      plugin.app = { vault: { getName: () => 'Fictional notebook' }, workspace: { containerEl:document.querySelector('.workspace'), leftSplit:{collapsed:true,containerEl:originalParent}, on(name, callback){updates.push(callback);return callback;} } };
      plugin.register = fn => cleanups.push(fn); plugin.registerEvent = () => {}; plugin.registerDomEvent = (el,name,callback) => { el.addEventListener(name,callback);cleanups.push(()=>el.removeEventListener(name,callback)); };
      originalParent.remove();
      plugin.mountNotebookVaultControls(); plugin.mountNotebookVaultControls();
    });
    assert.equal(await page.locator('.cn-notebook-vault-dock').count(),1,'repeated setup cannot duplicate the footer');
    assert.equal(await page.locator('.cn-notebook-vault-dock .workspace-sidedock-vault-profile').count(),1);
    const footerBounds = () => page.evaluate(()=>({dock:document.querySelector('.cn-notebook-vault-dock').getBoundingClientRect().toJSON(),status:document.querySelector('.status-bar').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight}));
    const wide = await footerBounds();
    assert.equal(wide.dock.right,wide.width,'footer aligns with the right window edge');
    assert.equal(wide.dock.bottom,wide.height,'footer aligns with the bottom window edge');
    assert(wide.status.right<=wide.dock.left,'footer leaves the native status bar visible beside it');
    await page.getByRole('button',{name:'Vault wechseln: Fictional notebook',exact:true}).click();
    await page.getByRole('button',{name:'Einstellungen öffnen',exact:true}).click();
    await page.getByRole('button',{name:'Vault wechseln: Fictional notebook',exact:true}).press('Enter');
    await page.getByRole('button',{name:'Einstellungen öffnen',exact:true}).press('Space');
    assert.deepEqual(await page.evaluate(()=>vaultClicks),{vault:2,settings:2},'mouse and keyboard preserve the native handlers');
    assert.equal(await page.locator('.workspace').evaluate(el=>getComputedStyle(el).paddingBottom),'40px','footer does not cover the bottom of the editor');
    await page.evaluate(()=>document.body.classList.add('cn-ribbon-hidden'));
    assert(await page.getByRole('button',{name:'Einstellungen öffnen',exact:true}).isVisible(),'settings stay visible when the icon rail is hidden');
    await page.setViewportSize({width:360,height:600});
    const boxes=await page.evaluate(()=>({dock:document.querySelector('.cn-notebook-vault-dock').getBoundingClientRect().toJSON(),settings:document.querySelector('.workspace-drawer-vault-actions').lastElementChild.getBoundingClientRect().toJSON()}));
    assert(boxes.settings.right<=boxes.dock.right && boxes.settings.left>=boxes.dock.left,'long names shrink before pushing out the settings button');
    const narrow = await footerBounds();
    assert.equal(narrow.dock.right,narrow.width);
    assert(narrow.status.right<=narrow.dock.left && narrow.status.left>=0,'narrow windows keep the status bar outside the footer');
    await page.evaluate(()=>document.body.classList.replace('theme-light','theme-dark'));
    assert.equal(await page.locator('.cn-notebook-vault-dock').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(40, 38, 47)');
    await page.evaluate(()=>{document.querySelector('.workspace').prepend(originalParent);plugin.app.workspace.leftSplit.collapsed=false;updates.forEach(fn=>fn());});
    assert(await page.evaluate(()=>originalProfile.parentElement.classList.contains('cn-notebook-vault-dock')),'expanding the sidebar keeps the controls at the bottom right');
    assert(await page.locator('.cn-notebook-vault-dock').isVisible());
    assert.equal(await page.locator('.workspace').evaluate(el=>getComputedStyle(el).paddingBottom),'40px');
    assert.equal((await footerBounds()).dock.right,narrow.width);
    await page.evaluate(()=>{
      plugin.app.workspace.leftSplit.collapsed=true;updates.forEach(fn=>fn());
      const parent=originalParent.parentElement;originalParent.remove();cleanups.forEach(fn=>fn());
      if(originalProfile.parentElement!==originalParent)throw Error('A temporarily detached sidebar must still recover its native profile.');
      parent.prepend(originalParent);
    });
    assert.equal(await page.locator('.cn-notebook-vault-dock').count(),0);
    assert(await page.evaluate(()=>originalProfile.parentElement===originalParent && originalProfile.nextSibling.id==='original-next'));
    assert.equal(await page.locator('.workspace-drawer-vault-switcher').getAttribute('title'),'Original tooltip');
    assert.equal(await page.locator('.workspace-drawer-vault-switcher').getAttribute('role'),null,'unload restores original accessibility attributes');
    assert(!await page.locator('body').evaluate(el=>el.classList.contains('cn-vault-dock-floating')));
    assert.equal(await page.locator('.status-bar').evaluate(el=>getComputedStyle(el).right),'0px','unload restores the native status bar');
    console.log('PASS: native vault/settings handlers, mouse/keyboard access, bottom-right placement with expanded/collapsed sidebar and hidden ribbon, status-bar clearance, narrow layouts, singleton setup and unload restoration.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
