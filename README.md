# Recall — Meeting & Lecture Copilot

Recall turns lecture and meeting audio into a timestamped transcript, a quick recap, searchable lines, and possible follow-up tasks. It is a local-first prototype for students and small teams.

## Features

- Record through the browser microphone or choose an existing audio file.
- Transcribe locally with the multilingual Whisper `base` model through faster-whisper on CPU using int8 inference. Choose Hindi or English explicitly, or leave language detection on Auto. For Hindi audio, select Hindi if automatic detection returns Urdu.
- Keep transcript timestamps so a listener can locate a passage in the original recording.
- Create a lightweight extractive recap and identify possible action items using local text rules. Review suggestions before relying on them.
- Search transcripts, save sessions in browser storage, reopen/delete sessions, and export notes as a text file.

## Requirements

- Windows, macOS, or Linux
- Python 3.9 or newer (Python 3.13 works with current Windows wheels)
- An internet connection for installing packages and downloading the model the first time
- A supported browser for microphone capture; otherwise use an audio file

## Run on Windows (PowerShell)

Open PowerShell in this project folder and run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Keep the PowerShell window open while using Recall. The first transcription downloads the Whisper model; later inference runs locally without an AI API.

## Run on macOS or Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Privacy and limitations

- The server binds to `127.0.0.1`, so the app is intended for use on this computer. Audio is sent only to that local server for transcription.
- Package installation and the first model download require internet access. Audio content is not sent to a hosted AI service by the app.
- Uploaded/recorded audio is written to a temporary file for inference and deleted afterward. Browser recordings are not retained by the app.
- Saved sessions use the browser's `localStorage`. That storage is not encrypted and may be readable by other people using the same computer/browser profile. Use fictional or non-sensitive content in demos; delete sessions when finished.
- Recaps and action items are heuristic suggestions, not a generative-language-model summary. They can miss or misclassify details. Confirm names, decisions, owners, and deadlines against the transcript.
- Speaker diarization is not included. The transcript does not identify who spoke unless names are already spoken aloud.
- Performance and transcript quality depend on CPU speed, microphone quality, language, and recording conditions.

## Project structure

```text
index.html       Browser interface
style.css        Responsive styles
app.js           Browser interactions and local session management
server.py        Local FastAPI server and faster-whisper transcription
requirements.txt Python dependencies
```
