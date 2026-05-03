import type { ExtractRequestPayload, ExtractResponsePayload } from "../types";

export const callExtractApi = async (
  backendBaseUrl: string,
  payload: ExtractRequestPayload
): Promise<ExtractResponsePayload> => {
  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Cannot reach backend at ${backendBaseUrl}. Make sure the local backend server is running and try again.`
      );
    }
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend /extract failed (${response.status}): ${text}`);
  }
  return (await response.json()) as ExtractResponsePayload;
};
