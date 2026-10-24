const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>
      body { --background-primary:rgb(240,245,250); --background-secondary:rgb(225,230,235); --background-secondary-alt:rgb(210,220,230); --text-normal:rgb(20,30,40); --text-accent:purple; --background-modifier-border:gray; }
    </style><body class="classic-notebook theme-dark"><div class="tn-tab-bar">Notebook</div><span class="tn-import-format" data-tn-color="#102030">Reminder</span></body>`);
    await page.addStyleTag({ path: path.join(root, 'styles.css') });
    await page.evaluate(() => {
      window.module = { exports: {} };
      window.require = () => ({ Plugin: class {}, ItemView: class {}, FileView: class {}, Modal: class {} });
    });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'main.js'), 'utf8') });
    const result = await page.evaluate(() => {
      const plugin = new window.module.exports();
      plugin.app = { workspace: { containerEl: document.body } };
      plugin.data = { classicColors: true, customTextColors: ['#102030', 'invalid}body{display:none}'] };
      const unrelated = new CSSStyleSheet(); unrelated.replaceSync('.unrelated { color: blue; }');
      document.adoptedStyleSheets = [unrelated];
      plugin.applyNotebookAppearance();
      const dark = getComputedStyle(document.querySelector('.tn-tab-bar')).backgroundColor;
      plugin.refreshCustomTextColors();
      const once = document.adoptedStyleSheets.length;
      plugin.refreshCustomTextColors();
      const twice = document.adoptedStyleSheets.length;
      const sheet = plugin.notebookTextColorSheet;
      const color = getComputedStyle(document.querySelector('.tn-import-format')).color;
      const rules = sheet.cssRules.length;
      plugin.data.classicColors = false; plugin.applyNotebookAppearance();
      const themed = getComputedStyle(document.querySelector('.tn-tab-bar')).backgroundColor;
      plugin.data.classicColors = true; plugin.applyNotebookAppearance();
      document.body.classList.replace('theme-dark', 'theme-light');
      const light = getComputedStyle(document.querySelector('.tn-tab-bar')).backgroundColor;
      plugin.unloadNativeNotebookPages();
      return { dark, light, themed, color, rules, once, twice, ownSheetRemoved: !document.adoptedStyleSheets.includes(sheet), unrelatedKept: document.adoptedStyleSheets.includes(unrelated) };
    });
    assert.equal(result.dark, 'rgb(41, 39, 49)');
    assert.equal(result.light, 'rgb(247, 246, 248)');
    assert.equal(result.themed, 'rgb(210, 220, 230)', 'theme opt-out inherits the active theme variable');
    assert.notEqual(result.color, 'rgb(16, 32, 48)', 'dark custom colors are lifted for legibility');
    assert.equal(result.rules, 1, 'invalid color strings cannot create CSS rules');
    assert.equal(result.once, 2); assert.equal(result.twice, 2, 'refresh does not leak stylesheets');
    assert(result.ownSheetRemoved && result.unrelatedKept, 'unload removes only the plugin stylesheet');
    console.log('PASS: Chromium light/dark/theme colors, dynamic CSS application, validation, repeated refresh and stylesheet cleanup.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
