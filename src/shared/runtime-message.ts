/** options / popup 共用的 runtime.sendMessage 包装：统一 lastError 与 status:error。 */
export function sendRuntimeMessage<T = any>(
  message: Record<string, unknown>,
  chromeApi: typeof chrome = chrome
): Promise<T> {
  return new Promise((resolve, reject) => {
    chromeApi.runtime.sendMessage(message, (response) => {
      if (chromeApi.runtime.lastError) {
        reject(new Error(chromeApi.runtime.lastError.message));
        return;
      }
      if (!response || response.status === 'error') {
        reject(new Error(response?.message || 'Unknown runtime error'));
        return;
      }
      resolve(response as T);
    });
  });
}
