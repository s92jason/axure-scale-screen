// 讓書籤與清理頁籤共用內容區；切換時保留各面板已載入的內容與狀態。
export function bindHubTabs(root: HTMLElement): () => void {
  const tablist = root.querySelector<HTMLElement>('[role="tablist"]');
  if (!tablist) {
    return () => {};
  }

  const panels = Array.from(root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .filter((tab) => tab.closest('[role="tablist"]') === tablist)
    .map((tab) => ({ tab, panel: panels.find((panel) => panel.id === tab.getAttribute('aria-controls')) }))
    .filter((entry): entry is { tab: HTMLButtonElement; panel: HTMLElement } => Boolean(entry.panel));

  function select(tab: HTMLButtonElement, focus: boolean): void {
    if (tab.disabled) {
      return;
    }
    for (const entry of tabs) {
      const selected = entry.tab === tab;
      entry.tab.setAttribute('aria-selected', String(selected));
      entry.tab.tabIndex = selected ? 0 : -1;
      entry.panel.hidden = !selected;
    }
    if (focus) {
      tab.focus();
    }
  }

  function eventTab(event: Event): HTMLButtonElement | undefined {
    const target = event.target;
    if (!(target instanceof Element)) {
      return undefined;
    }
    const tab = target.closest<HTMLButtonElement>('button[role="tab"]');
    return tabs.find((entry) => entry.tab === tab && !entry.tab.disabled)?.tab;
  }

  function onClick(event: MouseEvent): void {
    const tab = eventTab(event);
    if (tab) {
      select(tab, true);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const tab = eventTab(event);
    if (!tab || event.altKey || event.ctrlKey || event.metaKey
      || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const enabledTabs = tabs.map((entry) => entry.tab).filter((entry) => !entry.disabled);
    const index = enabledTabs.indexOf(tab);
    let nextIndex: number;
    switch (event.key) {
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = enabledTabs.length - 1;
        break;
      case 'ArrowLeft':
        nextIndex = (index + enabledTabs.length - 1) % enabledTabs.length;
        break;
      default:
        nextIndex = (index + 1) % enabledTabs.length;
    }
    event.preventDefault();
    select(enabledTabs[nextIndex], true);
  }

  const initialTab = tabs.find((entry) => !entry.tab.disabled && entry.tab.getAttribute('aria-selected') === 'true')
    ?? tabs.find((entry) => !entry.tab.disabled);
  if (initialTab) {
    select(initialTab.tab, false);
  }
  tablist.addEventListener('click', onClick);
  tablist.addEventListener('keydown', onKeyDown);

  return () => {
    tablist.removeEventListener('click', onClick);
    tablist.removeEventListener('keydown', onKeyDown);
  };
}
