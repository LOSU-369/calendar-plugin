export const chromeRuntimeSendMessage = <T>(message: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const lastError = chrome.runtime.lastError;
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
