function notebookRenameName(value) {
  const name = String(value || '').trim().replace(/\.(?:md|canvas)$/i, '');
  if (!name || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) throw new Error('Bitte einen gültigen Seitennamen ohne Sonderzeichen wie / oder : eingeben.');
  return name;
}

function notebookRenamedFrontmatter(frontmatter, name, previousNames) {
  const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : typeof frontmatter.aliases === 'string' ? [frontmatter.aliases] : [];
  const seen = new Set([autoLinkKey(name)]), kept = [];
  for (const alias of [...aliases, ...previousNames]) if (typeof alias === 'string' && alias.trim() && !seen.has(autoLinkKey(alias))) { seen.add(autoLinkKey(alias)); kept.push(alias); }
  return { ...frontmatter, title: name, ...(kept.length ? { aliases: kept } : {}) };
}

const notebookPageRenameMethods = {
  requestRenamePage(file) {
    const expectedPath = file.path;
    new NameModal(this.app, 'Seite umbenennen', file.basename, name => this.renameNotebookPage(file, name, expectedPath)).open();
  },
  async renameNotebookPage(file, value, expectedPath = file.path) {
    const vault = this.app.vault, name = notebookRenameName(value);
    if (!notebookIsPage(file) || file.path !== expectedPath || vault.getAbstractFileByPath(expectedPath) !== file) throw new Error('Die Seite wurde inzwischen verschoben oder gelöscht. Bitte erneut öffnen.');
    const path = normalizePath((parentPath(file.path) ? parentPath(file.path) + '/' : '') + name + '.' + file.extension);
    const collision = vault.getAbstractFileByPathInsensitive?.(path) || vault.getAbstractFileByPath(path);
    if (collision && collision !== file) throw new Error('In diesem Abschnitt gibt es bereits eine Seite mit diesem Namen.');
    this.renamingNotebookPages ||= new WeakSet();
    if (this.renamingNotebookPages.has(file)) throw new Error('Die Seite wird gerade umbenannt.');
    this.renamingNotebookPages.add(file);
    try {
      const previousNames = [this.frontmatter(file).title, file.basename];
      const views = file.extension === 'canvas' ? this.app.workspace.getLeavesOfType('canvas').filter(leaf => leaf.view.file === file && leaf.view.canvas).map(leaf => leaf.view) : [];
      if (views.some(view => view.canvas.readonly)) throw new Error('Die Canvas-Seite ist schreibgeschützt.');
      if (views.some(view => typeof view.save !== 'function')) throw new Error('Bitte die Canvas-Seite schließen und erneut versuchen.');
      // Flush current nodes through Canvas before its path changes, including unsaved cards.
      const active = this.app.workspace.activeLeaf?.view;
      const primary = views.includes(active) ? active : views[0];
      if (views.length > 1 && new Set(views.map(view => { const data = view.canvas.getData(); return JSON.stringify([data.nodes, data.edges]); })).size > 1) throw new Error('Die Seite hat unterschiedliche Entwürfe in mehreren Tabs. Bitte die Entwürfe zuerst sichern und die Seite nur in einem Tab öffnen.');
      if (primary) { primary.canvas.data = primary.canvas.getData(); await primary.save(); }
      if (path !== file.path) await this.app.fileManager.renameFile(file, path);
      let metadata;
      const renameMetadata = data => {
        const current = data.notebook || {};
        data.notebook = { ...current, version: 1, frontmatter: notebookRenamedFrontmatter(current.frontmatter || {}, name, previousNames) };
        return data.notebook;
      };
      if (file.extension === 'canvas') {
        if (views.length) {
          for (const view of views) {
            const canvas = view.canvas;
            canvas.requestPushHistory?.run?.();
            metadata = renameMetadata(canvas.data);
            // Renaming a file is independent of undoing edits to its cards.
            for (const snapshot of canvas.history?.data || []) renameMetadata(snapshot);
            canvas.data = canvas.getData();
          }
          metadata = primary.canvas.data.notebook;
          await primary.save();
        } else {
          await vault.process(file, text => {
            const data = JSON.parse(text);
            if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('Die Canvas-Datei konnte nicht gelesen werden.');
            metadata = renameMetadata(data);
            return JSON.stringify(data, null, 2);
          });
        }
        this.canvasNotebookMetadata?.set(file.path, metadata);
      } else {
        await this.app.fileManager.processFrontMatter(file, frontmatter => Object.assign(frontmatter, notebookRenamedFrontmatter(frontmatter, name, previousNames)));
      }
      this.rebuildAutoLinks(); this.refresh(); this.scheduleNotebookHeaders();
      return file;
    } finally { this.renamingNotebookPages.delete(file); }
  },
  bindNotebookPageTitle(title, file, label) {
    if (title.notebookTitleFile !== file) { title.notebookCancelTitle?.(); title.notebookTitleFile = file; }
    if (!title.querySelector('input') && title.textContent !== label) title.textContent = label;
    title.setAttribute('role', 'button'); title.tabIndex = 0;
    title.setAttribute('aria-label', 'Seite umbenennen: ' + label);
    title.title = 'Zum Umbenennen klicken';
    title.onclick = event => { if (!event.target.closest('input')) this.editNotebookPageTitle(title, file); };
    title.onkeydown = event => {
      if (event.target === title && ['Enter', ' '].includes(event.key)) { event.preventDefault(); this.editNotebookPageTitle(title, file); }
    };
  },
  editNotebookPageTitle(title, file) {
    if (title.querySelector('input')) return;
    const expectedPath = file.path, label = this.frontmatter(file).title || file.basename;
    title.textContent = '';
    const input = title.createEl('input', { type: 'text', cls: 'tn-page-title-input', attr: { 'aria-label': 'Seitentitel', placeholder: 'Seitentitel' } });
    input.value = file.basename;
    let finished = false, saving = false;
    const cancel = () => { if (finished) return; finished = true; title.textContent = this.frontmatter(file).title || file.basename || label; delete title.notebookCancelTitle; };
    title.notebookCancelTitle = cancel;
    const save = async () => {
      if (finished || saving) return;
      saving = true; input.disabled = true;
      try { await this.renameNotebookPage(file, input.value, expectedPath); cancel(); }
      catch (error) { new Notice(error.message || 'Der Name konnte nicht gespeichert werden.'); input.disabled = false; saving = false; if (input.isConnected) input.focus(); }
    };
    input.onkeydown = event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancel(); title.focus(); }
      else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void save(); }
    };
    input.onblur = () => { if (!saving) void save(); };
    input.focus(); input.select();
  }
};
