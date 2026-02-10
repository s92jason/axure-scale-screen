import { getZoomState, resetZoomState, setZoomState } from '../shared/storage';
import { isRuntimeMessage } from '../shared/types';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return;
  }

  void (async () => {
    try {
      if (message.type === 'GET_ZOOM') {
        const state = await getZoomState(message.urlKey);
        sendResponse({ ok: true, state });
        return;
      }

      if (message.type === 'SET_ZOOM') {
        const state = await setZoomState(message.urlKey, message.zoom);
        sendResponse({ ok: true, state });
        return;
      }

      const state = await resetZoomState(message.urlKey);
      sendResponse({ ok: true, state });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unexpected background error';
      sendResponse({ ok: false, error: messageText });
    }
  })();

  return true;
});
