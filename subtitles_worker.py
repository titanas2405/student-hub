#!/usr/bin/env python3
"""Transcribe a uniflix lecture into Greek subtitles, and optionally pick its slide/board frames.

Run by server.py with the Python of the Whisper environment:
    ~/.local/share/student-hub/whisper/bin/python subtitles_worker.py URL OUT.vtt MODEL [TOPIC]

The video is read once and handled in parts of about PART_SECONDS, cut at a quiet moment: as soon as a part has
been downloaded, its keyframes where the picture changed (new slide, new board) are saved to FRAMES_DIR (when
set) and its audio is transcribed in the background while the download goes on. So the first parts are ready
long before the whole lecture is.

Transcription uses Groq's hosted Whisper when GROQ_API_KEY is set (the audio is sent to Groq), and Whisper on
this computer otherwise, or for whatever is left when Groq's free limit runs out. SKIP_TRANSCRIBE=1 only picks
frames (the lecture already has subtitles).

Cues are appended to OUT.vtt as they're recognized. Progress goes to stdout as JSON lines:
    {"stage": "download"|"transcribe", "done": seconds, "duration": seconds}
    {"part": i, "start": s, "end": s, "frames": [{"id", "t"}]}     a part was downloaded (frames picked)
    {"transcribed": i, "end": s}                                    a part's subtitles are written
    {"engine": "groq"|"local"}, {"notice": text}
"""

import io
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

RATE = 16000
MAX_CUE_CHARS = 84          # two subtitle lines
MAX_CUE_SECONDS = 6.0
GROQ_URL = os.environ.get("GROQ_URL", "https://api.groq.com/openai/v1/audio/transcriptions")
GROQ_MODEL = "whisper-large-v3"
PART_SECONDS = int(os.environ.get("STUDENT_HUB_PART_SECONDS") or 600)          # a part: transcribed (one Groq request, ~3 MB as Opus) and summarized on its own
GROQ_MAX_WAIT = 20 * 60     # longest pause for Groq's rate limit before switching to Whisper here
FRAME_WIDTH = 1024
FRAME_MIN_GAP = 2.0         # seconds between keyframes worth looking at
FRAME_CHANGE = 7.0          # mean grey-level difference (0-255) that counts as a new picture
FRAME_EVERY = 180.0         # keep a frame at least this often, even when the picture barely changes
FRAMES_PER_PART = 5
# Whisper's well-known inventions on silence (credits of the subtitled videos it was trained on)
HALLUCINATIONS = re.compile(r"υπότιτλ|authorwave|ευχαριστώ που παρακολουθ|subtitles by", re.I)


class RangeFile(io.RawIOBase):
    """Seekable read-only view of an HTTPS file, fetched in 1 MB ranges (PyAV's own https support is missing)."""
    BLOCK = 1 << 20

    def __init__(self, url):
        self.url, self.pos, self.cache = url, 0, {}
        with self._get(0, 0) as r:
            self.size = int(r.headers["Content-Range"].split("/")[1])

    def _get(self, a, b):
        req = urllib.request.Request(self.url, headers={"User-Agent": "Mozilla/5.0 StudentHub", "Range": f"bytes={a}-{b}"})
        return urllib.request.urlopen(req, timeout=60)

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i):
        if i not in self.cache:
            if len(self.cache) > 8:
                self.cache.pop(next(iter(self.cache)))
            a = i * self.BLOCK
            with self._get(a, min(a + self.BLOCK, self.size) - 1) as r:
                self.cache[i] = r.read()
        return self.cache[i]

    def readinto(self, buf):
        if self.pos >= self.size:
            return 0
        i, off = divmod(self.pos, self.BLOCK)
        data = self._block(i)[off:off + len(buf)]
        buf[:len(data)] = data
        self.pos += len(data)
        return len(data)


_out = threading.Lock()


def emit(**kw):
    with _out:
        print(json.dumps(kw, ensure_ascii=False), flush=True)


class FramePicker:
    """Keeps keyframes where the picture changed; at the end of each part, the most distinct ones of that part."""

    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        for old in [*self.folder.glob("*.jpg"), self.folder / "frames.json"]:
            old.unlink(missing_ok=True)
        self.candidates, self.last_t, self.prev, self.listing = [], -1e9, None, []

    def add(self, frame, t):
        if t - self.last_t < FRAME_MIN_GAP:
            return
        self.last_t = t
        thumb = frame.reformat(width=64, height=36, format="gray").to_ndarray().astype(np.float32)
        if thumb.mean() < 12:                       # black screen before the lecture starts
            return
        change = 255.0 if self.prev is None else float(np.abs(thumb - self.prev).mean())
        since = t - self.candidates[-1][0] if self.candidates else 1e9
        if change < FRAME_CHANGE and since < FRAME_EVERY:
            return
        self.prev = thumb
        path = self.folder / f"c{len(self.listing)}_{len(self.candidates):05d}.jpg"
        path.write_bytes(jpeg(frame))
        self.candidates.append((t, change, path))

    def finish_part(self, end):
        """Frames of the part ending at `end`: the biggest changes first, never two within a short gap."""
        part = [c for c in self.candidates if c[0] < end]
        self.candidates = [c for c in self.candidates if c[0] >= end]
        chosen = []
        for t, change, path in sorted(part, key=lambda c: -c[1]):
            if len(chosen) < FRAMES_PER_PART and all(abs(t - c[0]) >= 45 for c in chosen):
                chosen.append((t, change, path))
        keep = {c[2] for c in chosen}
        for _, _, path in part:
            if path not in keep:
                path.unlink(missing_ok=True)
        out = []
        for t, _, path in sorted(chosen):
            fid = f"F{len(self.listing) + 1:03d}"
            path.replace(self.folder / f"{fid}.jpg")
            self.listing.append({"id": fid, "t": round(t, 1)})
            out.append(self.listing[-1])
        tmp = self.folder / "frames.tmp"
        tmp.write_text(json.dumps(self.listing), encoding="utf-8")
        tmp.replace(self.folder / "frames.json")
        return out


def jpeg(frame):
    w = min(FRAME_WIDTH, frame.width) // 2 * 2
    h = max(2, round(frame.height * w / frame.width / 2) * 2)
    cc = av.CodecContext.create("mjpeg", "w")
    cc.width, cc.height, cc.pix_fmt, cc.time_base = w, h, "yuvj420p", Fraction(1, 25)
    cc.bit_rate = 25 * 900_000              # ~110 KB budget per picture: sharp slide text
    img = frame.reformat(width=w, height=h, format="yuvj420p")
    return b"".join(bytes(p) for p in cc.encode(img)) + b"".join(bytes(p) for p in cc.encode(None))


def quiet_cut(audio, near):
    """Sample index of the quietest moment in the 30 s before `near` (a good place to end a part)."""
    lo = max(0, near - 30 * RATE)
    win, hop = audio[lo:near], RATE // 10
    if len(win) < hop:
        return near
    energy = np.sqrt(np.mean(win[:len(win) // hop * hop].reshape(-1, hop) ** 2, axis=1))
    return lo + int(np.argmin(energy)) * hop + hop // 2


def read_lecture(url, want_audio, frames, on_part, limit=0):
    """One pass over the video. Calls on_part(index, start, end, audio) as each part is downloaded."""
    with av.open(RangeFile(url), mode="r") as c:
        duration = (c.duration or 0) / 1_000_000
        if limit:
            duration = min(duration, limit) if duration else limit
        streams = []
        if want_audio and c.streams.audio:
            streams.append(c.streams.audio[0])
        video = c.streams.video[0] if frames and c.streams.video else None
        if video:
            video.codec_context.skip_frame = "NONKEY"
            streams.append(video)
        if not streams:
            raise RuntimeError("The video has no audio")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        pending, buffered = [], 0            # audio of the current part (s16 chunks)
        part, start, reported = 0, 0.0, -1e9

        def cut(end_t, last=False):
            nonlocal pending, buffered, part, start
            audio = np.concatenate(pending).astype(np.float32) / 32768.0 if pending else np.zeros(0, np.float32)
            if want_audio and not last:
                at = quiet_cut(audio, len(audio))
                end_t, rest = start + at / RATE, audio[at:]
                audio = audio[:at]
                pending = [(rest * 32768).astype(np.int16)] if len(rest) else []
            else:
                pending = []
            buffered = sum(len(p) for p in pending)
            on_part(part, start, end_t, audio)
            part, start = part + 1, end_t

        for packet in c.demux(*streams):
            if packet.pts is None:
                continue
            t = float(packet.pts * packet.time_base)
            if limit and t > limit:
                break
            if packet.stream is video:
                if packet.is_keyframe:
                    for frame in packet.decode():
                        frames.add(frame, t)
            else:
                for frame in packet.decode():
                    for f in resampler.resample(frame):
                        pending.append(f.to_ndarray().reshape(-1))
                        buffered += len(pending[-1])
            # a part is complete once audio (or, without audio, the video) has gone past its length
            if (buffered / RATE if want_audio else t - start) >= PART_SECONDS and \
                    (not duration or duration - (start + PART_SECONDS) > 60):     # no tiny last part
                cut(t)
            if t - reported >= 15:
                reported = t
                emit(stage="download", done=round(t, 1), duration=round(duration, 1))
        if want_audio:
            for f in resampler.resample(None):
                pending.append(f.to_ndarray().reshape(-1))
        end = start + sum(len(p) for p in pending) / RATE if want_audio else max(duration, start)
        cut(end, last=True)
    return duration


def stamp(t):
    h, rest = divmod(max(t, 0), 3600)
    m, s = divmod(rest, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def split_cue(start, end, text):
    """Whisper segments can be whole paragraphs; split them into subtitle-sized pieces, timed by length."""
    words, pieces, line = text.split(), [], ""
    for w in words:
        if line and len(line) + 1 + len(w) > MAX_CUE_CHARS:
            pieces.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    if line:
        pieces.append(line)
    total = sum(len(p) for p in pieces) or 1
    t, out = start, []
    for p in pieces:
        dur = (end - start) * len(p) / total
        out.append((t, min(t + dur, t + MAX_CUE_SECONDS) if len(pieces) == 1 else t + dur, p))
        t += dur
    return out


# ---- Groq (hosted Whisper large)

class GroqUnavailable(Exception):
    pass


def opus(audio):
    buf = io.BytesIO()
    with av.open(buf, "w", format="ogg") as out:
        st = out.add_stream("libopus", rate=RATE, layout="mono")
        st.bit_rate = 32000
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        n = st.codec_context.frame_size or 320
        for i in range(0, len(pcm), n):
            fr = av.AudioFrame.from_ndarray(pcm[None, i:i + n], format="s16", layout="mono")
            fr.sample_rate = RATE
            for p in st.encode(fr):
                out.mux(p)
        for p in st.encode(None):
            out.mux(p)
    return buf.getvalue()


def retry_wait(err):
    """Seconds Groq asks us to wait, from Retry-After or its message ("try again in 7m12.5s")."""
    try:
        return float(err.headers.get("retry-after"))
    except (TypeError, ValueError):
        pass
    try:
        msg = err.read().decode("utf-8", "replace")
    except OSError:
        msg = ""
    m = re.search(r"try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", msg)
    if m and any(m.groups()):
        h, mi, s = (float(x or 0) for x in m.groups())
        return h * 3600 + mi * 60 + s
    return 3600.0


def groq_request(data, key, topic):
    boundary = uuid.uuid4().hex
    fields = {"model": GROQ_MODEL, "language": "el", "response_format": "verbose_json", "temperature": "0"}
    if topic:
        fields["prompt"] = f"Πανεπιστημιακή διάλεξη: {topic}."[:300]
    body = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
                    for k, v in fields.items())
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="lecture.ogg"\r\n'
             f"Content-Type: audio/ogg\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(GROQ_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}",
        "User-Agent": "StudentHub"})
    failures = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read()).get("segments") or []
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise GroqUnavailable("Το κλειδί Groq δεν δέχτηκε — έλεγξέ το") from None
            if e.code == 429:
                wait = retry_wait(e)
                if wait > GROQ_MAX_WAIT:          # the daily limit: Whisper here is faster than waiting
                    raise GroqUnavailable("Τελείωσε το δωρεάν όριο του Groq για σήμερα") from None
                if wait > 30:                     # the hourly limit: a pause beats hours of local Whisper
                    emit(notice=f"Όριο ανά ώρα του Groq: συνεχίζει σε {max(1, round(wait / 60))} λεπτά")
                time.sleep(wait + 1)
                emit(notice="")
                continue
            failures += 1
            if failures > 2:
                raise GroqUnavailable(f"Το Groq απάντησε με σφάλμα {e.code}") from None
        except (urllib.error.URLError, OSError, ValueError):
            failures += 1
            if failures > 2:
                raise GroqUnavailable("Δεν υπάρχει σύνδεση με το Groq") from None
        time.sleep(5 * failures)


def keep_segment(s):
    text = (s.get("text") or "").strip()
    return text and not HALLUCINATIONS.search(text) and (s.get("no_speech_prob") or 0) < 0.8 \
        and (s.get("compression_ratio") or 0) < 2.6


class Transcriber(threading.Thread):
    """Transcribes parts in order as they arrive: Groq while it lasts, then Whisper on this computer."""

    def __init__(self, out_path, model_name, topic, key):
        super().__init__(daemon=True)
        self.parts, self.error = queue.Queue(), None
        self.out = open(out_path, "w", encoding="utf-8")
        self.out.write("WEBVTT\n\n")
        self.out.flush()
        self.model_name, self.topic, self.key, self.model = model_name, topic, key, None
        emit(engine="groq" if key else "local")

    def write(self, start, end, text):
        for a, b, piece in split_cue(start, end, text):
            self.out.write(f"{stamp(a)} --> {stamp(b)}\n{piece}\n\n")
        self.out.flush()

    def groq(self, start, end, audio):
        for s in groq_request(opus(audio), self.key, self.topic):
            if keep_segment(s) and start + s["start"] < end:
                self.write(start + s["start"], min(start + s["end"], end), s["text"].strip())

    def local(self, start, audio):
        if self.model is None:
            from faster_whisper import WhisperModel
            self.model = WhisperModel(self.model_name, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
        segments, _ = self.model.transcribe(
            audio, language="el", beam_size=1, vad_filter=True, condition_on_previous_text=False,
            initial_prompt=f"Πανεπιστημιακή διάλεξη: {self.topic}." if self.topic else None)
        for seg in segments:
            text = seg.text.strip()
            if text and not HALLUCINATIONS.search(text):
                self.write(start + seg.start, start + seg.end, text)
            emit(stage="transcribe", done=round(start + seg.end, 1))

    def run(self):
        try:
            while (item := self.parts.get()) is not None:
                i, start, end, audio = item
                if self.key:
                    try:
                        self.groq(start, end, audio)
                    except GroqUnavailable as e:
                        self.key = ""
                        emit(notice=f"{e} — συνεχίζει τοπικά (πιο αργά)")
                        emit(engine="local")
                if not self.key:
                    self.local(start, audio)
                emit(transcribed=i, end=round(end, 1))
                emit(stage="transcribe", done=round(end, 1))
        except Exception as e:                 # reported by main()
            self.error = e
        finally:
            self.out.close()


def main():
    url, out_path, model_name = sys.argv[1:4]
    topic = sys.argv[4] if len(sys.argv) > 4 else ""
    key = os.environ.get("GROQ_API_KEY", "").strip()
    skip = os.environ.get("SKIP_TRANSCRIBE") == "1"
    frames_dir = os.environ.get("FRAMES_DIR")
    try:
        os.nice(15)                     # the video player and the browser come first
    except OSError:
        pass
    picker = FramePicker(frames_dir) if frames_dir else None
    worker = None if skip else Transcriber(out_path, model_name, topic, key)
    if worker:
        worker.start()

    def on_part(i, start, end, audio):
        emit(part=i, start=round(start, 1), end=round(end, 1), frames=picker.finish_part(end) if picker else [])
        if worker:
            if worker.error:
                raise worker.error
            worker.parts.put((i, start, end, audio))

    duration = read_lecture(url, not skip, picker, on_part, float(os.environ.get("STUDENT_HUB_SUBS_LIMIT") or 0))
    if worker:
        worker.parts.put(None)
        worker.join()
        if worker.error:
            raise worker.error
        emit(stage="transcribe", done=duration, duration=duration)


if __name__ == "__main__":
    main()
