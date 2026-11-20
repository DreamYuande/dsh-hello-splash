/** The scene runs outside React so a host re-render cannot reset its clock. */
HS.RAINBOW = ['#ECA52A', '#EC7189', '#C76CC3', '#9272D8', '#528ED2', '#2AA99D']
HS.CANVAS = { width: 1200, height: 520, baseline: 300, centerX: 600, centerY: 250 }
HS.PHASES = { writeEnd: 2150, holdEnd: 2300, morphEnd: 3050, logoEnd: 3350 }

HS.sceneGeometry = (config) => {
  const { centerX, centerY } = HS.CANVAS
  const layout = HS.layoutText(config.text?.trim() || 'Welcome to DSH.')
  const line = layout.strokes.length ? layout : HS.layoutText('Welcome to DSH.')
  const scale = Math.min(1.3, 895 / line.width, 180 / (line.bottom - line.top))
  const center = (line.left + line.right) / 2
  const baseline = centerY - (line.top + line.bottom) * scale / 2
  const left = centerX - line.width * scale / 2
  const right = centerX + line.width * scale / 2
  const fish = { x: centerX, width: 276 }
  const fishScale = fish.width / HS.FISH_VIEWBOX.width
  fish.height = HS.FISH_VIEWBOX.height * fishScale
  fish.left = fish.x - fish.width / 2
  fish.top = centerY - fish.height / 2 - (config.subtitle === false ? 0 : 19)

  const strokes = line.strokes.map(({ points, dot }) => {
    const scenePoints = points.map(([x, y]) => [centerX + (x - center) * scale, baseline + y * scale])
    return {
      points: scenePoints,
      length: HS.lengthOf(scenePoints),
      width: Math.min(6.4, scale * (dot ? 5.5 : 4.8)),
    }
  })
  const total = strokes.reduce((sum, stroke) => sum + Math.max(stroke.length, 23), 0)
  let clock = 0
  const writing = strokes.map((stroke) => {
    const start = clock
    clock += Math.max(stroke.length, 23) / total * HS.PHASES.writeEnd
    return { points: HS.resample(stroke.points, 40), width: stroke.width, start, end: clock }
  })
  return { left, right, fish, fishScale, strokes, writing }
}

HS.createScene = (config, hooks = {}) => {
  const duration = config.duration || 3600
  const { width, height, centerX } = HS.CANVAS
  const { left, right, fish, fishScale, strokes, writing: pen } = HS.sceneGeometry(config)

  const root = HS.el('div', {
    class: HS.NS + '-root',
    'aria-hidden': 'true',
    style: [
      'position:absolute', 'inset:0', 'z-index:2147483000',
      'display:grid', 'place-items:center', 'pointer-events:auto', 'user-select:none',
      'background:' + (config.background || '#FFFFFF'),
    ].join(';'),
  })
  const svg = HS.svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width: '100%', height: '100%' })
  const defs = HS.svg('defs')
  const textLayer = HS.svg('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  const ribbonLayer = textLayer.cloneNode()
  ribbonLayer.style.display = 'none'
  const url = (name) => 'url(#' + HS.NS + '-' + name + ')'
  const gradient = HS.svg('linearGradient', { id: HS.NS + '-ink', gradientUnits: 'userSpaceOnUse' })
  const setColors = (progress) => {
    gradient.setAttribute('x1', HS.lerp(left, fish.left, progress))
    gradient.setAttribute('x2', HS.lerp(right, fish.left + fish.width, progress))
  }
  HS.RAINBOW.forEach((color, index) => {
    gradient.append(HS.svg('stop', { offset: index / (HS.RAINBOW.length - 1), 'stop-color': color }))
  })
  setColors(0)
  defs.append(gradient)
  svg.append(defs, textLayer, ribbonLayer)
  root.append(svg)

  const writing = pen.map(({ points, width, start, end }) => {
    const path = HS.svg('path', {
      d: HS.pathFrom(points),
      stroke: url('ink'),
      'stroke-width': width,
      pathLength: 1,
      'stroke-dasharray': '1 1',
      'stroke-dashoffset': 1,
      visibility: 'hidden',
    })
    textLayer.append(path)
    return { path, start, end, progress: 0 }
  })

  const mask = HS.svg('mask', {
    id: HS.NS + '-spread', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width, height,
  })
  const ink = HS.svg('g', {
    fill: 'none', stroke: 'white', 'stroke-width': 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  })
  mask.append(ink)
  defs.append(mask)
  const mark = HS.svg('g', { mask: url('spread'), visibility: 'hidden' })
  const fishShape = { d: HS.FISH_PATH, transform: 'translate(' + fish.left + ' ' + fish.top + ') scale(' + fishScale + ')' }
  // Apply the scene gradient in scene coordinates, even though the whale path
  // itself is defined in smaller coordinates.
  const clip = HS.svg('clipPath', { id: HS.NS + '-mark' })
  clip.append(HS.svg('path', fishShape))
  defs.append(clip)
  mark.append(HS.svg('rect', { width, height, fill: url('ink'), 'clip-path': url('mark') }))
  svg.append(mark)

  const subtitle = HS.svg('text', {
    x: centerX,
    y: fish.top + fish.height + 47,
    'text-anchor': 'middle',
    'font-family': '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
    'font-size': 20,
    'font-weight': 500,
    'letter-spacing': 3.2,
    fill: '#4A4A4F',
    opacity: 0,
  })
  subtitle.textContent = 'DeepSeek Harness Next'
  if (config.subtitle !== false) svg.append(subtitle)

  const morph = config.morph !== false
  const ribbons = morph ? HS.buildRibbons(strokes, fish, fishScale).map((ribbon, index) => {
    const id = HS.NS + '-ribbon-' + index
    const path = HS.svg('path', { id })
    defs.append(path)
    const visible = HS.svg('use', { href: '#' + id, stroke: url('ink'), 'stroke-width': ribbon.width })
    ribbonLayer.append(visible)
    ink.append(HS.svg('use', { href: '#' + id }))
    return { ...ribbon, path, visible }
  }) : []

  const paintWriting = (time) => {
    for (const stroke of writing) {
      const progress = HS.norm(time, stroke.start, stroke.end)
      if (progress === stroke.progress) continue
      stroke.progress = progress
      stroke.path.removeAttribute('visibility')
      if (progress === 1) {
        stroke.path.removeAttribute('stroke-dasharray')
        stroke.path.removeAttribute('stroke-dashoffset')
      } else {
        const eased = progress + Math.sin(progress * Math.PI * 2) * -0.025
        stroke.path.setAttribute('stroke-dashoffset', 1 - eased)
      }
    }
  }

  const paintMorph = (progress) => {
    ribbonLayer.style.display = ''
    textLayer.style.display = 'none'
    setColors(HS.smooth(progress))
    const spread = HS.smooth(HS.norm(progress, 0.65, 0.995))
    for (const ribbon of ribbons) {
      const phase = HS.norm(progress, ribbon.delay, 0.96)
      const mix = HS.smooth(phase)
      const lift = Math.sin(Math.PI * mix)
      for (let i = 0; i < ribbon.scratch.length; i += 1) {
        const from = ribbon.from[i]
        const to = ribbon.to[i]
        const point = ribbon.scratch[i]
        const along = i / (ribbon.scratch.length - 1)
        const wave = Math.sin(along * Math.PI * 2) * 7 * ribbon.twist
        point[0] = HS.lerp(from[0], to[0], mix) + wave * lift
        point[1] = HS.lerp(from[1], to[1], mix) + (ribbon.bend + wave) * lift
      }
      ribbon.path.setAttribute('d', HS.pathFrom(ribbon.scratch, 1))
      ribbon.visible.setAttribute('stroke-width', HS.lerp(ribbon.width, 3.5, mix))
    }
    if (spread > 0) {
      mark.removeAttribute('visibility')
      ink.setAttribute('stroke-width', 190 * spread)
      ribbonLayer.setAttribute('opacity', 1 - HS.smooth(HS.norm(progress, 0.91, 1)))
    }
  }

  let frame = 0
  let timeout = 0
  let origin
  let playing = false
  let disposed = false
  let settled = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    playing = false
    cancelAnimationFrame(frame)
    clearTimeout(timeout)
    window.removeEventListener('keydown', onKeyDown, true)
    root.remove()
  }

  const complete = () => {
    dispose()
    hooks.onDone?.()
  }

  const skip = () => {
    if (!playing) return
    playing = false
    cancelAnimationFrame(frame)
    window.removeEventListener('keydown', onKeyDown, true)
    root.style.pointerEvents = 'none'
    root.style.transition = 'opacity 160ms ease-out'
    root.style.opacity = '0'
    timeout = setTimeout(complete, 170)
  }

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || config.escSkip === false) return
    event.preventDefault()
    event.stopPropagation()
    skip()
  }

  const render = (now) => {
    if (!playing) return
    origin ??= now
    const time = (now - origin) * 3600 / duration
    if (time >= 3600) {
      complete()
      return
    }
    if (time < HS.PHASES.holdEnd) {
      paintWriting(time)
    } else if (time < HS.PHASES.morphEnd) {
      paintWriting(HS.PHASES.writeEnd)
      const progress = HS.norm(time, HS.PHASES.holdEnd, HS.PHASES.morphEnd)
      if (morph) {
        paintMorph(progress)
      } else {
        const reveal = HS.smooth(progress)
        setColors(reveal)
        mark.removeAttribute('mask')
        mark.removeAttribute('visibility')
        mark.setAttribute('opacity', reveal)
        textLayer.setAttribute('opacity', 1 - reveal)
      }
    } else {
      if (!settled) {
        settled = true
        setColors(1)
        textLayer.remove()
        ribbonLayer.remove()
        mark.removeAttribute('mask')
        mark.removeAttribute('visibility')
        mark.removeAttribute('opacity')
        defs.removeChild(mask)
      }
      subtitle.setAttribute('opacity', HS.smooth(HS.norm(time, 3050, 3200)))
      root.style.opacity = 1 - HS.smooth(HS.norm(time, HS.PHASES.logoEnd, 3600))
    }
    frame = requestAnimationFrame(render)
  }

  const play = () => {
    if (playing || disposed || origin !== undefined) return
    playing = true
    window.addEventListener('keydown', onKeyDown, true)
    frame = requestAnimationFrame(render)
  }

  return { element: root, play, skip, dispose }
}


