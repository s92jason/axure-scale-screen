// F2 浮動卡片：偵測到未收藏的 Axure 專案時，於頂層 frame 右上角詢問是否加入。
// 以 shadow DOM 隔離樣式；動作以回呼解耦，方便 content 端接訊息、也方便測試。

export interface PromptCardOptions {
  name: string;
  onAdd: (name: string) => void;
  onSkip: () => void;
  onIgnore: () => void;
}

const HOST_ID = 'axure-scale-prompt-host';

const BRAND_MARK = `
<svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
  <defs><linearGradient id="axB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00BFEA"/><stop offset="1" stop-color="#4B5DD6"/></linearGradient></defs>
  <g stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-width="64">
    <path d="M96 96 L232 232 L96 368" stroke="url(#axB)"/>
    <path d="M232 232 L368 96" stroke="#7DC340"/>
    <path d="M232 232 L368 368" stroke="#E8187A"/>
  </g>
  <circle cx="396" cy="396" r="96" fill="#1C1C1E"/>
  <circle cx="360" cy="360" r="22" fill="#fff"/>
  <circle cx="432" cy="432" r="22" fill="#fff"/>
  <path d="M440 352 L352 440" stroke="#fff" stroke-width="24" stroke-linecap="round"/>
</svg>`;

export function hidePromptCard(doc: Document = document): void {
  doc.getElementById(HOST_ID)?.remove();
}

const STYLE = `
:host { all: initial; }
.card {
  --text: rgba(0,0,0,0.85);
  --text-2: rgba(0,0,0,0.5);
  --text-3: rgba(0,0,0,0.34);
  --accent: #0a84ff;
  --field-bg: rgba(255,255,255,0.6);
  --hairline: rgba(0,0,0,0.1);
  --chip-bg: linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.5) 100%);
  --chip-shadow: 0 1px 0 rgba(255,255,255,0.95) inset, 0 1px 3px rgba(0,0,0,0.08);
  --glass-bg: linear-gradient(155deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.45) 100%);
  --glass-ring: linear-gradient(150deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.2) 38%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0.55) 100%);
  --add-bg: linear-gradient(180deg, #2a93ff 0%, #0a84ff 100%);

  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  width: 288px;
  box-sizing: border-box;
  padding: 15px;
  border-radius: 18px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
  color: var(--text);
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(40px) saturate(1.8) brightness(1.06);
  backdrop-filter: blur(40px) saturate(1.8) brightness(1.06);
  box-shadow:
    0 1px 1px rgba(255,255,255,0.9) inset,
    0 6px 18px rgba(28,30,72,0.14),
    0 22px 60px rgba(28,30,72,0.22);
  animation: slidein 0.2s cubic-bezier(0.32,0.72,0,1);
}
.card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--glass-ring);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
@keyframes slidein { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.brand { display: flex; align-items: center; gap: 7px; min-width: 0; }
.brand-mark { width: 17px; height: 17px; flex: 0 0 17px; display: block; }
.brand-mark svg { width: 100%; height: 100%; display: block; }
.title { font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.close {
  cursor: pointer; border: 0; background: transparent; font-size: 17px; line-height: 1;
  color: var(--text-3); padding: 2px 5px; border-radius: 7px; transition: all 0.15s ease;
}
.close:hover { color: var(--text); background: var(--field-bg); }

.field-label { display: block; font-size: 10.5px; font-weight: 500; color: var(--text-2); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
.name {
  width: 100%; box-sizing: border-box; height: 34px; padding: 0 11px; margin-bottom: 12px;
  font-size: 13px; font-family: inherit; color: var(--text);
  border: 1px solid var(--hairline); border-radius: 9px; background: var(--field-bg);
  box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.name:focus { outline: none; border-color: rgba(10,132,255,0.5); box-shadow: 0 0 0 3px rgba(10,132,255,0.18); }

.actions { display: flex; align-items: center; gap: 7px; }
button.act {
  flex: 0 0 auto; height: 31px; padding: 0 13px; font-size: 12px; font-family: inherit; font-weight: 500;
  border-radius: 9px; cursor: pointer; border: 0; transition: transform 0.12s ease, filter 0.15s ease;
}
button.act:active { transform: scale(0.96); }
.add {
  color: #fff; background: var(--add-bg);
  box-shadow: 0 1px 0 rgba(255,255,255,0.4) inset, 0 2px 6px rgba(10,132,255,0.35);
}
.add:hover { filter: brightness(1.06); }
.skip { color: var(--text); background: var(--chip-bg); box-shadow: var(--chip-shadow); }
.skip:hover { filter: brightness(1.04); }
.ignore { margin-left: auto; color: var(--text-3); background: transparent; }
.ignore:hover { color: var(--text); }

@media (prefers-color-scheme: dark) {
  .card {
    --text: rgba(255,255,255,0.92);
    --text-2: rgba(255,255,255,0.55);
    --text-3: rgba(255,255,255,0.4);
    --field-bg: rgba(255,255,255,0.08);
    --hairline: rgba(255,255,255,0.16);
    --chip-bg: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.07) 100%);
    --chip-shadow: 0 1px 0 rgba(255,255,255,0.18) inset, 0 1px 4px rgba(0,0,0,0.4);
    --glass-bg: linear-gradient(155deg, rgba(44,44,48,0.78) 0%, rgba(36,36,40,0.7) 100%);
    --glass-ring: linear-gradient(150deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.03) 62%, rgba(255,255,255,0.2) 100%);
    --add-bg: linear-gradient(180deg, #5aa9ff 0%, #409cff 100%);
    box-shadow:
      0 1px 1px rgba(255,255,255,0.16) inset,
      0 10px 30px rgba(0,0,0,0.5),
      0 2px 8px rgba(0,0,0,0.35);
  }
  .add { box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(0,0,0,0.4); }
}
`;

export function showPromptCard(options: PromptCardOptions, doc: Document = document): void {
  hidePromptCard(doc);

  const host = doc.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = STYLE;

  const card = doc.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="head">
      <span class="brand">
        <span class="brand-mark">${BRAND_MARK}</span>
        <span class="title">收藏這個 Axure 專案？</span>
      </span>
      <button class="close" type="button" aria-label="關閉">×</button>
    </div>
    <label class="field-label">名稱（可修改）</label>
    <input class="name" type="text" />
    <div class="actions">
      <button class="act add" type="button">加入</button>
      <button class="act skip" type="button">略過</button>
      <button class="act ignore" type="button">不再提醒</button>
    </div>
  `;

  root.append(style, card);
  // 掛在 body(回退 documentElement)：避免 Safari 把 body 外的節點在重排時清掉。
  (doc.body ?? doc.documentElement).appendChild(host);

  const nameInput = root.querySelector<HTMLInputElement>('.name');
  if (nameInput) {
    nameInput.value = options.name;
  }

  // 不自動收合：卡片保留到使用者明確處理(加入/略過/不再提醒/關閉)，
  // 避免使用者還沒注意到卡片就已經消失。
  const finish = (action: () => void): void => {
    action();
    hidePromptCard(doc);
  };

  root.querySelector('.add')?.addEventListener('click', () => {
    const value = nameInput?.value.trim() || options.name;
    finish(() => options.onAdd(value));
  });
  root.querySelector('.skip')?.addEventListener('click', () => finish(options.onSkip));
  root.querySelector('.close')?.addEventListener('click', () => finish(options.onSkip));
  root.querySelector('.ignore')?.addEventListener('click', () => finish(options.onIgnore));
}
