// The ten costumes as cut-paper silhouettes (head and shoulders, in a 100 x 100 box), for the join
// screen, the lobby and the windows of the house on the big screen. Same order as C.COSTUMES and the
// "player" models in models.json. Each is a few shapes; "cut" shapes are holes (eyes, a visor slit).
import { COSTUMES } from '/shared/config.js';

const shoulders = (w = 36, y = 74) => `<path d="M${50 - w} 101 C${50 - w + 2} ${y + 8} ${50 - w / 2} ${y} 50 ${y} C${50 + w / 2} ${y} ${50 + w - 2} ${y + 8} ${50 + w} 101 Z"/>`;
const neck = '<rect x="44" y="60" width="12" height="18"/>';
const head = (cx = 50, cy = 52, r = 13) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const eyes = (y = 52, dx = 5, r = 1.8) => `<circle cx="${50 - dx}" cy="${y}" r="${r}"/><circle cx="${50 + dx}" cy="${y}" r="${r}"/>`;

const SIL = [
  // wizard: a tall crooked hat with a star, and a long beard
  {
    shapes: shoulders() + neck + head() + '<ellipse cx="50" cy="41" rx="27" ry="4.5"/><path d="M34 41 Q42 24 50 4 Q55 22 66 41 Z"/><path d="M38 56 Q40 88 50 92 Q60 88 62 56 Z"/>',
    cut: '<path d="M50 20 L52 25 L57 25 L53 28 L55 33 L50 30 L45 33 L47 28 L43 25 L48 25 Z"/>' + eyes(51),
  },
  // pirate queen: a tricorn with a feather, long hair
  {
    shapes: '<path d="M34 50 Q28 74 30 84 L70 84 Q72 74 66 50 Z"/>' + shoulders() + neck + head() + '<path d="M20 41 Q50 26 80 41 Q66 37 50 40 Q34 37 20 41 Z"/><path d="M34 40 Q50 18 66 40 Z"/><path d="M60 30 Q74 14 84 12 Q76 22 64 34 Z"/>',
    cut: eyes(52) + '<circle cx="50" cy="32" r="2.6"/>',
  },
  // pirate: a tricorn, a beard and an eye patch
  {
    shapes: shoulders(38) + neck + head() + '<path d="M18 41 Q50 26 82 41 Q66 37 50 40 Q34 37 18 41 Z"/><path d="M33 40 Q50 17 67 40 Z"/><path d="M38 56 Q50 74 62 56 Z"/>',
    cut: '<path d="M37 45 L64 56 L63.4 57.6 L36.4 46.6 Z"/><circle cx="56" cy="51" r="1.9"/><circle cx="50" cy="31" r="2.6"/>',
  },
  // ninja: hooded and masked, only the eyes showing, the headband's tails flying
  {
    shapes: shoulders() + neck + head(50, 51, 15) + '<path d="M63 45 L86 36 L82 43 L88 48 L64 50 Z"/>',
    cut: '<rect x="38" y="48" width="24" height="5.5" rx="2.7"/>',
  },
  // viking: a round helmet with horns, two long braids
  {
    shapes: '<rect x="33" y="50" width="7" height="34" rx="3.5"/><rect x="60" y="50" width="7" height="34" rx="3.5"/>' + shoulders() + neck + head() + '<path d="M35 46 Q35 30 50 30 Q65 30 65 46 Z"/><path d="M37 38 Q22 36 18 16 Q28 30 40 32 Z"/><path d="M63 38 Q78 36 82 16 Q72 30 60 32 Z"/>',
    cut: eyes(53),
  },
  // knight: a closed helmet with a plume
  {
    shapes: shoulders(38) + neck + '<path d="M36 68 L36 42 Q36 27 50 27 Q64 27 64 42 L64 68 Q50 72 36 68 Z"/><path d="M50 28 Q55 10 72 6 Q62 16 57 29 Z"/>',
    cut: '<rect x="39" y="45" width="22" height="3.6" rx="1"/><rect x="48.6" y="51" width="2.8" height="13"/>',
  },
  // cowgirl: a cowboy hat with an upturned brim, bunches of hair
  {
    shapes: shoulders() + neck + '<circle cx="35" cy="61" r="6"/><circle cx="65" cy="61" r="6"/>' + head(50, 53, 13) + '<path d="M14 36 Q22 45 50 45 Q78 45 86 36 Q82 48 50 49 Q18 48 14 36 Z"/><path d="M36 44 L38 25 Q44 21 50 25 Q56 21 62 25 L64 44 Z"/>',
    cut: eyes(54),
  },
  // witch: the tall bent hat with its wide brim
  {
    shapes: '<path d="M36 46 Q31 66 33 76 L67 76 Q69 66 64 46 Z"/>' + shoulders() + neck + head(50, 54, 13) + '<ellipse cx="50" cy="43" rx="35" ry="5"/><path d="M35 43 Q40 28 54 15 Q63 7 76 4 Q63 14 60 27 L65 43 Z"/>',
    cut: eyes(55) + '<rect x="45" y="36" width="10" height="4.6"/>',
  },
  // chef: the puffed white hat, a neckerchief
  {
    shapes: shoulders() + neck + head(50, 54, 13) + '<circle cx="39" cy="22" r="10"/><circle cx="50" cy="17" r="11"/><circle cx="61" cy="22" r="10"/><rect x="37" y="22" width="26" height="20"/><path d="M40 73 L60 73 L50 86 Z"/>',
    cut: eyes(55) + '<path d="M42 61 Q46 58 50 61 Q54 58 58 61 Q54 63 50 62 Q46 63 42 61 Z"/><rect x="37" y="36" width="26" height="1.8"/>',
  },
  // doctor: hair in a bun, round spectacles, the round head mirror on her brow, a stethoscope
  {
    shapes: shoulders() + neck + '<circle cx="62" cy="42" r="6.5"/>' + head() + '<path d="M37 50 Q37 37 50 37 Q63 37 63 50 Q58 43 50 43 Q42 43 37 50 Z"/><circle cx="50" cy="38" r="7"/>',
    cut: '<circle cx="50" cy="38" r="4.6" fill="none" stroke="#000" stroke-width="1.6"/><g fill="none" stroke="#000" stroke-width="1.6"><circle cx="44" cy="53" r="3.8"/><circle cx="56" cy="53" r="3.8"/></g><path d="M36 101 Q34 82 42 76 L44 78 Q38 84 39 101 Z"/><path d="M64 101 Q66 82 58 76 L56 78 Q62 84 61 101 Z"/>',
  },
];

let uid = 0;
// the silhouette as an SVG string, filled with the current text colour (or `fill`)
export function costumeSVG(i, fill = 'currentColor') {
  const s = SIL[((i % SIL.length) + SIL.length) % SIL.length];
  const id = 'cut' + uid++;
  return `<svg class="sil" viewBox="0 0 100 100" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><mask id="${id}"><rect width="100" height="100" fill="#fff"/><g fill="#000">${s.cut}</g></mask></defs><g fill="${fill}" mask="url(#${id})">${s.shapes}</g></svg>`;
}
// as an image, for drawing on a canvas
const images = new Map();
export function costumeImage(i, fill) {
  const k = i + fill;
  if (!images.has(k)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(costumeSVG(i, fill));
    images.set(k, img);
  }
  return images.get(k);
}
export const costumeName = (i) => (COSTUMES[i] || COSTUMES[0]).name;
