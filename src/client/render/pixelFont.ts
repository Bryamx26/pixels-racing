/** Police bitmap 3×5 pour les textes dessinés dans le canvas (compte à rebours, combos…). */
const GLYPHS: Record<string, string> = {
  '0': '010101101101010', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '111101101101111', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '!': '010010010000010', '%': '101001010100101', '.': '000000000000010', '-': '000000111000000',
  '?': '110001010000010', ':': '000010000010000', "'": '010010000000000', '+': '000010111010000',
  ' ': '000000000000000',
};

const normalize = (t: string) => t.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function textWidth(text: string, scale = 1): number {
  return normalize(text).length * 4 * scale - scale;
}

/** Dessine du texte pixel ; `align` centre horizontalement si 'center'. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { scale?: number; color?: string; shadow?: string; align?: 'left' | 'center' } = {},
): void {
  const scale = opts.scale ?? 1;
  const t = normalize(text);
  const cx = Math.round(opts.align === 'center' ? x - textWidth(t, scale) / 2 : x);
  const cy = Math.round(y);
  const pass = (ox: number, oy: number, color: string) => {
    ctx.fillStyle = color;
    let px = cx + ox;
    for (const ch of t) {
      const g = GLYPHS[ch] ?? GLYPHS['?'];
      for (let i = 0; i < 15; i++) {
        if (g[i] === '1') ctx.fillRect(px + (i % 3) * scale, cy + oy + Math.floor(i / 3) * scale, scale, scale);
      }
      px += 4 * scale;
    }
  };
  if (opts.shadow) pass(scale, scale, opts.shadow);
  pass(0, 0, opts.color ?? '#fff');
}
