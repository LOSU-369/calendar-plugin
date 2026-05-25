import type { ExtractRequestPayload, ExtractResponsePayload } from "../types";

const EXTRACT_TIMEOUT_MS = 15_000;

export const callExtractApi = async (
  backendBaseUrl: string,
  payload: ExtractRequestPayload
): Promise<ExtractResponsePayload> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Event extraction timed out. Please try Refresh scan again.");
    }
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach backend at ${backendBaseUrl}. Make sure the local backend server is running and try again.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend /extract failed (${response.status}): ${text}`);
  }
  return (await response.json()) as ExtractResponsePayload;
};
