import { getZoomState, resetZoomState, setZoomState } from '../shared/storage';
import { isRuntimeMessage } from '../shared/types';

const COMMAND_TO_MESSAGE = {
  'zoom-in': { type: 'CONTENT_SHORTCUT_IN' },
  'zoom-out': { type: 'CONTENT_SHORTCUT_OUT' },
  'zoom-reset': { type: 'CONTENT_SHORTCUT_RESET' }
} as const;

type CommandName = keyof typeof COMMAND_TO_MESSAGE;

function queryActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

function discoverFrameIds(tabId: number): Promise<number[]> {
  return new Promise((resolve) => {
    if (!chrome.scripting?.executeScript) {
      resolve([0]);
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: () => window.location.href
      },
      (results) => {
        if (chrome.runtime.lastError || !results) {
          resolve([0]);
          return;
        }

        const frameIds = [
          ...new Set(results.map((item) => item.frameId).filter((id): id is number => typeof id === 'number'))
        ].sort((a, b) => a - b);

        resolve(frameIds.length > 0 ? frameIds : [0]);
      }
    );
  });
}

function sendMessageToFrame(tabId: number, frameId: number, message: { type: string }): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, () => {
      resolve();
    });
  });
}

async function dispatchShortcutCommand(command: string): Promise<void> {
  if (!(command in COMMAND_TO_MESSAGE)) {
    return;
  }

  const typedCommand = command as CommandName;
  const tabId = await queryActiveTabId();
  if (tabId === null) {
    return;
  }

  const frameIds = await discoverFrameIds(tabId);
  await Promise.all(frameIds.map((frameId) => sendMessageToFrame(tabId, frameId, COMMAND_TO_MESSAGE[typedCommand])));
}

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

chrome.commands.onCommand.addListener((command) => {
  void dispatchShortcutCommand(command);
});
