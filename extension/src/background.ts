// @ts-nocheck -- This entry point is compiled by the independent extension build, not the root Next.js project.
export {};

type CaptureStatus = "idle" | "starting" | "loading_model" | "capturing" | "stopping" | "error";

interface CaptureState {
  status: CaptureStatus;
  transcript: string;
  message: string;
  progress?: number;
  tabId?: number;
}

const STORAGE_KEY = "captureState";
const OFFSCREEN_PATH = "offscreen.html";
const INITIAL_STATE: CaptureState = {
  status: "idle",
  transcript: "",
  message: "Ready.",
};

let creatingOffscreenDocument: Promise<void> | null = null;
let operation: Promise<unknown> = Promise.resolve();

async function readState(): Promise<CaptureState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as CaptureState | undefined) ?? INITIAL_STATE;
}

async function publishState(next: CaptureState): Promise<CaptureState> {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  void chrome.runtime.sendMessage({ target: "popup", type: "STATE_UPDATED", state: next }).catch(() => {
    // The popup is normally closed; absence of a listener is expected.
  });
  return next;
}

async function ensureOffscreenDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["USER_MEDIA"],
        justification: "Capture and locally transcribe audio from the user-selected browser tab.",
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }
  await creatingOffscreenDocument;
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function startCapture(tabId: number): Promise<CaptureState> {
  const current = await readState();
  if (["starting", "loading_model", "capturing", "stopping"].includes(current.status)) {
    throw new Error("A tab capture is already in progress.");
  }

  await publishState({ status: "starting", transcript: "", message: "Preparing the audio processor…", tabId });
  try {
    await ensureOffscreenDocument();

    // Chrome 116+ permits a stream ID created in an extension service worker to
    // be consumed by an offscreen document from the same extension origin.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "START_CAPTURE",
      streamId,
    }) as { ok: boolean; error?: string };

    if (!response?.ok) {
      throw new Error(response?.error ?? "The offscreen document could not start audio capture.");
    }

    return publishState({
      status: "loading_model",
      transcript: "",
      message: "Capturing audio; loading the local Whisper model…",
      tabId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await publishState({ status: "error", transcript: "", message });
    throw error;
  }
}

async function stopCapture(): Promise<CaptureState> {
  const current = await readState();
  if (!["starting", "loading_model", "capturing", "stopping"].includes(current.status)) {
    return current;
  }

  await publishState({ ...current, status: "stopping", message: "Stopping and finishing queued audio…" });
  try {
    if (await hasOffscreenDocument()) {
      const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE" }) as {
        ok: boolean;
        error?: string;
      };
      if (!response?.ok) throw new Error(response?.error ?? "The audio processor did not stop cleanly.");
    }
    const latest = await readState();
    return publishState({ status: "idle", transcript: latest.transcript, message: "Stopped." });
  } catch (error) {
    const latest = await readState();
    const message = error instanceof Error ? error.message : String(error);
    return publishState({ status: "error", transcript: latest.transcript, message });
  }
}

async function handleOffscreenMessage(message: Record<string, unknown>): Promise<void> {
  const current = await readState();

  if (message.type === "MODEL_PROGRESS") {
    if (!["starting", "loading_model", "capturing"].includes(current.status)) return;
    const progress = typeof message.progress === "number" ? message.progress : undefined;
    await publishState({
      ...current,
      status: "loading_model",
      message: typeof message.message === "string" ? message.message : "Loading the local Whisper model…",
      progress,
    });
    return;
  }

  if (message.type === "MODEL_READY") {
    if (!["starting", "loading_model", "capturing"].includes(current.status)) return;
    await publishState({ ...current, status: "capturing", message: "Capturing and transcribing locally.", progress: undefined });
    return;
  }

  if (message.type === "TRANSCRIPT_CHUNK") {
    const text = typeof message.text === "string" ? message.text.trim() : "";
    if (!text) return;
    const transcript = current.transcript ? `${current.transcript}\n${text}` : text;
    await publishState({ ...current, transcript });
    return;
  }

  if (message.type === "CAPTURE_ENDED") {
    await publishState({ status: "idle", transcript: current.transcript, message: "The captured tab stopped sending audio." });
    return;
  }

  if (message.type === "OFFSCREEN_ERROR") {
    const detail = typeof message.error === "string" ? message.error : "The local audio processor failed.";
    if (await hasOffscreenDocument()) {
      await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE" }).catch(() => undefined);
    }
    const latest = await readState();
    await publishState({ status: "error", transcript: latest.transcript, message: detail });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ [STORAGE_KEY]: INITIAL_STATE });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "background") return false;

  const task = operation.then(async () => {
    if (message.type === "GET_STATE") {
      let state = await readState();
      if (["starting", "loading_model", "capturing", "stopping"].includes(state.status) && !(await hasOffscreenDocument())) {
        state = await publishState({
          status: "idle",
          transcript: state.transcript,
          message: "Capture is no longer running.",
        });
      }
      return { ok: true, state };
    }

    if (message.type === "START_CAPTURE") {
      if (typeof message.tabId !== "number") throw new Error("No active tab was selected.");
      return { ok: true, state: await startCapture(message.tabId) };
    }

    if (message.type === "STOP_CAPTURE") {
      return { ok: true, state: await stopCapture() };
    }

    if (typeof message.type === "string") {
      await handleOffscreenMessage(message as Record<string, unknown>);
      return { ok: true };
    }

    throw new Error("Unknown extension message.");
  });

  // Keep later messages serial even when one operation fails, while returning
  // the original failure to the caller that triggered it.
  operation = task.then(() => undefined, () => undefined);
  task
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
