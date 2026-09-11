# ConductFlow Meeting Transcript — Phase 1

A Manifest V3 Chrome extension that captures the active browser tab's audio, keeps that audio audible, and transcribes fixed 15-second chunks locally with `Xenova/whisper-tiny.en` through `@huggingface/transformers`.

No audio or transcript is sent to a transcription API. There are no API keys and no per-use charges. On first use, the model files are downloaded from the Hugging Face Hub and cached by the browser for later use. The first download can take a while; the popup shows model-download progress when the library reports it.

## Build

Run these commands from this directory, not from the repository root:

```sh
npm install
npm run build
```

The unpacked extension is written to `dist/`. Its JavaScript, HTML, manifest, icon, and ONNX Runtime Web WASM/module assets are all bundled locally. Model weights remain remote-on-first-use data and are cached by the browser.

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
- The transcript is kept in `chrome.storage.local` so the popup can be reopened without losing it.
- Only one tab capture is supported at a time.

## Manual-test focus

Test the capture path on a normal HTTPS meeting/media tab, confirm the tab remains audible while capture is active, wait through the one-time model download, verify new text appears after the first roughly 15-second chunk, and test both explicit Stop and closing the captured tab.
