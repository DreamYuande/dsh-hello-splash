/** One observable settings store for the current profile. */
HS.createSettingsStore = () => {
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  let legacy = null
  if (window[configGlobal] == null) {
    try { legacy = JSON.parse(window.localStorage.getItem(legacyKey)) } catch {}
  }
  let state = normalizeSettings(window[configGlobal] ?? legacy)
  let status = ''
  let write = Promise.resolve()
  let revision = 0

  const persist = (value) => {
    const savedRevision = ++revision
    status = '正在保存…'
    emit()
    write = write.then(async () => {
      try {
        const result = await fetch(configEndpoint, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        })
        if (!result.ok) throw new Error('Settings write failed')
        if (legacy !== null) {
          legacy = null
          try { window.localStorage.removeItem(legacyKey) } catch {}
        }
        if (savedRevision === revision) status = '已保存到当前 Profile'
      } catch {
        if (savedRevision === revision) status = '保存失败，当前更改仅在此窗口生效'
      }
      emit()
    })
  }

  if (legacy !== null && window[configGlobal] === null) persist(state)
  if (window[configGlobal] === undefined) {
    // A hot-loaded module may have missed the Host's document boot payload.
    void fetch(configEndpoint, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return
      const saved = await response.json()
      if (revision > 0) return
      if (saved !== null) {
        state = normalizeSettings(saved)
        emit()
      } else if (legacy !== null) {
        persist(state)
      }
    }).catch(() => {})
  }

  return {
    get: () => state,
    getStatus: () => status,
    set: (patch) => {
      state = normalizeSettings({ ...state, ...patch })
      persist(state)
    },
    reset: () => {
      state = defaultSettings
      persist(state)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** React subscribes to run changes. The scene owns the animation clock. */
HS.createController = () => {
  const store = HS.createSettingsStore()
  let state = { active: false, run: 0 }
  let scene = null
  let coldStartConsumed = false
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }

  const stop = () => {
    scene?.dispose()
    scene = null
    state = { active: false, run: state.run }
    emit()
  }

  const play = (preview = false) => {
    if ((!preview && !store.get().enabled) || HS.prefersReducedMotion()) return false
    state = { active: true, run: state.run + 1 }
    emit()
    return true
  }

  return {
    settings: store,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mount: (container) => {
      scene?.dispose()
      try {
        const created = HS.createScene(store.get(), { onDone: stop })
        scene = created
        container.appendChild(created.element)
        created.play()
        return () => {
          created.dispose()
          if (scene === created) scene = null
        }
      } finally {
        window[bootGlobal]?.release()
      }
    },
    play,
    playColdStart: () => {
      if (coldStartConsumed) return
      coldStartConsumed = true
      if (window[bootGlobal]?.skipped || !play()) window[bootGlobal]?.release()
    },
    skip: () => scene?.skip(),
    dispose: stop,
    get scene() { return scene },
  }
}
