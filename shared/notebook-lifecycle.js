// Install a reversible hook per Canvas view. Never keep an old plugin instance
// alive after disable/reload, and never let optional targeting block core state.
const notebookLifecycleMethods = {
  hookNotebookEphemeralState(view, isEnabled) {
    this.notebookEphemeralHooks ||= new WeakMap();
    if (this.notebookEphemeralHooks.has(view) || typeof view.setEphemeralState !== 'function') return;
    const plugin = this, original = view.setEphemeralState;
    const owned = Object.hasOwn(view, 'setEphemeralState');
    let active = true, revision = 0;
    function wrapped(ephemeral) {
      const currentRevision = ++revision;
      if (!active || !isEnabled()) return original.call(this, ephemeral);
      try {
        const target = plugin.canvasNotebookAnchorState?.(this, ephemeral);
        if (target) ephemeral = { ...ephemeral, ...target };
      } catch (error) { console.warn('Classic Notebook: Could not resolve Canvas target.', error); }
      if (ephemeral?.match || ephemeral?.subpath) this.__notebookPositionToken = null;
      const result = original.call(this, ephemeral);
      if (ephemeral?.match) {
        const path = this.file?.path, targetView = this;
        const win = this.containerEl?.ownerDocument?.defaultView;
        win?.requestAnimationFrame(() => {
          if (!active || !isEnabled() || revision !== currentRevision || targetView.file?.path !== path) return;
          try { plugin.revealCanvasNotebookMatch(targetView, ephemeral); }
          catch (error) { console.warn('Classic Notebook: Could not reveal Canvas target.', error); }
        });
      }
      return result;
    }
    this.notebookEphemeralHooks.set(view, wrapped);
    view.setEphemeralState = wrapped;
    this.register(() => {
      active = false;
      revision++;
      if (view.setEphemeralState === wrapped) {
        if (owned) view.setEphemeralState = original;
        else delete view.setEphemeralState;
      }
      plugin.notebookEphemeralHooks.delete(view);
    });
  }
};
