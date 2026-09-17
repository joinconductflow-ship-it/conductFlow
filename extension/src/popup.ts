// @ts-nocheck -- This entry point is compiled by the independent extension build, not the root Next.js project.
export {};

type CaptureStatus = "idle" | "starting" | "loading_model" | "capturing" | "stopping" | "sending" | "error";

interface CaptureState {
  status: CaptureStatus;
  transcript: string;
  suggestions: string[];
  message: string;
  progress?: number;
}

interface RuntimeResponse {
  ok: boolean;
  state?: CaptureState;
  error?: string;
}

const tokenInput = document.querySelector<HTMLInputElement>("#token")!;
const clientNameInput = document.querySelector<HTMLInputElement>("#client-name")!;
const clientEmailInput = document.querySelector<HTMLInputElement>("#client-email")!;
const autoSendCheckbox = document.querySelector<HTMLInputElement>("#auto-send")!;
const saveSettingsButton = document.querySelector<HTMLButtonElement>("#save-settings")!;

const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy")!;
const sendNowButton = document.querySelector<HTMLButtonElement>("#send-now")!;
const transcript = document.querySelector<HTMLTextAreaElement>("#transcript")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const suggestionList = document.querySelector<HTMLUListElement>("#suggestion-list")!;
const suggestionEmpty = document.querySelector<HTMLParagraphElement>("#suggestion-empty")!;

function render(state: CaptureState): void {
  transcript.value = state.transcript;
  transcript.scrollTop = transcript.scrollHeight;

  const suggestions = Array.isArray(state.suggestions) ? state.suggestions : [];
  suggestionList.replaceChildren(...suggestions.map((suggestion) => {
    const item = document.createElement("li");
    item.textContent = suggestion;
    return item;
  }));
  suggestionList.hidden = suggestions.length === 0;
  suggestionEmpty.hidden = suggestions.length > 0;

  const busy = state.status !== "idle" && state.status !== "error";
  startButton.disabled = busy;
  stopButton.disabled = !busy || ["starting", "stopping", "sending"].includes(state.status);
  copyButton.disabled = state.transcript.trim().length === 0;
  sendNowButton.disabled = state.transcript.trim().length === 0 || state.status === "sending";

  const progress = state.progress === undefined ? "" : ` (${Math.round(state.progress)}%)`;
  status.textContent = `${state.message}${progress}`;
  status.dataset.kind = state.status === "error" ? "error" : "normal";
}

async function request(message: object): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage({ target: "background", ...message });
}

async function refresh(): Promise<void> {
  const response = await request({ type: "GET_STATE" });
  if (response.ok && response.state) {
    render(response.state);
  } else {
    render({
      status: "error", transcript: transcript.value, suggestions: [],
      message: response.error ?? "Unable to read extension state.",
    });
  }
}

startButton.addEventListener("click", async () => {
  try {
    render({ status: "starting", transcript: "", suggestions: [], message: "Starting tab capture…" });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined) {
      throw new Error("Chrome did not provide an active tab ID.");
    }

    const response = await request({ type: "START_CAPTURE", tabId: tab.id });
    if (!response.ok) {
      throw new Error(response.error ?? "Unable to start tab capture.");
    }
    if (response.state) render(response.state);
  } catch (error) {
    render({
      status: "error",
      transcript: transcript.value,
      suggestions: [],
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  status.textContent = "Stopping and finishing queued audio…";
  const response = await request({ type: "STOP_CAPTURE" });
  if (response.state) render(response.state);
  if (!response.ok) {
    status.textContent = response.error ?? "Unable to stop capture.";
    status.dataset.kind = "error";
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(transcript.value);
    status.textContent = "Transcript copied.";
    status.dataset.kind = "normal";
  } catch {
    status.textContent = "Chrome could not copy the transcript.";
    status.dataset.kind = "error";
  }
});

sendNowButton.addEventListener("click", async () => {
  sendNowButton.disabled = true;
  status.textContent = "Sending transcript to ConductFlow…";
  status.dataset.kind = "normal";
  const response = await request({ type: "SEND_TRANSCRIPT", text: transcript.value });
  const result = (response as { result?: { ok: boolean; message: string } }).result;
  if (result) {
    status.textContent = result.message;
    status.dataset.kind = result.ok ? "normal" : "error";
  } else {
    status.textContent = response.error ?? "Unable to send the transcript.";
    status.dataset.kind = "error";
  }
  sendNowButton.disabled = transcript.value.trim().length === 0;
});

async function loadSettings(): Promise<void> {
  const response = await request({ type: "GET_SETTINGS" });
  const settings = (response as { settings?: Record<string, unknown> }).settings;
  if (!settings) return;
  tokenInput.value = typeof settings.token === "string" ? settings.token : "";
  clientNameInput.value = typeof settings.clientName === "string" ? settings.clientName : "";
  clientEmailInput.value = typeof settings.clientEmail === "string" ? settings.clientEmail : "";
  autoSendCheckbox.checked = settings.autoSend !== false;
  // Setup only needs opening once, the first time, or to fix something, so leave it closed
  // when a token is already configured.
  const setup = document.querySelector<HTMLDetailsElement>("#setup")!;
  setup.open = !tokenInput.value;
}

saveSettingsButton.addEventListener("click", async () => {
  await request({
    type: "SET_SETTINGS",
    settings: {
      token: tokenInput.value.trim(),
      clientName: clientNameInput.value.trim(),
      clientEmail: clientEmailInput.value.trim(),
      autoSend: autoSendCheckbox.checked,
    },
  });
  status.textContent = "Setup saved.";
  status.dataset.kind = "normal";
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "popup" && message.type === "STATE_UPDATED") {
    render(message.state as CaptureState);
  }
});

void refresh();
void loadSettings();
// Warms the local Whisper model as soon as the popup opens, so the first Start click
// after that doesn't have to wait through the model's one-time load.
void request({ type: "WARM_MODEL" });
