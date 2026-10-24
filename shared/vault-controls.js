// Keep Obsidian's own vault menu/help/settings handlers. Place the controls
// at the bottom right and restore the native DOM on unload.
const notebookVaultControlMethods = {
  mountNotebookVaultControls() {
    if (this.notebookVaultControls) return;
    const workspace = this.app.workspace, doc = workspace.containerEl.ownerDocument;
    const state = this.notebookVaultControls = { active: true, profile: null, dock: null, attributes: [] };
    const restoreProfile = () => {
      if (!state.profile || !state.home) return;
      if (state.profile.parentElement !== state.home) state.home.insertBefore(state.profile, state.next?.parentElement === state.home ? state.next : null);
    };
    const accessible = (element, label, menu = false) => {
      if (!element) return;
      for (const [name, value] of [['role', 'button'], ['tabindex', '0'], ['aria-label', label], ['title', label], ...(menu ? [['aria-haspopup', 'menu']] : [])]) {
        state.attributes.push({ element, name, previous: element.getAttribute(name) }); element.setAttribute(name, value);
      }
      if (!element.matches('button')) this.registerDomEvent(element, 'keydown', event => {
        if (!['Enter', ' '].includes(event.key) || event.repeat) return;
        event.preventDefault(); event.stopPropagation(); element.click();
      });
    };
    const update = () => {
      if (!state.active) return;
      if (!state.profile) {
        const profile = workspace.leftSplit?.containerEl?.querySelector('.workspace-sidedock-vault-profile') || doc.querySelector('.workspace-sidedock-vault-profile');
        if (!profile) return;
        state.profile = profile; state.home = profile.parentElement; state.next = profile.nextSibling;
        profile.classList.add('cn-notebook-vault-profile');
        const dock = state.dock = doc.createElement('div'); dock.className = 'cn-notebook-vault-dock';
        dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Vault und Einstellungen');
        doc.body.append(dock);
        accessible(profile.querySelector('.workspace-drawer-vault-switcher'), 'Vault wechseln: ' + this.app.vault.getName(), true);
        const actions = profile.querySelector('.workspace-drawer-vault-actions');
        if (actions?.firstElementChild !== actions?.lastElementChild) accessible(actions?.firstElementChild, 'Hilfe öffnen');
        accessible(actions?.lastElementChild, 'Einstellungen öffnen');
      }
      if (state.profile.parentElement !== state.dock) state.dock.append(state.profile);
      doc.body.classList.add('cn-vault-dock-floating');
    };
    this.registerEvent(workspace.on('layout-change', update));
    this.register(() => {
      state.active = false; restoreProfile();
      state.profile?.classList.remove('cn-notebook-vault-profile');
      for (const { element, name, previous } of state.attributes) {
        if (previous == null) element.removeAttribute(name); else element.setAttribute(name, previous);
      }
      state.dock?.remove(); doc.body.classList.remove('cn-vault-dock-floating'); this.notebookVaultControls = null;
    });
    update();
  }
};
