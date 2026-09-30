type ScrollAxis = 'x' | 'y';

function overflowFor(style: CSSStyleDeclaration, axis: ScrollAxis): string {
  return (axis === 'x' ? style.overflowX : style.overflowY) || style.overflow;
}

function scrollElement(element: HTMLElement, delta: number, axis: ScrollAxis): number {
  const style = window.getComputedStyle(element);
  const extent = Math.max(0, axis === 'x'
    ? element.scrollWidth - element.clientWidth
    : element.scrollHeight - element.clientHeight);
  // RTL 容器的 scrollLeft 從 0 往負數移動；Safari 的彈性捲動也可能暫時超出邊界。
  const minimum = axis === 'x' && style.direction === 'rtl' ? -extent : 0;
  const maximum = minimum === 0 ? extent : 0;
  const current = Math.min(maximum, Math.max(minimum, axis === 'x' ? element.scrollLeft : element.scrollTop));
  const next = Math.min(maximum, Math.max(minimum, current + delta));

  if (axis === 'x') {
    element.scrollLeft = next;
  } else {
    element.scrollTop = next;
  }

  // body 的 overflow 可能被傳遞至 viewport，此時 body 本身並不能捲動。
  // 依實際位移計算餘量，避免把未發生的捲動誤當作已消耗。
  const actual = Math.min(maximum, Math.max(minimum, axis === 'x' ? element.scrollLeft : element.scrollTop));
  return delta - (actual - current);
}

function scrollFromTarget(path: EventTarget[], delta: number, axis: ScrollAxis): void {
  if (delta === 0) {
    return;
  }

  const page = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  let remaining = delta;
  // composedPath 也涵蓋 Shadow DOM，先捲動游標下的動態面板，再依邊界規則交給外層。
  for (const target of path) {
    if (!(target instanceof HTMLElement) || target === page) {
      continue;
    }
    const style = window.getComputedStyle(target);
    if (!['auto', 'scroll', 'overlay'].includes(overflowFor(style, axis))) {
      continue;
    }

    remaining = scrollElement(target, remaining, axis);
    const overscroll = (axis === 'x' ? style.overscrollBehaviorX : style.overscrollBehaviorY)
      || style.overscrollBehavior;
    if (remaining === 0 || overscroll === 'contain' || overscroll === 'none') {
      return;
    }
  }

  let overflow = overflowFor(window.getComputedStyle(page), axis);
  // 根元素的 overflow 為 visible 時，body 的 overflow 會套用至 viewport。
  if (page === document.documentElement && (!overflow || overflow === 'visible') && document.body) {
    overflow = overflowFor(window.getComputedStyle(document.body), axis);
  }
  if (overflow !== 'hidden' && overflow !== 'clip') {
    scrollElement(page, remaining, axis);
  }
}

// 只在確認為 Axure 文件後安裝。Safari 的 overscroll-behavior-x 無法可靠禁止
// 歷史導覽，必須從第一個水平 wheel 起 preventDefault，再自行保留內容捲動。
// 若等到邊界才攔截，快速滑動的手勢可能已被 Safari 接管。
export function installHorizontalPan(isPinching: () => boolean = () => false): () => void {
  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || isPinching() || event.deltaX === 0 || event.defaultPrevented || !event.cancelable) {
      return;
    }

    event.preventDefault();
    const path = event.composedPath();
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement);
    const style = target ? window.getComputedStyle(target) : null;
    const lineHeight = Number.parseFloat(style?.lineHeight ?? '')
      || Number.parseFloat(style?.fontSize ?? '') * 1.2
      || 16;
    const unitX = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerWidth
      : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? lineHeight : 1;
    const unitY = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight
      : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? lineHeight : 1;

    // 取消 wheel 同時取消了兩軸的原生捲動，斜向滑動需補回垂直位移。
    scrollFromTarget(path, event.deltaX * unitX, 'x');
    scrollFromTarget(path, event.deltaY * unitY, 'y');
  };

  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => document.removeEventListener('wheel', onWheel, { capture: true });
}
