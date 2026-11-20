/**
 * dsh-hello-splash · core math + SVG helpers.
 * Shared by the Client plugin bundle and the local development stage.
 * Plain ES2019: no imports, no build-time dependencies.
 */
const HS = {
  /** @type {string} package id, also used as the CSS/DOM namespace root */
  ID: 'dsh-hello-splash',
  /** @type {string} style namespace prefix */
  NS: 'dshhs',
  /** @type {string} plugin version, reported by the debug handle */
  VERSION: '1.4.1',
}

/** Clamp a number into a closed range. */
HS.clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

/** Linear interpolation. */
HS.lerp = (a, b, t) => a + (b - a) * t

/** Map `v` from [a,b] to [0,1], clamped. */
HS.norm = (v, a, b) => (b === a ? 0 : HS.clamp((v - a) / (b - a), 0, 1))

/** Smoothstep easing (symmetric, zero derivative at both ends). */
HS.smooth = (t) => {
  const x = HS.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Cubic in/out — soft start and soft stop, used for the morph. */
HS.easeInOutCubic = (t) => {
  const x = HS.clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Cubic out — fast start, gentle stop, used for the write and the reveal. */
HS.easeOutCubic = (t) => 1 - Math.pow(1 - HS.clamp(t, 0, 1), 3)

/** Cubic in — gentle start, fast stop, used for the layer fade. */
HS.easeInCubic = (t) => Math.pow(HS.clamp(t, 0, 1), 3)

/**
 * Expand a polyline through Catmull-Rom spline sampling.
 * @param {number[][]} points control points
 * @param {number} perSegment samples between two consecutive control points
 * @returns {number[][]} dense polyline
 */
HS.catmullRom = (points, perSegment = 12) => {
  if (points.length < 3) return points.map((p) => [p[0], p[1]])
  const pts = [points[0], ...points, points[points.length - 1]]
  const out = []
  for (let i = 0; i < pts.length - 3; i += 1) {
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const p2 = pts[i + 2]
    const p3 = pts[i + 3]
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment
      const t2 = t * t
      const t3 = t2 * t
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      out.push([x, y])
    }
  }
  out.push([points[points.length - 1][0], points[points.length - 1][1]])
  return out
}

/** Total length of a polyline. */
HS.lengthOf = (points) => {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return total
}

/**
 * Resample a polyline to exactly `count` points spaced evenly along its length.
 * @param {number[][]} points source polyline
 * @param {number} count target point count
 * @returns {number[][]} resampled polyline (always `count` points)
 */
HS.resample = (points, count) => {
  const n = Math.max(2, count | 0)
  if (points.length < 2) {
    const p = points[0] ?? [0, 0]
    return Array.from({ length: n }, () => [p[0], p[1]])
  }
  const total = HS.lengthOf(points)
  if (total === 0) return Array.from({ length: n }, () => [points[0][0], points[0][1]])
  const step = total / (n - 1)
  const out = [[points[0][0], points[0][1]]]
  let index = 1
  let carried = 0
  let cursor = points[0]
  while (out.length < n && index < points.length) {
    const next = points[index]
    const segment = Math.hypot(next[0] - cursor[0], next[1] - cursor[1])
    if (carried + segment >= step && segment > 0) {
      const need = step - carried
      const ratio = need / segment
      const point = [cursor[0] + (next[0] - cursor[0]) * ratio, cursor[1] + (next[1] - cursor[1]) * ratio]
      out.push(point)
      cursor = point
      carried = 0
      continue
    }
    carried += segment
    cursor = next
    index += 1
  }
  while (out.length < n) out.push([points[points.length - 1][0], points[points.length - 1][1]])
  return out
}

/**
 * Point-wise interpolation between two equally sized point arrays.
 * @param {number[][]} a from
 * @param {number[][]} b to
 * @param {number} t 0..1
 * @param {number[][]} out reusable output array
 */
HS.blend = (a, b, t, out) => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const target = out[i] ?? (out[i] = [0, 0])
    target[0] = a[i][0] + (b[i][0] - a[i][0]) * t
    target[1] = a[i][1] + (b[i][1] - a[i][1]) * t
  }
  out.length = n
  return out
}

/**
 * Build smooth SVG path data from a polyline using quadratic midpoint smoothing.
 * Rounded control-point joins keep the hand-written line soft without overshoot.
 * @param {number[][]} points
 * @param {number} [decimals] coordinate precision
 */
HS.pathFrom = (points, decimals = 2) => {
  if (!points || points.length === 0) return ''
  const f = (v) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(decimals))
  if (points.length === 1) return `M${f(points[0][0])} ${f(points[0][1])}`
  if (points.length === 2) return `M${f(points[0][0])} ${f(points[0][1])}L${f(points[1][0])} ${f(points[1][1])}`
  let d = `M${f(points[0][0])} ${f(points[0][1])}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const mx = (points[i][0] + points[i + 1][0]) / 2
    const my = (points[i][1] + points[i + 1][1]) / 2
    d += `Q${f(points[i][0])} ${f(points[i][1])} ${f(mx)} ${f(my)}`
  }
  const last = points[points.length - 1]
  d += `T${f(last[0])} ${f(last[1])}`
  return d
}

/** Create an SVG element with attributes. */
HS.svg = (tag, attrs) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]))
  return node
}

/** Create an HTML element with attributes, optional text, and children. */
HS.el = (tag, attrs, children) => {
  const node = document.createElement(tag)
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key]
      if (value === undefined || value === null || value === false) continue
      if (key === 'text') node.textContent = String(value)
      else if (key === 'style') node.setAttribute('style', String(value))
      else node.setAttribute(key, value === true ? '' : String(value))
    }
  }
  if (children) for (const child of children) if (child) node.appendChild(child)
  return node
}

/** True when the platform asks for reduced motion. */
HS.prefersReducedMotion = () => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}







