import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSettings, saveSettings } from "../lib/storage";
import "../popup/styles.css";

document.documentElement.classList.add("options-page");
document.body.classList.add("options-page");

const DEFAULT_BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL || "http://localhost:8787";

const Options = (): JSX.Element => {
  const [backendBaseUrl, setBackendBaseUrl] = useState(DEFAULT_BACKEND_BASE_URL);
  const [timezone, setTimezone] = useState("Europe/Zurich");
  const [locale, setLocale] = useState("en-US");
  const [debug, setDebug] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      const settings = await getSettings();
      setBackendBaseUrl(settings.backendBaseUrl);
      setTimezone(settings.timezone);
      setLocale(settings.locale);
      setDebug(settings.debug);
    })();
  }, []);

  const onSave = async (): Promise<void> => {
    await saveSettings({ backendBaseUrl, timezone, locale, debug });
    setMessage("Saved.");
  };

  return (
    <div className="app app-options">
      <h1>Extension Settings</h1>
      <label>
        Backend Base URL
        <input value={backendBaseUrl} onChange={(e) => setBackendBaseUrl(e.target.value)} />
      </label>
      <label>
        Timezone
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </label>
      <label>
        Locale
        <input value={locale} onChange={(e) => setLocale(e.target.value)} />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
        Enable debug mode
      </label>
      <button onClick={onSave}>Save settings</button>
      {message && <p>{message}</p>}
      <div className="settings-note">
        <strong>Data handling:</strong> page content is sent to the configured backend only when extraction is requested.
        Google Calendar access is used only for calendar selection, duplicate checks, and event creation.
      </div>
      <div className="settings-links">
        <a href="https://github.com/LOSU-369/calendar-plugin/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">
          Privacy policy
        </a>
        <a href="https://github.com/LOSU-369/calendar-plugin" target="_blank" rel="noreferrer">
          Source code
        </a>
      </div>
    </div>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>
);
