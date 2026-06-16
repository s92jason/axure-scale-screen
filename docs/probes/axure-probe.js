/*
 * Axure Link Hub — P0 探針 (P0-1 / P0-4)
 * 用法：在「真實 Axure 原型頁」打開 DevTools Console，整段貼上後 Enter。
 * 它會跑在頁面的 main world(就是 $axure 所在的世界)，回報每個 frame 的：
 *   - 是否有 $axure
 *   - projectName(F4 主命名源是否存在)
 *   - 任何看起來像穩定 ID 的欄位(P0-4：file:// 搬移後能不能自動認回)
 * 原始物件會存到該 frame 的 window.__axureProbe，可手動展開 configuration 細看。
 *
 * 注意：content script 跑在 isolated world，本來就讀不到 $axure；
 * 本探針確認的是「資料在不在頁面上」。若在，下一步才需要 MAIN-world 注入把它取出。
 */
(() => {
  const ID_HINT = /(^|_|\b)(id|guid|uuid|key|hash|sha|short|slug)(\b|_|$)/i;

  const scanIds = (obj, prefix) => {
    const found = {};
    if (!obj || typeof obj !== 'object') return found;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if ((typeof v === 'string' || typeof v === 'number') && ID_HINT.test(k)) {
        found[prefix + k] = v;
      }
    }
    return found;
  };

  const visit = (win, label) => {
    let href = '(unknown)';
    try {
      href = win.location.href;
    } catch {
      return { frame: label, url: '(cross-origin, blocked)', hasAxure: '?' };
    }

    const ax = win.$axure;
    const row = { frame: label, url: href, hasAxure: Boolean(ax), projectName: undefined };
    if (ax) {
      const cfg = ax.document && ax.document.configuration;
      row.projectName = cfg && cfg.projectName;
      row.configKeys = cfg ? Object.keys(cfg) : [];
      row.idLike = {
        ...scanIds(cfg, 'configuration.'),
        ...scanIds(ax.document, 'document.'),
        ...scanIds(ax, '$axure.')
      };
      try {
        win.__axureProbe = { $axure: ax, configuration: cfg };
      } catch {
        /* ignore */
      }
    }
    return row;
  };

  const rows = [visit(window, 'top')];
  for (let i = 0; i < window.frames.length; i++) {
    try {
      rows.push(visit(window.frames[i], `frame[${i}]`));
    } catch {
      rows.push({ frame: `frame[${i}]`, url: '(cross-origin, blocked)', hasAxure: '?' });
    }
  }

  console.log('%cAxure Link Hub — P0 探針結果', 'font-weight:bold;font-size:13px');
  console.table(rows.map((r) => ({ frame: r.frame, url: r.url, hasAxure: r.hasAxure, projectName: r.projectName })));
  rows.forEach((r) => {
    if (r.hasAxure) {
      console.log(`[${r.frame}] configuration keys:`, r.configKeys);
      console.log(`[${r.frame}] 疑似穩定 ID 欄位(P0-4):`, r.idLike);
    }
  });
  console.log('提示：原始 configuration 已存到該 frame 的 window.__axureProbe，可展開檢視。');
  return rows;
})();
