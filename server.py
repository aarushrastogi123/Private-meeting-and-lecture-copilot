import asyncio
import logging
import mimetypes
import threading
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("recall")

PROJECT_FOLDER = Path(__file__).resolve().parent
MAX_AUDIO_BYTES = 100 * 1024 * 1024
MODEL_NAME = "base"
ALLOWED_SUFFIXES = {".aac", ".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm"}
MIME_SUFFIXES = {
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/mp3": ".mp3",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-m4a": ".m4a",
    "audio/x-wav": ".wav",
    "video/webm": ".webm",
    "audio/webm": ".webm",
}

app = FastAPI(title="Recall — Meeting & Lecture Copilot", docs_url=None, redoc_url=None)
model: WhisperModel | None = None
model_lock = threading.Lock()
transcription_slot = asyncio.Semaphore(1)


def get_model() -> WhisperModel:
    """Load the multilingual CPU model only when the first transcript is requested."""
    global model
    if model is None:
        with model_lock:
            if model is None:
                logger.info("Loading Whisper '%s' on CPU (int8). First run downloads the model.", MODEL_NAME)
                model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    return model


def transcribe_file(path: str, language: str) -> dict:
    whisper = get_model()
    segments, info = whisper.transcribe(path, language=None if language == "auto" else language, beam_size=5, vad_filter=True)
    transcript_segments = [
        {
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip(),
        }
        for segment in segments
        if segment.text.strip()
    ]
    return {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "text": " ".join(segment["text"] for segment in transcript_segments),
        "segments": transcript_segments,
    }


def get_audio_suffix(filename: str | None, content_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in ALLOWED_SUFFIXES:
        return suffix

    mime_type = (content_type or "").split(";", maxsplit=1)[0].strip().lower()
    suffix = MIME_SUFFIXES.get(mime_type) or mimetypes.guess_extension(mime_type)
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail="Unsupported audio format. Choose MP3, M4A, WAV, WebM, OGG, AAC, or FLAC.",
        )
    return suffix


@app.get("/api/health")
def health() -> dict:
    return {"status": "ready", "model_loaded": model is not None, "model": MODEL_NAME}


@app.post("/api/transcribe")
async def transcribe(
    audio: Annotated[UploadFile, File()],
    language: Annotated[str, Form()] = "auto",
) -> dict:
    if language not in {"auto", "hi", "en"}:
        raise HTTPException(status_code=422, detail="Language must be auto, hi (Hindi), or en (English).")

    suffix = get_audio_suffix(audio.filename, audio.content_type)
    temporary_path: str | None = None
    size = 0

    try:
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_audio:
            temporary_path = temp_audio.name
            while chunk := await audio.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise HTTPException(status_code=413, detail="Audio files must be 100 MB or smaller.")
                temp_audio.write(chunk)

        if size == 0:
            raise HTTPException(status_code=400, detail="The selected audio file is empty.")

        async with transcription_slot:
            return await run_in_threadpool(transcribe_file, temporary_path, language)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Local transcription failed")
        raise HTTPException(
            status_code=422,
            detail=f"Could not transcribe this audio. Check that the file is playable and try again ({type(error).__name__}).",
        ) from error
    finally:
        await audio.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(PROJECT_FOLDER / "index.html")


@app.get("/style.css", include_in_schema=False)
def stylesheet() -> FileResponse:
    return FileResponse(PROJECT_FOLDER / "style.css", media_type="text/css")


@app.get("/app.js", include_in_schema=False)
def javascript() -> FileResponse:
    return FileResponse(PROJECT_FOLDER / "app.js", media_type="application/javascript")
