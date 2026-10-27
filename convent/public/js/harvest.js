// The pumpkin patch: six pumpkins in the graveyard, all drawn exactly the same. The winner picks one;
// the server draws the prize pumpkin (see Game.pickPumpkin), and every screen shows the reveal.
const PUMPKIN = (i) => `
<svg viewBox="0 0 100 92" aria-hidden="true">
  <defs>
    <radialGradient id="pk-body-${i}" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#ff9a3c"/><stop offset="0.6" stop-color="#e2641a"/><stop offset="1" stop-color="#7a2c0a"/></radialGradient>
  </defs>
  <ellipse cx="50" cy="86" rx="34" ry="5" fill="rgba(0,0,0,0.5)"/>
  <ellipse cx="29" cy="54" rx="22" ry="30" fill="url(#pk-body-${i})"/>
  <ellipse cx="71" cy="54" rx="22" ry="30" fill="url(#pk-body-${i})"/>
  <ellipse cx="40" cy="54" rx="22" ry="32" fill="url(#pk-body-${i})"/>
  <ellipse cx="60" cy="54" rx="22" ry="32" fill="url(#pk-body-${i})"/>
  <ellipse cx="50" cy="54" rx="19" ry="33" fill="url(#pk-body-${i})"/>
  <path d="M40 26 Q36 54 40 82 M60 26 Q64 54 60 82 M50 22 Q50 54 50 86" stroke="rgba(90,30,5,0.45)" stroke-width="2" fill="none"/>
  <path d="M46 24 Q48 10 56 8 L60 12 Q54 16 54 25 Z" fill="#4c5a24"/>
  <path d="M56 12 Q70 8 72 18" stroke="#5f7a2c" stroke-width="2.4" fill="none" stroke-linecap="round"/>
</svg>`;
const STONE = `<svg viewBox="0 0 40 60" aria-hidden="true"><path d="M4 60 V22 Q4 4 20 4 Q36 4 36 22 V60 Z" fill="#14120f"/><path d="M20 16 V34 M13 24 H27" stroke="#2a2620" stroke-width="3" fill="none"/></svg>`;

export function patchHTML(count) {
  const pk = Array.from({ length: count }, (_, i) => `<button type="button" class="pk" data-i="${i}" aria-label="Pumpkin ${i + 1}" disabled><span class="pk-art">${PUMPKIN(i)}</span><span class="pk-inside"></span></button>`).join('');
  return `<div class="patch"><div class="moon"></div><div class="stones"><i>${STONE}</i><i>${STONE}</i><i>${STONE}</i><i>${STONE}</i></div><div class="fog f1"></div><div class="fog f2"></div><div class="pks">${pk}</div></div>`;
}

// put the patch in el. interactive: the winner's screen, where a click picks that pumpkin
export function mountPatch(el, count, { interactive = false, onPick = () => {} } = {}) {
  el.innerHTML = patchHTML(count);
  const btns = [...el.querySelectorAll('.pk')];
  for (const b of btns) {
    b.disabled = !interactive;
    if (interactive) b.addEventListener('click', () => onPick(Number(b.dataset.i)), { once: true });
  }
  el.classList.toggle('pickable', interactive);
}

// the reveal, the same on every screen: the picked pumpkin splits open, then the others do.
// r: { pick, numbers, prizeAt, won, text }: a number from 1 to 6 inside each, and the 6 is the prize
export function reveal(el, r) {
  const btns = [...el.querySelectorAll('.pk')];
  el.classList.remove('pickable');
  for (const b of btns) b.disabled = true;
  const open = (i, prize) => {
    const b = btns[i];
    if (!b) return;
    b.classList.add('open', prize ? 'prize' : 'empty');
    b.querySelector('.pk-inside').textContent = r.numbers ? r.numbers[i] : '';
  };
  btns[r.pick]?.classList.add('picked');
  setTimeout(() => open(r.pick, r.won), 900);
  // after the pick, the rest are shown too, so everyone can see where the prize was
  setTimeout(() => btns.forEach((_, i) => i !== r.pick && open(i, i === r.prizeAt)), 2600);
}
