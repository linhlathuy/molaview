import { icon } from './icons';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function iconButton(name: string, label: string, onClick: () => void, text?: string): HTMLButtonElement {
  const button = element('button', 'icon-button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  if (text) button.append(element('span', 'button-text', text));
  button.addEventListener('click', onClick);
  return button;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
