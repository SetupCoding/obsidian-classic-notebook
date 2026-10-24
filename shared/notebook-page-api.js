// Optional integration surface for other plugins. All paths and labels are vault-local.
const notebookPageApi = {
  async appendNotebookPageEmbed({ file, embedFile, subpath = '', key = 'references', label = 'Verknüpfte Notizen', width = 620, height = 420 }) {
    const vault = this.app.vault;
    if (!notebookIsPage(file) || vault.getAbstractFileByPath(file.path) !== file || !(embedFile instanceof TFile) || vault.getAbstractFileByPath(embedFile.path) !== embedFile) throw new Error('Eine der verknüpften Seiten wurde verschoben oder gelöscht.');
    if (!/^[a-z0-9-]+$/i.test(key) || (subpath && !/^#\^[a-z0-9-]+$/i.test(subpath))) throw new Error('Ungültige Verknüpfung.');
    const reference = embedFile.path.replace(/\.md$/i, '') + subpath, embed = '![[' + reference + ']]';
    width = Math.max(150, Math.min(2000, Number(width) || 620)); height = Math.max(100, Math.min(2400, Number(height) || 420));
    if (file.extension === 'canvas') {
      const open = this.app.workspace.getLeavesOfType('canvas').find(leaf => leaf.view.file === file && leaf.view.canvas)?.view.canvas;
      const same = node => node.type === 'file' && node.file === embedFile.path && (node.subpath || '') === subpath;
      if (open) {
        if (open.readonly) throw new Error('Die Canvas-Seite ist schreibgeschützt.');
        const data = open.getData(); if (data.nodes.some(same)) return;
        if (typeof open.createFileNode !== 'function') throw new Error('Bitte die Canvas-Seite schließen und erneut versuchen.');
        const x = data.nodes.length ? Math.max(...data.nodes.map(node => node.x + node.width)) + 60 : 0;
        open.createFileNode({ file: embedFile, subpath, pos: { x, y: 0 }, size: { width, height }, focus: false });
        return;
      }
      await vault.process(file, text => {
        const data = JSON.parse(text);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('Die Canvas-Datei konnte nicht gelesen werden.');
        if (data.nodes.some(same)) return text;
        const x = data.nodes.length ? Math.max(...data.nodes.map(node => node.x + node.width)) + 60 : 0;
        data.nodes.push({ id: 'ref-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16), type: 'file', file: embedFile.path, ...(subpath ? {subpath} : {}), x, y: 0, width, height });
        return JSON.stringify(data, null, 2);
      });
      return;
    }
    // Flush a live Markdown editor before adding references to its file.
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) if (leaf.view.file === file) await leaf.view.save?.();
    const layout = this.data.spatialLayouts?.[file.path];
    if (layout) {
      const existing = layout.boxes.find(box => box.integrationKey === key);
      const id = existing?.id || crypto.randomUUID().replaceAll('-', '').slice(0, 12);
      const box = existing || { id, integrationKey: key, label, x: Math.max(...layout.boxes.map(box => box.x + spatialBoxWidth(box)), 24) + 60, y: 48, width: 560, height: 220, z: layout.boxes.length };
      await vault.process(file, text => {
        const block = spatialBlocks(text).get(id);
        if (existing && !block) throw new Error('Der verknüpfte Textkasten fehlt. Bitte die Textansicht prüfen.');
        if (block?.text.includes(embed)) return text;
        return block ? spatialReplace(text, id, block.text, block.text.trimEnd() + '\n\n' + embed) : spatialAppendBlock(text, id, embed);
      });
      if (!existing) { layout.boxes.push(box); this.persist(); }
      for (const leaf of this.app.workspace.getLeavesOfType(SPATIAL_VIEW)) if (leaf.view.file === file) { leaf.view.layout = layout; await leaf.view.loadText(); }
      return;
    }
    await vault.process(file, text => {
      if (text.includes(embed)) return text;
      const newline = text.includes('\r\n') ? '\r\n' : '\n';
      const start = '<!-- notebook-refs:' + key + ':start -->', end = '<!-- notebook-refs:' + key + ':end -->';
      const a = text.indexOf(start), b = text.indexOf(end);
      if (a >= 0 && b > a) return text.slice(0, b) + embed + newline + newline + text.slice(b);
      if (a >= 0 || b >= 0) throw new Error('Die Markierungen der verknüpften Notizen sind unvollständig.');
      return text + (text.endsWith(newline) ? newline : newline + newline) + start + newline + '## ' + label + newline + newline + embed + newline + newline + end + newline;
    });
  },
  getNotebookPageParents(section) {
    return this.pageOutline(section).filter(item => item.level < MAX_PAGE_DEPTH && (item.hasChildren || /^[-\u2013\u2014\u2500]{2,}/.test(item.file.basename))).map(item => ({
      path: item.path, title: this.frontmatter(item.file).title || item.file.basename, level: item.level
    }));
  },
  async createNotebookPage({ section = '', title, parentPath = null, text = '', aliases = [], kind = 'canvas' }) {
    const name = String(title || '').trim().replace(/\.(?:md|canvas)$/i, '');
    if (!name || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) || ['.', '..'].includes(name)) throw new Error('Bitte einen gültigen Seitennamen eingeben.'); // eslint-disable-line no-control-regex -- Reject ASCII control characters in filenames.
    if (!['md', 'canvas'].includes(kind)) throw new Error('Unbekanntes Seitenformat.');
    section = section ? normalizePath(section) : '';
    const folder = section ? this.app.vault.getAbstractFileByPath(section) : this.app.vault.getRoot();
    if (!(folder instanceof TFolder)) throw new Error('Der Zielabschnitt existiert nicht mehr.');
    const parentFile = parentPath ? this.app.vault.getAbstractFileByPath(parentPath) : null;
    const parent = parentPath ? this.pageOutline(section).find(item => item.path === parentPath) : null;
    if (parentPath && (!parent || parent.level >= MAX_PAGE_DEPTH || !notebookIsPage(parentFile))) throw new Error('Die Unterkategorie fehlt oder erlaubt keine weitere Seitenebene.');
    const stem = (section ? section + '/' : '') + name;
    if (this.app.vault.getFiles().some(file => ['md', 'canvas'].includes(file.extension) && file.path.replace(/\.(?:md|canvas)$/i, '').toLocaleLowerCase() === stem.toLocaleLowerCase())) throw new Error('Eine Seite mit diesem Namen existiert im Abschnitt bereits.');
    const created = new Date().toISOString(), cleanAliases = [...new Set(aliases.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
    const canvasPage=kind==='canvas'?notebookNewCanvasPage({title:name,created,aliases:cleanAliases,text,emptyCard:false}):null;
    const content = canvasPage ? JSON.stringify(canvasPage, null, 2)
      : '---\ncreated: ' + JSON.stringify(created) + '\naliases: ' + JSON.stringify(cleanAliases) + '\n---\n\n' + text;
    const file = await this.app.vault.create(stem + '.' + kind, content);
    if(canvasPage)this.canvasNotebookMetadata?.set(file.path,canvasPage.notebook);
    this.data.pageMeta ||= {}; this.data.pageMeta[file.path] = { created, title: name, aliases: cleanAliases }; this.persist();
    if (parentPath) {
      const currentParent = this.app.vault.getAbstractFileByPath(parentPath);
      const outline = this.pageOutline(section), current = outline.find(item => item.path === parentPath);
      if (currentParent !== parentFile || !current || current.level >= MAX_PAGE_DEPTH) throw new Error('Die Seite wurde angelegt, aber die Unterkategorie wurde zwischenzeitlich geändert: ' + file.path);
      const plan = this.planPageMove(file.path, parentPath, 'inside', outline);
      if (plan.error || !this.commitPagePlan(section, plan)) throw new Error('Die Seite wurde angelegt, konnte aber nicht eingerückt werden: ' + file.path);
    }
    this.rebuildAutoLinks(); this.refresh();
    return file;
  }
};
