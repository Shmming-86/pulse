import { icon } from './utils.js';

let seq = 0;

export function toast(message, type = 'info', timeout = 3600) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.dataset.id = String(++seq);
  const symbol = type === 'error' ? 'warning' : type === 'success' ? 'check' : 'sparkle';
  el.innerHTML = `${icon(symbol, 14)}<span>${message}</span>`;
  stack.appendChild(el);

  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  setTimeout(remove, timeout);
  el.addEventListener('click', remove);
}
