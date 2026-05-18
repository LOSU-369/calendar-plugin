import { callExtractApi } from "../lib/backend-api";
import { checkPotentialDuplicate } from "../lib/dedupe";
import { getCalendarToken, listWritableCalendars } from "../lib/google-calendar";
import { getPendingSession, getSelectedCalendar, getSettings, savePendingSession } from "../lib/storage";
import type { EventCandidate, PendingSession, TriggerSource } from "../types";

interface ContentContext {
  visibleText: string;
  selectedText?: string;
  titleHints?: string[];
}

const MENU_ID = "extract-selected-event";

const isInjectablePage = (url?: string): boolean => Boolean(url && /^https?:\/\//i.test(url));

const sendTabMessage = <T>(tabId: number, message: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });

const captureVisibleTabSafe = async (windowId?: number): Promise<string | undefined> => {
  try {
    const image = await new Promise<string>((resolve, reject) => {
      const callback = (dataUrl: string): void => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(dataUrl);
      };
      if (typeof windowId === "number") {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, callback);
      } else {
        chrome.tabs.captureVisibleTab({ format: "png" }, callback);
      }
    });
    return image;
  } catch {
    return undefined;
  }
};

const getActiveTab = async (): Promise<chrome.tabs.Tab> => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) {
    throw new Error("No active tab available.");
  }
  return tab;
};

const ensureContentScript = async (tab: chrome.tabs.Tab): Promise<void> => {
  if (!tab.id || !isInjectablePage(tab.url)) {
    throw new Error("This page cannot be scanned. Open a normal website tab and try again.");
  }
  try {
    await sendTabMessage(tab.id, { type: "PING_CONTENT_SCRIPT" });
    return;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await sendTabMessage(tab.id, { type: "PING_CONTENT_SCRIPT" });
  }
};

const requestPageContext = async (tab: chrome.tabs.Tab): Promise<ContentContext> => {
  await ensureContentScript(tab);
  const response = await sendTabMessage<ContentContext>(tab.id!, {
    type: "EXTRACT_TEXT_CONTEXT"
  });
  if (!response?.visibleText) {
    throw new Error("Unable to extract visible text from page.");
  }
  return response;
};

const withDedupe = async (candidates: EventCandidate[]): Promise<EventCandidate[]> => {
  const calendar = await getSelectedCalendar();
  const settings = await getSettings();
  if (!calendar.id) {
    return candidates;
  }
  return Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      duplicateHint: await checkPotentialDuplicate(candidate, calendar.id!, settings.timezone)
    }))
  );
};

const runExtraction = async ({
  source,
  selectedText,
  preferredTab
}: {
  source: TriggerSource;
  selectedText?: string;
  preferredTab?: chrome.tabs.Tab;
}): Promise<PendingSession> => {
  const settings = await getSettings();
  const tab = preferredTab?.id ? preferredTab : await getActiveTab();
  let context: ContentContext = { visibleText: "" };
  if (tab.id) {
    try {
      context = await requestPageContext(tab);
    } catch {
      // For context-menu flow we can still extract from selectedText even if content-script is unavailable.
      context = { visibleText: selectedText ?? "" };
    }
  }
  const screenshotBase64 = await captureVisibleTabSafe(tab.windowId);
  const finalVisibleText = context.visibleText || selectedText || "";
  if (!finalVisibleText.trim()) {
    throw new Error("No extractable text found from current page or selection.");
  }
  const payload = {
    pageUrl: tab.url!,
    pageTitle: tab.title ?? "",
    visibleText: finalVisibleText,
    selectedText: selectedText ?? context.selectedText,
    titleHints: context.titleHints,
    screenshotBase64,
    timezone: settings.timezone,
    locale: settings.locale
  };
  const extracted = await callExtractApi(settings.backendBaseUrl, payload);
  const candidates = await withDedupe(extracted.candidates);
  await chrome.storage.local.remove(["lastError"]);
  const session: PendingSession = {
    source,
    createdAt: new Date().toISOString(),
    tabId: tab.id,
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    visibleText: payload.visibleText,
    selectedText: payload.selectedText,
    screenshotBase64: undefined,
    candidates
  };
  await savePendingSession(session);
  return session;
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Extract selected event to Google Calendar",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }
  try {
    const session = await runExtraction({
      source: "context-menu",
      selectedText: info.selectionText?.trim() || undefined,
      preferredTab: tab
    });
    await chrome.tabs.create({
      url: `${chrome.runtime.getURL("src/review/index.html")}?source=${session.source}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({ lastError: message });
    await savePendingSession({
      source: "context-menu",
      createdAt: new Date().toISOString(),
      tabId: tab?.id,
      pageUrl: tab?.url ?? "",
      pageTitle: tab?.title ?? "",
      visibleText: info.selectionText?.trim() ?? "",
      selectedText: info.selectionText?.trim() ?? "",
      screenshotBase64: undefined,
      candidates: []
    });
    await chrome.tabs.create({
      url: `${chrome.runtime.getURL("src/review/index.html")}?error=1`
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async (): Promise<unknown> => {
    switch (message?.type) {
      case "SCAN_ACTIVE_TAB": {
        const session = await runExtraction({ source: "popup-scan" });
        return { ok: true, session };
      }
      case "GET_PENDING_SESSION": {
        return { ok: true, session: await getPendingSession() };
      }
      case "LIST_CALENDARS": {
        const calendars = await listWritableCalendars();
        return { ok: true, calendars };
      }
      case "GET_AUTH_TOKEN": {
        const token = await getCalendarToken();
        return { ok: true, token };
      }
      default:
        return { ok: false, error: "Unsupported message type." };
    }
  };
  handle()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
