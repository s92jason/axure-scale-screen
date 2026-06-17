import { afterEach, describe, expect, it, vi } from 'vitest';
import { hidePromptCard, showPromptCard } from '../../src/content/promptCard';

const HOST_ID = 'axure-scale-prompt-host';

function shadow(): ShadowRoot {
  const host = document.getElementById(HOST_ID);
  if (!host || !host.shadowRoot) {
    throw new Error('prompt host not found');
  }
  return host.shadowRoot;
}

const noop = (): void => {};

afterEach(() => {
  hidePromptCard();
});

describe('promptCard', () => {
  it('shows then hides', () => {
    showPromptCard({ name: 'X', onAdd: noop, onSkip: noop, onIgnore: noop });
    expect(document.getElementById(HOST_ID)).not.toBeNull();
    hidePromptCard();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('prefills the name and fires onAdd with the edited value, then closes', () => {
    const onAdd = vi.fn();
    showPromptCard({ name: 'Default', onAdd, onSkip: noop, onIgnore: noop });

    const input = shadow().querySelector<HTMLInputElement>('.name');
    expect(input?.value).toBe('Default');
    input!.value = 'Edited';
    shadow().querySelector<HTMLButtonElement>('.add')!.click();

    expect(onAdd).toHaveBeenCalledWith('Edited');
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('fires onIgnore on 不再提醒', () => {
    const onIgnore = vi.fn();
    showPromptCard({ name: 'X', onAdd: noop, onSkip: noop, onIgnore });
    shadow().querySelector<HTMLButtonElement>('.ignore')!.click();
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing card instead of stacking', () => {
    showPromptCard({ name: 'A', onAdd: noop, onSkip: noop, onIgnore: noop });
    showPromptCard({ name: 'B', onAdd: noop, onSkip: noop, onIgnore: noop });
    expect(document.querySelectorAll(`#${HOST_ID}`).length).toBe(1);
  });

  it('stays until the user acts (no auto-dismiss)', () => {
    vi.useFakeTimers();
    try {
      showPromptCard({ name: 'X', onAdd: noop, onSkip: noop, onIgnore: noop });
      vi.advanceTimersByTime(60000); // 一分鐘後仍在
      expect(document.getElementById(HOST_ID)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
