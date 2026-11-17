"""One bounded cached ASR model for the source's full and focused WAV windows.

The local worker receives paths only. Its transcripts cross a private pipe in
memory; diagnostics, stderr and exception text are never returned or logged.
"""

from itertools import islice
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
from time import monotonic

from audit_tip_v11_speech import (
    LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS, MAX_RECOGNIZED_WORDS, RECOGNITION_TIMEOUT_SECONDS,
    load_speech_model, recognize_model_wav,
)

MODEL_LOAD_TIMEOUT_SECONDS = 120
SESSION_TIMEOUT_SECONDS = 330
MAX_MESSAGE_BYTES = 128 * 1024


class SourceAsrSession:
    """Keep decoder deadlines independent of a single measured model startup."""

    def __init__(self, directory):
        self.directory = Path(directory).resolve(strict=True)
        self.process = None
        self.selector = None
        self.buffer = b''
        self.deadline = monotonic() + SESSION_TIMEOUT_SECONDS

    def _receive(self, timeout):
        deadline = min(self.deadline, monotonic() + timeout)
        while b'\n' not in self.buffer:
            remaining = deadline - monotonic()
            if remaining <= 0 or not self.selector.select(remaining):
                self.close()
                raise subprocess.TimeoutExpired('source_asr', timeout)
            chunk = os.read(self.process.stdout.fileno(), 8192)
            if not chunk:
                code = self.process.poll()
                self.close()
                raise subprocess.CalledProcessError(code if code is not None else 2, 'source_asr')
            self.buffer += chunk
            if len(self.buffer) > MAX_MESSAGE_BYTES:
                self.close()
                raise ValueError('Oversized source ASR response')
        line, self.buffer = self.buffer.split(b'\n', 1)
        # Exactly one response is permitted for every local request.
        if self.buffer:
            self.close()
            raise ValueError('Unexpected source ASR response')
        message = json.loads(line)
        if not isinstance(message, dict):
            raise ValueError('Invalid source ASR response')
        if message.get('status') == 'error':
            # The worker deliberately discards the underlying exception text.
            raise RuntimeError('Source ASR unavailable')
        return message

    def start(self):
        if self.process is not None:
            raise RuntimeError('Source ASR already started')
        self.process = subprocess.Popen(
            [sys.executable, '-u', str(Path(__file__).resolve()), str(self.directory)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env={**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'},
        )
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        if self._receive(MODEL_LOAD_TIMEOUT_SECONDS) != {'status': 'ready'}:
            raise ValueError('Invalid source ASR startup')
        return []

    def recognize(self, path, timeout=RECOGNITION_TIMEOUT_SECONDS):
        path = Path(path)
        if (self.process is None or self.process.poll() is not None or path.is_symlink()
            or path.resolve(strict=True).parent != self.directory or path.suffix != '.wav'
            or not path.is_file() or not 0 < path.stat().st_size <= 8 * 1024 * 1024):
            raise ValueError('Invalid source ASR audio input')
        self.process.stdin.write(json.dumps({'wav': str(path.resolve())}).encode() + b'\n')
        self.process.stdin.flush()
        message = self._receive(timeout)
        rows = message.get('rows')
        if set(message) != {'rows'} or not isinstance(rows, list) or len(rows) > MAX_RECOGNIZED_WORDS:
            raise ValueError('Invalid source ASR word rows')
        return rows

    def recognize_window(self, path):
        return self.recognize(path, LOCAL_SPEECH_WINDOW_TIMEOUT_SECONDS)

    def close(self):
        if self.selector is not None:
            self.selector.close()
            self.selector = None
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        for stream in (process.stdin, process.stdout):
            if stream is not None:
                stream.close()


def serve(directory, *, loader=load_speech_model, decode=recognize_model_wav,
          source=None, destination=None):
    """A deliberately small local protocol, never a general decoding service."""
    source = source if source is not None else sys.stdin.buffer
    destination = destination if destination is not None else sys.stdout

    def emit(value):
        destination.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')
        destination.flush()

    try:
        directory = Path(directory).resolve(strict=True)
        model = loader()
        emit({'status': 'ready'})
        for _ in range(11):
            line = source.readline(4097)
            if not line:
                return
            if len(line) > 4096 or not line.endswith(b'\n'):
                raise ValueError('Invalid source ASR request')
            request = json.loads(line)
            if not isinstance(request, dict) or set(request) != {'wav'} or not isinstance(request['wav'], str):
                raise ValueError('Invalid source ASR request')
            path = Path(request['wav'])
            if (path.is_symlink() or path.resolve(strict=True).parent != directory or path.suffix != '.wav'
                or not path.is_file() or not 0 < path.stat().st_size <= 8 * 1024 * 1024):
                raise ValueError('Invalid source ASR audio input')
            rows = list(islice(decode(model, path), MAX_RECOGNIZED_WORDS + 1))
            if len(rows) > MAX_RECOGNIZED_WORDS or any(
                    not isinstance(row[0], str) or len(row[0]) > 300 for row in rows):
                raise ValueError('Invalid source ASR output')
            encoded = json.dumps({'rows': rows}, ensure_ascii=False, allow_nan=False)
            if len(encoded.encode()) + 1 > MAX_MESSAGE_BYTES:
                raise ValueError('Oversized source ASR response')
            emit({'rows': rows})
    except Exception:
        emit({'status': 'error'})


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(2)
    serve(sys.argv[1])
