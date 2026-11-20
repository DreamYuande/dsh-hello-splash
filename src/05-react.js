/**
 * dsh-hello-splash · React access.
 *
 * The DSH Client module table supplies React to the bundle factory; the local
 * development stage has none, so this stays a null-safe probe instead of a
 * hard dependency, and every source file below works in both places.
 */
HS.React = typeof React !== 'undefined' ? React : null