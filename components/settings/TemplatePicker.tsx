"use client";
import { useEffect, useRef, useState } from "react";
import { getDrivePickerToken } from "@/app/actions/drive-picker";
import { Badge, buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

interface Picker { setVisible(visible: boolean): void; dispose(): void }
interface PickerResponse { action: string; docs?: unknown[] }
interface PickerBuilder {
  addView(view: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
  build(): Picker;
}
interface PickerApi {
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
  Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
}
type PickerWindow = Window & {
  gapi?: { load(name: string, options: {
    callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void;
  }): void };
  google?: { picker?: PickerApi };
};

let pickerApi: Promise<PickerApi> | null = null;

function loadPicker(): Promise<PickerApi> {
  const host = window as PickerWindow;
  if (host.google?.picker) return Promise.resolve(host.google.picker);
  if (pickerApi) return pickerApi;

  pickerApi = new Promise<PickerApi>((resolve, reject) => {
    let script: HTMLScriptElement | undefined;
    const timer = window.setTimeout(fail, 15_000);
    function cleanup() {
      window.clearTimeout(timer);
      if (script) { script.onload = null; script.onerror = null; }
    }
    function fail() {
      cleanup();
      script?.remove();
      reject(new Error("Google Picker could not load. Please try again."));
    }
    function load() {
      if (!host.gapi) { fail(); return; }
      try {
        host.gapi.load("picker", {
          callback: () => {
            if (!host.google?.picker) { fail(); return; }
            cleanup();
            resolve(host.google.picker);
          },
          onerror: fail, timeout: 15_000, ontimeout: fail,
        });
      } catch { fail(); }
    }
    if (host.gapi) load();
    else {
      script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = load;
      script.onerror = fail;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    // A blocked script or transient network failure must allow another click to retry.
    pickerApi = null;
    throw error;
  });
  return pickerApi;
}

const TOKEN_ERRORS = {
  signed_out: "Sign in to choose template files.",
  connect_drive: "Connect Drive first, then choose template files.",
  token_error: "Could not access Drive. Try again, or reconnect Drive in Settings.",
};

export function TemplatePicker({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const picker = useRef<Picker | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; picker.current?.dispose(); };
  }, []);

  async function chooseFiles() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    setCount(null);
    try {
      const key = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
      const appId = process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID;
      if (!key || !appId)
        throw new Error("Template file selection is not configured. Ask your administrator to finish Google Picker setup.");
      const token = await getDrivePickerToken();
      if (typeof token !== "string") throw new Error(TOKEN_ERRORS[token.error]);
      if (!mounted.current) return;
      const api = await loadPicker();
      if (!mounted.current) return;

      picker.current?.dispose();
      picker.current = new api.PickerBuilder()
        .addView(api.ViewId.DOCS)
        .setOAuthToken(token)
        .setDeveloperKey(key)
        // drive.file grants attach to this Cloud project, the same one as the OAuth client.
        .setAppId(appId)
        .setOrigin(window.location.origin)
        .enableFeature(api.Feature.MULTISELECT_ENABLED)
        .setCallback((data) => {
          if (!mounted.current) return;
          if (data.action === api.Action.PICKED) {
            setCount(data.docs?.length ?? 0);
            setBusy(false);
          } else if (data.action === api.Action.CANCEL) {
            setBusy(false);
          }
        })
        .build();
      picker.current.setVisible(true);
    } catch (e) {
      if (!mounted.current) return;
      setError(presentError(e, {
        fallback: "Google Picker could not open. Please try again.",
        authentication: "Please sign in again to choose template files.",
      }));
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <button type="button" disabled={busy || disabled} aria-busy={busy}
        onClick={chooseFiles} style={buttonStyle("secondary", busy || disabled)}>
        {busy ? "Choosing…" : "Choose template files"}
      </button>
      <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
        Choose Google Docs or text files with “template” in the name to use on your next draft.
      </p>
      {error && <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-2)" }}>
        {error}
      </p>}
      {count !== null && <p role="status" style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
        <Badge tone="ok">{count} file{count === 1 ? "" : "s"} added</Badge>{" "}
        — ConductFlow can now read {count === 1 ? "it" : "them"} for templates.
      </p>}
    </div>
  );
}
