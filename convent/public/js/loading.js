// Counts what the game is still downloading (models, sounds) so the lobby can show a bar.
// track(promise) adds one item; a "loading" event on window carries { done, total }.
let done = 0;
let total = 0;
export const progress = () => ({ done, total });
export function track(p) {
  total++;
  const finish = () => {
    done++;
    window.dispatchEvent(new CustomEvent('loading', { detail: { done, total } }));
  };
  window.dispatchEvent(new CustomEvent('loading', { detail: { done, total } }));
  return Promise.resolve(p).finally(finish);
}
