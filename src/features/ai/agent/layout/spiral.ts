/** Deterministic expanding rectangular spiral of candidate offsets. */
export function* spiralOffsets(
  step: number,
  maxRings: number,
): Generator<{ dx: number; dy: number }> {
  yield { dx: 0, dy: 0 };
  for (let ring = 1; ring <= maxRings; ring++) {
    const s = step * ring;
    for (let i = -ring; i <= ring; i++) yield { dx: s, dy: step * i };
    for (let i = ring - 1; i >= -ring; i--) yield { dx: step * i, dy: -s };
    for (let i = -ring + 1; i <= ring; i++) yield { dx: -s, dy: step * i };
    for (let i = ring - 1; i >= -ring + 1; i--) yield { dx: step * i, dy: s };
  }
}
