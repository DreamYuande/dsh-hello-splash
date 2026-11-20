export const configEndpoint = '/plugin-api/hello-splash/config'
export const configGlobal = '__dshHelloSplashConfig'
export const bootGlobal = '__dshHelloSplashBoot'
export const launchGlobal = '__dshHelloSplashLaunch'
export const launchEndpoint = '/plugin-api/hello-splash/launch-ready'
export const legacyKey = 'dsh.hello-splash.settings.v1'
export const supportedText = /^[WelcomtDSH. ]{1,32}$/

export const defaultSettings = Object.freeze({
  enabled: true,
  text: 'Welcome to DSH.',
  background: '#FFFFFF',
  duration: 3600,
  gradient: 'apple',
  morph: true,
  subtitle: true,
  escSkip: true,
})

export function normalizeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration)
    ? Math.max(3000, Math.min(4000, Math.round(raw.duration))) : defaultSettings.duration
  let background = typeof raw.background === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw.background)
    ? raw.background.toUpperCase() : defaultSettings.background
  if (background.length === 4) background = background.replace(/[^#]/g, '$&$&')
  return {
    enabled: raw.enabled !== false,
    text: supportedText.test(text) ? text : defaultSettings.text,
    background,
    duration,
    gradient: defaultSettings.gradient,
    morph: raw.morph !== false,
    subtitle: raw.subtitle !== false,
    escSkip: raw.escSkip !== false,
  }
}

