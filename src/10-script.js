/**
 * Hand-drawn centre lines for “Welcome to DSH.”. Paths are in pen order.
 * The lowercase joins share the same height and tangent. Word spaces and the
 * separately written capital strokes are deliberate pen lifts.
 */
HS.glyphs = {
  W: { advance: 115, pen: [
    'M0 -76 C9 -95 34 -106 43 -94 C53 -82 26 -32 29 -13 C32 9 52 -21 66 -50 C73 -64 79 -76 83 -76 C86 -73 66 -31 69 -14 C73 12 106 -40 113 -73 C115 -82 114 -91 111 -96',
  ] },
  e: { advance: 35, pen: [
    'M0 -8 C15 -17 37 -36 31 -48 C25 -59 9 -42 6 -26 C2 -9 11 5 26 -2 C29 -3 32 -5 35 -8',
  ] },
  l: { advance: 37, pen: [
    'M0 -8 C21 -23 54 -81 44 -91 C35 -101 19 -74 12 -48 C7 -27 6 -10 15 -3 C21 2 29 -1 37 -8',
  ] },
  c: { advance: 40, pen: [
    'M0 -8 C8 -17 12 -43 25 -48 C33 -51 37 -45 32 -39 C30 -38 29 -37 27 -37 C37 -52 18 -49 10 -33 C0 -13 11 3 25 -1 C31 -2 35 -5 40 -8',
  ] },
  o: { advance: 44, pen: [
    'M0 -8 C7 -18 12 -43 25 -49 C36 -54 43 -46 39 -29 C35 -10 24 2 13 -1 C-2 -6 7 -32 18 -43 C23 -49 29 -50 32 -47 C27 -30 36 -16 44 -8',
  ] },
  m: { advance: 77, pen: [
    'M0 -8 C9 -14 16 -41 24 -47 C34 -54 27 -24 22 -7 C20 0 19 0 21 -6 C29 -24 38 -49 49 -47 C58 -46 49 -19 46 -7 C43 1 44 0 47 -7 C55 -26 64 -50 73 -46 C82 -42 68 -20 67 -9 C65 0 70 -1 77 -8',
  ] },
  t: { advance: 35, pen: [
    'M0 -8 C12 -20 31 -64 32 -75 C30 -80 24 -68 19 -55 C12 -39 5 -17 9 -7 C12 3 25 0 35 -8',
    'M5 -42 C17 -46 29 -48 40 -47',
  ], deferred: 1 },
  D: { advance: 83, pen: [
    'M35 -88 C29 -76 25 -55 21 -35 C17 -17 12 -3 6 0',
    'M5 -72 C18 -96 52 -99 67 -82 C86 -60 68 -24 46 -9 C29 3 9 6 3 -1 C-4 -10 10 -19 22 -16 C31 -14 38 -8 46 -3',
  ] },
  S: { advance: 75, pen: [
    'M69 -83 C68 -98 41 -99 26 -87 C8 -73 17 -61 37 -50 C60 -38 67 -24 51 -9 C36 6 10 7 4 -6 C-1 -16 13 -24 27 -20',
  ] },
  H: { advance: 91, pen: [
    'M0 -77 C12 -90 28 -97 34 -89 C41 -81 27 -50 18 -32 C12 -19 8 -9 5 -2',
    'M85 -95 C72 -91 58 -59 51 -34 C44 -13 47 -1 62 -1 C73 -1 84 -9 89 -19',
    'M1 -46 C13 -43 26 -48 39 -51 C53 -55 66 -57 76 -53',
  ] },
  '.': { advance: 13, pen: ['M4 -2 C4.5 -2.1 5 -2.4 5.5 -2.9'], dot: true },
  ' ': { advance: 37, pen: [] },
}

HS.supportedCharacters = () => Object.keys(HS.glyphs).filter((char) => char !== ' ').join(' ')

HS.layoutText = (text) => {
  const strokes = []
  let deferred = []
  let penX = 0
  let previous = ''
  const flush = () => {
    strokes.push(...deferred)
    deferred = []
  }

  for (const char of text) {
    const glyph = HS.glyphs[char]
    if (!glyph) continue
    if (char === ' ') flush()
    if (previous === 'W' && char === 'e') penX -= 9
    if (char === '.' && previous === 'H') penX -= 6
    glyph.pen.forEach((path, index) => {
      const points = HS.samplePath(path, 12).subpaths[0].map(([x, y]) => [x + penX, y])
      const stroke = { char, points, dot: glyph.dot === true, lift: index > 0 }
      if (index === glyph.deferred) deferred.push(stroke)
      else strokes.push(stroke)
    })
    penX += glyph.advance
    previous = char
  }
  flush()

  const points = strokes.flatMap((stroke) => stroke.points)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.min(...xs, 0)
  const right = Math.max(...xs, 0)
  return {
    strokes,
    left,
    right,
    width: right - left,
    top: Math.min(...ys, 0),
    bottom: Math.max(...ys, 0),
  }
}

/** Helpers used by the existing geometry comparison page. */
HS.arc = (cx, cy, rx, ry, start, end, steps = 18) =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (start + (end - start) * index / steps) * Math.PI / 180
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]
  })

HS.flattenSegments = (segments, samples = 8) =>
  segments.flatMap((segment) => HS.catmullRom(segment, samples))
