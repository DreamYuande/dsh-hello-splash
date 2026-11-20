/**
 * dsh-hello-splash · Client half.
 *
 * Two registrations, both through public slots:
 *   shell.overlay      the splash layer itself (list slot, additive, click-through
 *                      until the layer opts in with pointer events)
 *   settings.section   a settings page with the preview button
 *
 * Nothing here touches host DOM, styles or core source: the whole effect lives
 * inside one overlay entry that disposes itself when the timeline ends.
 */
HS.Controller = HS.createController()

const h = HS.React.createElement

/** Subscribe to the splash controller. */
const useController = () => {
  const snapshot = HS.React.useSyncExternalStore
    ? HS.React.useSyncExternalStore(HS.Controller.subscribe, HS.Controller.getState, HS.Controller.getState)
    : HS.Controller.getState()
  return snapshot
}

/** Subscribe to the settings store. */
const useSettings = () => {
  const store = HS.Controller.settings
  const snapshot = HS.React.useSyncExternalStore
    ? HS.React.useSyncExternalStore(store.subscribe, store.get, store.get)
    : store.get()
  const status = HS.React.useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus)
  return [snapshot, store, status]
}

const STYLE_ID = `${HS.NS}-styles`
const styleText = `
.${HS.NS}-host { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
.${HS.NS}-root { position: absolute; }
.${HS.NS}-panel { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 18px; max-width: 640px; color: var(--dsh-color-text, #1f1f22); }
.${HS.NS}-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 9px 0; border-bottom: 1px solid var(--dsh-color-border-weak, rgba(128,128,140,.18)); }
.${HS.NS}-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.${HS.NS}-label { font-size: 13px; font-weight: 600; }
.${HS.NS}-hint { font-size: 12px; opacity: .62; }
.${HS.NS}-control { flex: none; display: flex; align-items: center; gap: 8px; }
.${HS.NS}-input { font: inherit; font-size: 13px; padding: 5px 9px; border-radius: 7px; border: 1px solid var(--dsh-color-border, rgba(128,128,140,.35)); background: var(--dsh-color-input-bg, rgba(127,127,140,.06)); color: inherit; min-width: 160px; }
.${HS.NS}-color { width: 40px; height: 26px; padding: 0; border-radius: 6px; border: 1px solid var(--dsh-color-border, rgba(128,128,140,.35)); background: none; }
.${HS.NS}-switch { width: 16px; height: 16px; accent-color: #6b6bd6; }
.${HS.NS}-btn { font: inherit; font-size: 13px; padding: 7px 14px; border-radius: 8px; cursor: pointer; border: 1px solid var(--dsh-color-border, rgba(128,128,140,.35)); background: var(--dsh-color-button-bg, rgba(127,127,140,.08)); color: inherit; }
.${HS.NS}-btn:hover { background: rgba(127,127,140,.16); }
.${HS.NS}-btn-primary { border-color: transparent; background: linear-gradient(90deg, #ECA52A, #EC7189 30%, #9272D8 65%, #2AA99D); color: #fff; font-weight: 600; }
.${HS.NS}-actions { display: flex; align-items: center; gap: 10px; padding-top: 4px; }
.${HS.NS}-note { font-size: 12px; opacity: .62; }
`

/** One settings surface: the overlay layer plus nothing else. */
function SplashOverlay() {
  const state = useController()
  const host = HS.React.useRef(null)
  HS.React.useLayoutEffect(() => {
    if (!state.active || !host.current) return undefined
    return HS.Controller.mount(host.current)
  }, [state.active, state.run])
  HS.React.useLayoutEffect(() => {
    const launch = window[launchGlobal]
    if (!launch?.animated) return undefined
    // The Windows animation stays on top until the main frame has painted.
    let painted = 0
    const frame = requestAnimationFrame(() => {
      painted = requestAnimationFrame(() => {
        void fetch(launchEndpoint, {
          method: 'POST',
          headers: { 'x-dsh-hello-launch': launch.id },
          cache: 'no-store',
        }).catch(() => {})
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(painted)
    }
  }, [])
  if (!state.active) return null
  return h('div', { className: `${HS.NS}-host`, ref: host, 'data-run': state.run })
}

/** A labelled settings row. */
function Row(props) {
  return h('div', { className: `${HS.NS}-row` },
    h('div', { className: `${HS.NS}-row-text` },
      h('span', { className: `${HS.NS}-label` }, props.label),
      props.hint ? h('span', { className: `${HS.NS}-hint` }, props.hint) : null),
    h('div', { className: `${HS.NS}-control` }, props.children))
}

/** The Playwright-safe settings page. */
function SplashSettings() {
  const [settings, store, status] = useSettings()
  const [draft, setDraft] = HS.React.useState(null)
  const text = draft ?? settings.text
  const valid = supportedText.test(text.trim())
  const commit = () => {
    if (valid && text.trim() !== settings.text) store.set({ text })
    if (valid) setDraft(null)
  }
  const set = (patch) => store.set(patch)
  const supported = HS.supportedCharacters()
  return h('div', { className: `${HS.NS}-panel` },
    h(Row, { label: '启用启动动画', hint: '控制下次打开 DSH Next 时是否自动播放。' },
      h('input', {
        className: `${HS.NS}-switch`, type: 'checkbox', checked: settings.enabled,
        onChange: (event) => set({ enabled: event.target.checked }),
      })),
    h(Row, { label: '欢迎文字', hint: `手写笔迹只覆盖已绘制的字母：${supported}` },
      h('input', {
        className: `${HS.NS}-input`, type: 'text', value: text, spellCheck: false, maxLength: 32, 'aria-invalid': !valid,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => { if (event.key === 'Enter') event.currentTarget.blur() },
      })),
    h(Row, { label: '背景颜色', hint: '启动层始终使用该纯色，不跟随深色主题。' },
      h('input', {
        className: `${HS.NS}-color`, type: 'color', value: settings.background,
        onChange: (event) => set({ background: event.target.value }),
      })),
    h(Row, { label: '动画时长', hint: `${(settings.duration / 1000).toFixed(1)} 秒（建议 3.0–4.0 秒）` },
      h('input', {
        className: `${HS.NS}-input`, type: 'range', min: 3000, max: 4000, step: 50, value: settings.duration,
        onChange: (event) => set({ duration: Number(event.target.value) }),
      })),
    h(Row, { label: '文字到 Logo 形变', hint: '关闭后使用简短的淡入淡出过渡。' },
      h('input', {
        className: `${HS.NS}-switch`, type: 'checkbox', checked: settings.morph,
        onChange: (event) => set({ morph: event.target.checked }),
      })),
    h(Row, { label: '显示品牌副标题', hint: 'Logo 下方显示 DeepSeek Harness Next。' },
      h('input', {
        className: `${HS.NS}-switch`, type: 'checkbox', checked: settings.subtitle,
        onChange: (event) => set({ subtitle: event.target.checked }),
      })),
    h(Row, { label: 'Esc 跳过', hint: '播放中按 Esc 立即安全结束动画。' },
      h('input', {
        className: `${HS.NS}-switch`, type: 'checkbox', checked: settings.escSkip,
        onChange: (event) => set({ escSkip: event.target.checked }),
      })),
    h(Row, { label: '文字渐变', hint: 'Apple 风格彩虹渐变（固定预设）。' },
      h('span', { className: `${HS.NS}-note` }, HS.RAINBOW.join(' · '))),
    h('div', { className: `${HS.NS}-actions` },
      h('button', {
        className: `${HS.NS}-btn ${HS.NS}-btn-primary`, type: 'button',
        disabled: !valid || HS.prefersReducedMotion(), onClick: () => { commit(); HS.Controller.play(true) },
      }, '预览启动动画'),
      h('button', {
        className: `${HS.NS}-btn`, type: 'button',
        onClick: () => { setDraft(null); store.reset() },
      }, '恢复默认'),
      h('span', { className: `${HS.NS}-note` }, valid ? status || '设置保存在当前 Profile。' : '请输入已有笔迹的字母、空格或句点。')))
}

/**
 * Client plugin body: register the overlay and the settings page, then play the
 * splash once for this page load.
 * @param {object} ctx Client plugin context.
 */
function apply(ctx) {
  if (!ctx || !ctx.slots) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = styleText
  document.head.appendChild(style)

  ctx.effect(() => () => {
    const node = document.getElementById(STYLE_ID)
    if (node && node.parentNode) node.parentNode.removeChild(node)
  }, 'hello-splash: styles')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'hello-splash',
    order: 900,
    inject: () => ({}),
  }, SplashOverlay)), 'hello-splash: overlay')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'hello-splash',
    order: 320,
    label: 'Welcome splash',
    inject: () => ({}),
  }, SplashSettings)), 'hello-splash: settings section')

  if (window[configGlobal] !== undefined && !window[launchGlobal]?.animated) HS.Controller.playColdStart()

  ctx.effect(() => {
    const api = {
      play: () => HS.Controller.play(),
      skip: () => HS.Controller.skip(),
      settings: () => HS.Controller.settings.get(),
      version: HS.VERSION,
    }
    window.__dshHelloSplash = api
    return () => {
      if (window.__dshHelloSplash === api) delete window.__dshHelloSplash
      window[bootGlobal]?.release()
      HS.Controller.dispose()
    }
  }, 'hello-splash: debug handle')
}

HS.apply = apply
HS.SplashOverlay = SplashOverlay
HS.SplashSettings = SplashSettings

