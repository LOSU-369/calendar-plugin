const BACKGROUND_RESPONSE_TIMEOUT_MS = 35_000;

export const chromeRuntimeSendMessage = <T>(message: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      reject(new Error("Scanning took too long. Please close the popup and try again."));
    }, BACKGROUND_RESPONSE_TIMEOUT_MS);

    chrome.runtime.sendMessage(message, (response: T) => {
      const lastError = chrome.runtime.lastError;
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response);
    });
  });

export const chromeStorageGet = <T>(keys: string[]): Promise<T> =>
  new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as T));
  });

export const chromeStorageSet = (data: Record<string, unknown>): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
