const transcriptInput = document.querySelector("#transcript");
const sampleButton = document.querySelector("#sample-button");
const statusMessage = document.querySelector("#status");
const summarizeButton = document.querySelector("#summarize-button");
const clearTranscriptButton = document.querySelector("#clear-transcript-button");
const recapBox = document.querySelector("#recap");
const actionItemsBox = document.querySelector("#action-items");
const searchInput = document.querySelector("#search-input");
const searchButton = document.querySelector("#search-button");
const searchResultsBox = document.querySelector("#search-results");
const sessionTitleInput = document.querySelector("#session-title");
const saveSessionButton = document.querySelector("#save-session-button");
const savedSessionsSelect = document.querySelector("#saved-sessions");
const openSessionButton = document.querySelector("#open-session-button");
const deleteSessionButton = document.querySelector("#delete-session-button");
const startRecordingButton = document.querySelector("#start-recording-button");
const stopRecordingButton = document.querySelector("#stop-recording-button");
const recordingStatus = document.querySelector("#recording-status");
const audioFileInput = document.querySelector("#audio-file");
const audioFileName = document.querySelector("#audio-file-name");
const transcribeFileButton = document.querySelector("#transcribe-file-button");
const fileStatus = document.querySelector("#file-status");
const downloadNotesButton = document.querySelector("#download-notes-button");

const STORAGE_KEY = "meeting-copilot-sessions";
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const sampleTranscript = `Maya: Let's start planning the campus sustainability event.
Arjun: We should hold it on October 12 in the main courtyard.
Maya: I'll confirm the venue with the student office by Friday.
Sam: I can prepare a poster and share the first draft next Tuesday.
Arjun: We also need volunteers for the recycling booth.
Maya: Let's ask the eco club to send us a list of volunteers.
Sam: The event budget is 8,000 rupees. We should keep track of expenses.`;

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];

function showMessage(container, message) {
  container.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  container.append(paragraph);
}

function getSentences(text) {
  return (
    text
      .replace(/\n+/g, " ")
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  );
}

const stopWords = new Set(
  `a an and are as at be been by for from had has have he her hers him his i if in is it its me my of on or our ours she that the their them they this to was we were what when where which who will with you your`.split(
    " "
  )
);

function analyzeTranscript(text) {
  const sentences = getSentences(text);
  if (sentences.length === 0) {
    return { recap: [], actionItems: [] };
  }

  const wordsBySentence = sentences.map((sentence) =>
    sentence
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter((word) => !stopWords.has(word)) ?? []
  );
  const frequencies = new Map();

  for (const words of wordsBySentence) {
    for (const word of new Set(words)) {
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }
  }

  const importantPattern =
    /\b(decided|decision|agreed|plan|planned|deadline|budget|goal|result|important|because|therefore|so that)\b/i;
  const scoredSentences = sentences.map((sentence, index) => {
    const words = wordsBySentence[index];
    const termScore = words.reduce(
      (total, word) => total + (frequencies.get(word) ?? 0),
      0
    );
    const averageTermScore = words.length ? termScore / words.length : 0;
    const firstSentenceBonus = index === 0 ? 0.4 : 0;
    const importantCueBonus = importantPattern.test(sentence) ? 1.1 : 0;
    const numberBonus = /\b\d+\b/.test(sentence) ? 0.25 : 0;

    return {
      sentence,
      index,
      score: averageTermScore + firstSentenceBonus + importantCueBonus + numberBonus,
    };
  });

  const recap = [...scoredSentences]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(3, sentences.length))
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence);

  const actionPattern =
    /\b(i(?:'ll| will| can| am going to)|we(?:'ll| will|(?: also)? need(?: to)?| should| have to)|need to|should|let's|action item|follow[- ]?up|deadline|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|tomorrow))\b/i;
  const actionItems = sentences.filter((sentence) => actionPattern.test(sentence));

  return { recap, actionItems };
}

function renderAnalysis(analysis) {
  if (analysis.recap.length === 0) {
    showMessage(recapBox, "Add a transcript to create a recap.");
  } else {
    showMessage(recapBox, analysis.recap.join(" "));
  }

  actionItemsBox.replaceChildren();
  if (analysis.actionItems.length === 0) {
    showMessage(actionItemsBox, "No possible action items found.");
    return;
  }

  const list = document.createElement("ul");
  for (const action of analysis.actionItems) {
    const item = document.createElement("li");
    item.textContent = action;
    list.append(item);
  }
  actionItemsBox.append(list);
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const clock = [minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return hours > 0 ? `${String(hours).padStart(2, "0")}:${clock}` : clock;
}

function formatTranscription(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return "";
  return segments
    .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`)
    .join("\n");
}

function appendTranscript(text) {
  const cleanText = text.trim();
  if (!cleanText) throw new Error("The transcription did not contain any speech.");

  const existingText = transcriptInput.value.trim();
  transcriptInput.value = existingText
    ? `${existingText}\n${cleanText}`
    : cleanText;
  statusMessage.textContent = "Transcript updated. Create a recap or save this session.";
}

async function transcribeAudio(audioBlob, filename, statusElement, button) {
  if (audioBlob.size > MAX_AUDIO_BYTES) {
    statusElement.textContent = "Audio files must be 100 MB or smaller.";
    return;
  }

  button.disabled = true;
  statusElement.textContent = "Transcribing on this computer. The first run may download the model…";

  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, filename);

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.detail || `Local service error (${response.status}).`);
    }

    appendTranscript(formatTranscription(result.segments) || result.text || "");
    statusElement.textContent = `Transcription complete · ${result.language || "language detected"} (auto-detected).`;
  } catch (error) {
    statusElement.textContent = `Transcription failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function readSessions() {
  try {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(sessions)
      ? sessions.filter((session) => session && session.id && session.title)
      : [];
  } catch {
    statusMessage.textContent = "Saved sessions could not be read from this browser.";
    return [];
  }
}

function refreshSessionList(selectedId = "") {
  savedSessionsSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a session";
  savedSessionsSelect.append(placeholder);

  for (const session of readSessions()) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = session.title;
    savedSessionsSelect.append(option);
  }
  savedSessionsSelect.value = selectedId;
}

function renderSearchResults(matches, query) {
  searchResultsBox.replaceChildren();
  if (matches.length === 0) {
    showMessage(searchResultsBox, `No matches found for “${query}”.`);
    return;
  }

  for (const match of matches) {
    const result = document.createElement("p");
    result.className = "match";
    result.textContent = match;
    searchResultsBox.append(result);
  }
}

function searchTranscript() {
  const query = searchInput.value.trim();
  if (!query) {
    showMessage(searchResultsBox, "Enter a word or phrase to search.");
    searchInput.focus();
    return;
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const matches = getSentences(transcriptInput.value).filter((sentence) =>
    sentence.toLocaleLowerCase().includes(normalizedQuery)
  );
  renderSearchResults(matches, query);
}

function saveCurrentSession() {
  const transcript = transcriptInput.value.trim();
  if (!transcript) {
    statusMessage.textContent = "Add a transcript before saving.";
    transcriptInput.focus();
    return;
  }

  const title = sessionTitleInput.value.trim() || `Session ${new Date().toLocaleString()}`;
  const sessions = readSessions();
  const session = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    transcript,
    analysis: analyzeTranscript(transcript),
    savedAt: new Date().toISOString(),
  };

  try {
    sessions.push(session);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    refreshSessionList(session.id);
    statusMessage.textContent = "Session saved in this browser. Browser storage is not encrypted.";
  } catch {
    statusMessage.textContent = "Could not save the session. Browser storage may be full.";
  }
}

function openSelectedSession() {
  const session = readSessions().find((item) => item.id === savedSessionsSelect.value);
  if (!session) {
    statusMessage.textContent = "Choose a saved session first.";
    return;
  }

  transcriptInput.value = session.transcript;
  sessionTitleInput.value = session.title;
  renderAnalysis(session.analysis || analyzeTranscript(session.transcript));
  showMessage(searchResultsBox, "Search this transcript to find a detail.");
  statusMessage.textContent = `Opened “${session.title}”.`;
}

function deleteSelectedSession() {
  const sessionId = savedSessionsSelect.value;
  if (!sessionId) {
    statusMessage.textContent = "Choose a saved session to delete.";
    return;
  }

  const session = readSessions().find((item) => item.id === sessionId);
  if (!session || !window.confirm(`Delete “${session.title}” from this browser?`)) return;

  try {
    const sessions = readSessions().filter((item) => item.id !== sessionId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    refreshSessionList();
    statusMessage.textContent = "Saved session deleted from this browser.";
  } catch {
    statusMessage.textContent = "Could not update saved sessions in browser storage.";
  }
}

function buildNotesText() {
  const transcript = transcriptInput.value.trim();
  const analysis = analyzeTranscript(transcript);
  return [
    sessionTitleInput.value.trim() || "Meeting & Lecture Notes",
    `Exported: ${new Date().toLocaleString()}`,
    "",
    "KEY POINTS",
    analysis.recap.length ? analysis.recap.join("\n") : "No recap available.",
    "",
    "POSSIBLE ACTION ITEMS (PLEASE VERIFY)",
    analysis.actionItems.length ? analysis.actionItems.map((item) => `- ${item}`).join("\n") : "No possible action items found.",
    "",
    "TRANSCRIPT",
    transcript || "No transcript added.",
    "",
    "Generated locally by Recall. Recap and action items are heuristic suggestions; verify before relying on them.",
  ].join("\n");
}

function downloadNotes() {
  const title = sessionTitleInput.value.trim() || "meeting-notes";
  const filename =
    title
      .normalize("NFKD")
      .replace(/[^\w -]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .toLowerCase() || "meeting-notes";
  const file = new Blob([buildNotesText()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

sampleButton.addEventListener("click", () => {
  transcriptInput.value = sampleTranscript;
  sessionTitleInput.value = "Campus sustainability event";
  statusMessage.textContent = "Sample transcript loaded. Create a recap to see key points and possible tasks.";
});

summarizeButton.addEventListener("click", () => {
  const transcript = transcriptInput.value.trim();
  if (!transcript) {
    statusMessage.textContent = "Add a transcript before creating a recap.";
    transcriptInput.focus();
    return;
  }
  renderAnalysis(analyzeTranscript(transcript));
  statusMessage.textContent = "Recap created. Check suggested action items for accuracy.";
});

clearTranscriptButton.addEventListener("click", () => {
  transcriptInput.value = "";
  searchInput.value = "";
  showMessage(recapBox, "Your recap will appear here.");
  showMessage(actionItemsBox, "Possible tasks and deadlines will appear here.");
  showMessage(searchResultsBox, "Matching lines will appear here.");
  statusMessage.textContent = "Transcript cleared. Saved sessions were not changed.";
  transcriptInput.focus();
});

transcriptInput.addEventListener("input", () => {
  if (transcriptInput.value.trim()) statusMessage.textContent = "Transcript edited. Create a fresh recap before saving.";
});

searchButton.addEventListener("click", searchTranscript);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchTranscript();
});
saveSessionButton.addEventListener("click", saveCurrentSession);
openSessionButton.addEventListener("click", openSelectedSession);
deleteSessionButton.addEventListener("click", deleteSelectedSession);
downloadNotesButton.addEventListener("click", downloadNotes);

audioFileInput.addEventListener("change", () => {
  audioFileName.textContent = audioFileInput.files[0]?.name || "Choose an audio file";
  fileStatus.textContent = audioFileInput.files[0]
    ? `${(audioFileInput.files[0].size / (1024 * 1024)).toFixed(1)} MB selected.`
    : "Audio is processed on this computer.";
});

transcribeFileButton.addEventListener("click", () => {
  const file = audioFileInput.files[0];
  if (!file) {
    fileStatus.textContent = "Choose an audio file first.";
    audioFileInput.focus();
    return;
  }
  void transcribeAudio(file, file.name, fileStatus, transcribeFileButton);
});

startRecordingButton.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      recordingStatus.textContent = "Microphone recording is not supported in this browser.";
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener("error", () => {
      recordingStatus.textContent = "The browser could not record audio. Try uploading an audio file instead.";
      mediaStream?.getTracks().forEach((track) => track.stop());
      startRecordingButton.disabled = false;
      stopRecordingButton.disabled = true;
    });
    mediaRecorder.addEventListener("stop", async () => {
      mediaStream?.getTracks().forEach((track) => track.stop());
      const type = mediaRecorder.mimeType || "audio/webm";
      const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const audio = new Blob(recordedChunks, { type });
      recordedChunks = [];
      await transcribeAudio(audio, `recording.${extension}`, recordingStatus, stopRecordingButton);
      startRecordingButton.disabled = false;
      stopRecordingButton.disabled = true;
    });

    mediaRecorder.start(1000);
    startRecordingButton.disabled = true;
    stopRecordingButton.disabled = false;
    recordingStatus.textContent = "Recording… Select stop when you’re done.";
  } catch (error) {
    mediaStream?.getTracks().forEach((track) => track.stop());
    recordingStatus.textContent = error.name === "NotAllowedError"
      ? "Microphone permission was denied. You can still choose an audio file."
      : `Could not start recording: ${error.message}`;
  }
});

stopRecordingButton.addEventListener("click", () => {
  if (mediaRecorder?.state === "recording") {
    stopRecordingButton.disabled = true;
    recordingStatus.textContent = "Finishing recording…";
    mediaRecorder.stop();
  }
});

refreshSessionList();
