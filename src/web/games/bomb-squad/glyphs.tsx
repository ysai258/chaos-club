/**
 * Glyph Pad symbols for Bomb Squad.
 *
 * 27 original abstract symbols (ids 0..26) drawn on a 48x48 grid. The defuser
 * sees four of them on their phone; the experts find them in the manual's
 * columns from spoken descriptions. Several glyphs come in look-alike pairs
 * (mirrored, flipped, with or without a dot) on purpose: they are easy to tell
 * apart when you can see them and hard to tell apart when someone describes them.
 *
 * Each glyph is stroked outlines (`paths`) plus small filled dots (`dots`).
 */

type Dot = readonly [x: number, y: number];

interface GlyphSpec {
  readonly paths: readonly string[];
  readonly dots?: readonly Dot[];
}

/** A full circle as a path `d` string. */
function ring(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

const GLYPHS: readonly GlyphSpec[] = [
  // 0: four-tined fork, tines up
  { paths: ['M12 5 V17 Q12 25 24 25 Q36 25 36 17 V5', 'M20 5 V18', 'M28 5 V18', 'M24 25 V43'] },
  // 1: four-tined fork upside down, balancing a crescent moon
  {
    paths: [
      'M12 43 V33 Q12 25 24 25 Q36 25 36 33 V43',
      'M20 43 V32',
      'M28 43 V32',
      'M24 25 V17',
      'M14 5 A10 10 0 0 0 34 5 Q24 12 14 5 Z',
    ],
  },
  // 2: eye inside a triangle
  {
    paths: ['M24 5 L43 40 H5 Z', 'M14 30 Q24 20 34 30 Q24 38 14 30 Z'],
    dots: [[24, 30]],
  },
  // 3: eye inside an upside-down triangle
  {
    paths: ['M5 8 H43 L24 43 Z', 'M14 18 Q24 8 34 18 Q24 26 14 18 Z'],
    dots: [[24, 18]],
  },
  // 4: lightning bolt leaning right, dot top-right
  { paths: ['M28 4 L13 24 H35 L20 44'], dots: [[39, 8]] },
  // 5: mirrored lightning bolt leaning left, dot bottom-left
  { paths: ['M20 4 L35 24 H13 L28 44'], dots: [[9, 40]] },
  // 6: cup on three legs
  {
    paths: ['M9 8 H39 Q39 27 24 27 Q9 27 9 8 Z', 'M16 24 L12 42', 'M24 27 V42', 'M32 24 L36 42'],
  },
  // 7: jellyfish: dome with three wavy tentacles
  {
    paths: [
      'M8 23 Q8 5 24 5 Q40 5 40 23 Z',
      'M14 23 Q10 29 14 34 T14 43',
      'M24 23 Q20 29 24 34 T24 43',
      'M34 23 Q30 29 34 34 T34 43',
    ],
  },
  // 8: big clockwise spiral
  {
    paths: [
      'M24 24 A3 3 0 0 1 30 24 A6 6 0 0 1 18 24 A9 9 0 0 1 36 24 A12 12 0 0 1 12 24 A15 15 0 0 1 42 24',
    ],
  },
  // 9: snail: small counter-clockwise spiral with a flat tail
  {
    paths: ['M28 22 A3 3 0 0 0 22 22 A6 6 0 0 0 34 22 A9 9 0 0 0 16 22 A12 12 0 0 0 40 22 V38 H6'],
  },
  // 10: ladder with a broken, slanted bottom rung
  { paths: ['M14 5 V43', 'M34 5 V43', 'M14 12 H34', 'M14 22 H34', 'M14 32 L34 39'] },
  // 11: hourglass with a grain of sand at the bottom
  { paths: ['M10 6 H38 L10 42 H38 Z'], dots: [[24, 37]] },
  // 12: half sun with two rays and a dot inside
  {
    paths: ['M8 36 A16 16 0 0 1 40 36 Z', 'M24 14 V6', 'M10 22 L5 17'],
    dots: [[24, 30]],
  },
  // 13: sideways lollipop: ring on the left, stick with fishbone ticks
  { paths: [ring(11, 24, 7), 'M18 24 H43', 'M26 24 L31 15', 'M26 24 L31 33', 'M35 24 L40 15', 'M35 24 L40 33'] },
  // 14: two humps over a flat line
  { paths: ['M6 32 Q15 6 24 32 Q33 6 42 32', 'M6 41 H42'] },
  // 15: wave crossing a flat line, dot under the first hump
  { paths: ['M5 24 H43', 'M6 24 Q15 2 24 24 T42 24'], dots: [[15, 31]] },
  // 16: square maze spiral
  { paths: ['M8 42 V8 H40 V34 H18 V18 H30 V26'] },
  // 17: two overlapping rings with a dot where they meet
  { paths: [ring(18, 19, 11), ring(30, 29, 11)], dots: [[24, 24]] },
  // 18: rake: handle, bar and five teeth of alternating length
  { paths: ['M24 4 V16', 'M7 16 H41', 'M7 16 V28', 'M15.5 16 V36', 'M24 16 V28', 'M32.5 16 V36', 'M41 16 V28'] },
  // 19: balloon on a three-toed foot
  { paths: [ring(24, 10, 6), 'M24 16 V28', 'M24 28 L11 42', 'M24 28 V43', 'M24 28 L37 42'] },
  // 20: teardrop pointing up with a plus inside
  {
    paths: ['M24 4 C24 4 38 21 38 29 A14 14 0 0 1 10 29 C10 21 24 4 24 4 Z', 'M24 24 V34', 'M19 29 H29'],
  },
  // 21: teardrop lying sideways, point to the right, dot inside
  {
    paths: ['M44 24 C44 24 27 38 19 38 A14 14 0 0 1 19 10 C27 10 44 24 44 24 Z'],
    dots: [[19, 24]],
  },
  // 22: lopsided crown with a dot floating over the left dip
  { paths: ['M6 40 L10 16 L18 30 L25 10 L32 30 L41 18 L42 40 Z'], dots: [[17, 9]] },
  // 23: box cut corner-to-corner bottom-left to top-right, dot top-left
  { paths: ['M8 8 H40 V40 H8 Z', 'M8 40 L40 8'], dots: [[16, 16]] },
  // 24: box cut corner-to-corner top-left to bottom-right, dot top-right
  { paths: ['M8 8 H40 V40 H8 Z', 'M8 8 L40 40'], dots: [[32, 16]] },
  // 25: snake: hollow head with an eye, wavy body
  {
    paths: [ring(10, 24, 5.5), 'M15.5 24 Q21 14 27 24 T39 24 L43 19'],
    dots: [[10, 24]],
  },
  // 26: cactus with arms at different heights
  { paths: ['M24 43 V6', 'M24 31 H13 V19', 'M24 23 H35 V11'] },
];

export const GLYPH_COUNT = 27;

export function Glyph({ id, size = 48, className }: { id: number; size?: number; className?: string }) {
  const spec = GLYPHS[id];
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {spec === undefined ? (
        <text x="24" y="34" textAnchor="middle" fontSize="30" fill="currentColor" stroke="none">
          ?
        </text>
      ) : (
        <>
          {spec.paths.map((d, i) => (
            <path key={`p${i}`} d={d} />
          ))}
          {(spec.dots ?? []).map(([x, y], i) => (
            <circle key={`d${i}`} cx={x} cy={y} r={2.6} fill="currentColor" stroke="none" />
          ))}
        </>
      )}
    </svg>
  );
}
