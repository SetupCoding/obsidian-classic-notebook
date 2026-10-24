// Defined on setup so loading the bundle does not construct settings UI.
const notebookSettingsMethods = {
  setupNotebookSettings() {
    const plugin = this;
    class NotebookSettingsTab extends PluginSettingTab {
      getSettingDefinitions() {
        return [{ type: 'group', heading: 'Pages and appearance', items: [
          { name: 'New page format', desc: 'Existing pages keep their format. Canvas-only notebooks always create Canvas pages.', control: { type: 'dropdown', key: 'newPageFormat', defaultValue: 'canvas', options: { canvas: 'Canvas', md: 'Markdown' } } },
          { name: 'Classic colors', desc: 'Use the classic light/dark palette. Turn off to use your current theme colors.', control: { type: 'toggle', key: 'classicColors', defaultValue: true } },
          { name: 'Automatic links', desc: 'Display matching page names and aliases as links. Note text is unchanged.', control: { type: 'toggle', key: 'autoLinksEnabled', defaultValue: true } },
          { name: 'Collapse file explorer on startup', desc: 'Leave more room for the notebook page list.', control: { type: 'toggle', key: 'collapseExplorerOnStart', defaultValue: false } }
        ] }, { name: 'Manage automatic links', desc: 'Review aliases and explicit link rules for this vault.', action: () => new NotebookLinksModal(plugin).open() }];
      }
      getControlValue(key) { return plugin.data[key]; }
      async setControlValue(key, value) {
        const valid = key === 'newPageFormat' ? ['canvas', 'md'].includes(value) : ['classicColors', 'autoLinksEnabled', 'collapseExplorerOnStart'].includes(key) && typeof value === 'boolean';
        if (!valid) return;
        plugin.data[key] = value;
        if (key === 'classicColors') plugin.applyNotebookAppearance();
        if (key === 'autoLinksEnabled') plugin.rebuildAutoLinks();
        await plugin.saveData(plugin.data);
      }
    }
    this.addSettingTab(new NotebookSettingsTab(this.app, this));
  },
  applyNotebookAppearance() {
    this.app.workspace.containerEl.ownerDocument.body.classList.toggle('cn-classic-colors', this.data.classicColors !== false);
  },
  notebookNewPageFormat() {
    return this.data.nativeCanvasOnly ? 'canvas' : this.data.newPageFormat === 'md' ? 'md' : 'canvas';
  }
};
