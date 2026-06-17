// F2 浮動卡片：偵測到未收藏的 Axure 專案時，於頂層 frame 右上角詢問是否加入。
// 以 shadow DOM 隔離樣式；動作以回呼解耦，方便 content 端接訊息、也方便測試。

export interface PromptCardOptions {
  name: string;
  onAdd: (name: string) => void;
  onSkip: () => void;
  onIgnore: () => void;
}

const HOST_ID = 'axure-scale-prompt-host';

export function hidePromptCard(doc: Document = document): void {
  doc.getElementById(HOST_ID)?.remove();
}

const STYLE = `
:host { all: initial; }
.card {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  width: 280px;
  box-sizing: border-box;
  padding: 14px;
  border-radius: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
  color: #1c1c1e;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 30px rgba(20, 30, 70, 0.22), 0 2px 8px rgba(0, 0, 0, 0.12);
  animation: slidein 0.18s ease-out;
}
@keyframes slidein { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.title { font-size: 12.5px; font-weight: 600; }
.close { cursor: pointer; border: 0; background: transparent; font-size: 16px; line-height: 1; color: rgba(0,0,0,0.4); padding: 2px 4px; }
.close:hover { color: rgba(0,0,0,0.75); }
.field-label { display: block; font-size: 10.5px; color: rgba(0,0,0,0.45); margin-bottom: 5px; }
.name {
  width: 100%; box-sizing: border-box; height: 32px; padding: 0 10px; margin-bottom: 10px;
  font-size: 13px; font-family: inherit; color: inherit;
  border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; background: rgba(255,255,255,0.7);
}
.actions { display: flex; gap: 7px; }
button.act { flex: 0 0 auto; height: 30px; padding: 0 12px; font-size: 12px; font-family: inherit; font-weight: 500;
  border-radius: 8px; cursor: pointer; border: 1px solid transparent; }
.add { color: #fff; background: #0a84ff; }
.add:hover { background: #0a7aec; }
.skip { color: #1c1c1e; background: rgba(0,0,0,0.06); }
.skip:hover { background: rgba(0,0,0,0.1); }
.ignore { margin-left: auto; color: rgba(0,0,0,0.45); background: transparent; }
.ignore:hover { color: rgba(0,0,0,0.75); }
@media (prefers-color-scheme: dark) {
  .card { color: #f2f2f7; background: rgba(40,40,44,0.86); border-color: rgba(255,255,255,0.16); }
  .close { color: rgba(255,255,255,0.45); } .close:hover { color: #fff; }
  .field-label { color: rgba(255,255,255,0.5); }
  .name { color: inherit; background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.16); }
  .skip { color: #f2f2f7; background: rgba(255,255,255,0.12); } .skip:hover { background: rgba(255,255,255,0.18); }
  .ignore { color: rgba(255,255,255,0.5); } .ignore:hover { color: #fff; }
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
      <span class="title">收藏這個 Axure 專案？</span>
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
