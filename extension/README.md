# ConductFlow Meeting Transcript — Phase 1

> **⚠️ Status: NOT YET TESTED IN A REAL BROWSER.** This extension has been verified by build/typecheck/unit
> tests only (see each PR's test plan). Nobody has actually loaded it as an unpacked extension, captured a
> real tab, or confirmed live transcription, audio passthrough, or the meeting-assistant suggestions work
> end to end. Treat everything below as the intended behavior, not a confirmed one, until someone runs
> through "Manual-test focus" below and this notice is removed or updated.

A Manifest V3 Chrome extension that captures the active browser tab's audio, keeps that audio audible, and transcribes fixed 15-second chunks locally with `Xenova/whisper-tiny.en` through `@huggingface/transformers`.

No audio or transcript is sent to a transcription API. There are no API keys and no per-use charges. On first use, the model files are downloaded from the Hugging Face Hub and cached by the browser for later use. The first download can take a while; the popup shows model-download progress when the library reports it.

## Build

Run these commands from this directory, not from the repository root:

```sh
npm install
npm run build
```

The unpacked extension is written to `dist/`. Its JavaScript, HTML, manifest, icon, and ONNX Runtime Web WASM/module assets are all bundled locally. Model weights remain remote-on-first-use data and are cached by the browser.

### Optional meeting assistant

Copy the names from `.env.example` into your shell environment before building:

```sh
MEETING_ASSISTANT_SECRET="your-shared-secret" npm run build
```

- `MEETING_ASSISTANT_URL` selects the suggestion endpoint and defaults to `https://conductflow-woad.vercel.app/api/meeting-assistant`.
- `MEETING_ASSISTANT_SECRET` is the shared secret sent in the `x-assistant-secret` header. If it is unset, the assistant is disabled and no suggestion requests are made.

These values are compiled into the extension bundle at build time, so rebuild after changing them. The default endpoint is included in `manifest.json` host permissions. If you use a different origin, add that origin to `host_permissions` before building. When enabled, each completed transcript chunk is sent to the configured ConductFlow endpoint for suggestions; audio transcription itself remains local.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this directory's `dist/` folder.
5. Open a tab that is playing meeting audio, click the extension, then choose **Start capturing this tab**.

Chrome 116 or newer is required. The extension captures only the selected browser tab: it does not use the microphone, capture system-wide audio, or save audio recordings.

## Phase 1 behavior

- Audio is mixed to mono, divided into approximately 15-second windows, resampled to 16 kHz, and transcribed sequentially.
- Closing the popup does not stop capture. Reopen it to see the accumulated transcript or stop.
- Stopping waits for queued audio chunks to finish, including a final partial chunk of at least one second.
- The transcript and meeting-assistant suggestions are kept in `chrome.storage.local` so the popup can be reopened without losing them.
- Only one tab capture is supported at a time.

## Manual-test focus

Test the capture path on a normal HTTPS meeting/media tab, confirm the tab remains audible while capture is active, wait through the one-time model download, verify new text appears after the first roughly 15-second chunk, and test both explicit Stop and closing the captured tab.
