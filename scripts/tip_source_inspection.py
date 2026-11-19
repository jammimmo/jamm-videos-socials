"""Evidence for a read-only inspection of a privately retained source WAV."""
import difflib
import hashlib
import hmac
import json
import math
import re
import wave

from audit_tip_v11_speech import (
    ASR_REVISION, EXCLUDED_SEGMENTS, MAX_OBSERVED_WORDS, MAX_RECOGNIZED_WORDS, MIN_GLOBAL_ACCURACY_PERCENT,
    PHONE_PREFIX_METHOD, PHONE_WORDS, SAMPLE_RATE, normalized_words, protected_speech, sha256, speech_edits,
)

MAX_TRACE_BYTES = 768 * 1024
MAX_SAMPLE_VALUE = 24_000 * 360


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()


def row_fingerprint(key, attempt, stage, call_index, row_index, text):
    return hmac.new(key, canonical_bytes(['row-v1', attempt, stage, call_index, row_index, text]), hashlib.sha256).hexdigest()


def sample_value(value, scale, limit):
    if type(value) in (int, float) and math.isfinite(value) and abs(value) <= limit / scale:
        return round(value * scale)
    return None


class SourceInspection:
    def __init__(self, plan, wav, raw, nonce, attempt):
        if not re.fullmatch('[0-9a-f]{32}', nonce) or attempt not in (1, 2):
            raise ValueError('Invalid source inspection identity')
        # Prefix the private WAV before hashing. HMAC(wav, ...) would reduce
        # a long WAV key to its public SHA-256 and disclose dictionary matches.
        master = hashlib.sha256(b'jamm-source-inspection-private-wav-v1\0' + wav).digest()
        self.row_key = hmac.digest(master, b'row-key-v1\0' + bytes.fromhex(nonce), 'sha256')
        self.stream_key = hmac.digest(master, b'complete-stream-key-v1', 'sha256')
        self.raw = raw
        self.attempt = attempt
        self.rows_bytes = 0
        self.expected = {s['id']: normalized_words(s['id'], s['text']) for s in plan['segments']
                         if s['id'] not in (*EXCLUDED_SEGMENTS, 'domain')}
        self.scenes = {identity: {
            'id': identity, 'status': 'not_evaluated', 'startSample': None, 'endSample': None,
            'expectedCount': len(expected), 'observedCount': None, 'nullCount': None, 'editCount': None,
            'protectedMatch': None, 'method': None, 'reason': None, 'gateFlags': [],
            'uncertainPositions': [], 'rawMismatchPositions': [],
        } for identity, expected in self.expected.items()}
        self.data = {'version': 1, 'nonce': nonce, 'attempt': attempt, 'wavSha256': sha256(wav),
                     'draftSha256': plan['draft_sha256'], 'scriptSha256': plan['source_script_sha256'],
                     'pcmSha256': sha256(raw), 'modelRevision': ASR_REVISION, 'sourceFrames': len(raw) // 2,
                     'scenes': list(self.scenes.values()), 'calls': [], 'truncated': False}

    def call(self, diagnostic, path, first, rows):
        stage, index = diagnostic['stage'], diagnostic['call_index']
        call = {'stage': stage, 'callIndex': index, 'outcome': diagnostic['outcome'], 'rowCount': None,
                'startSample': None, 'endSample': None, 'pcmSha256': None, 'streamDigest': None,
                'omittedRows': 0, 'rows': []}
        self.data['calls'].append(call)
        if stage == 'model_load':
            call['rowCount'] = 0
            return
        if isinstance(rows, list) and len(rows) <= MAX_RECOGNIZED_WORDS:
            call['rowCount'] = call['omittedRows'] = len(rows)
        elif rows is not None or diagnostic['outcome'] in ('completed', 'output_invalid'):
            self.data['truncated'] = True
        try:
            with wave.open(str(path), 'rb') as source:
                count = source.getnframes()
                clip = source.readframes(count)
            if (type(first) is not int or not 0 <= first < first + count <= len(self.raw) // 2
                or clip != self.raw[first * 2:(first + count) * 2]):
                self.data['truncated'] = True
                return
            call.update(startSample=first, endSample=first + count, pcmSha256=sha256(clip))
            if call['rowCount'] is None:
                return
            stream = hmac.new(self.stream_key, canonical_bytes(['call-v1', stage, first, count]), hashlib.sha256)
            omit_tail = False
            for number, row in enumerate(rows):
                if not isinstance(row, (list, tuple)) or len(row) != 4 or not isinstance(row[0], str) or len(row[0]) > 300:
                    self.data['truncated'] = True
                    return
                stream.update(b'\0' + canonical_bytes(row))
                token = row_fingerprint(self.row_key, self.attempt, stage, index, number, row[0])
                entry = [number, sample_value(row[1], SAMPLE_RATE, MAX_SAMPLE_VALUE),
                         sample_value(row[2], SAMPLE_RATE, MAX_SAMPLE_VALUE),
                         sample_value(row[3], 1000, 1000) if type(row[3]) in (float, int) and row[3] >= 0 else None, token]
                size = len(canonical_bytes(entry)) + 1
                if omit_tail or self.rows_bytes + size > MAX_TRACE_BYTES:
                    omit_tail = True
                    self.data['truncated'] = True
                    continue
                call['rows'].append(entry)
                call['omittedRows'] -= 1
                self.rows_bytes += size
            call['streamDigest'] = stream.hexdigest()
        except (OSError, EOFError, ValueError, TypeError, OverflowError, wave.Error):
            self.data['truncated'] = True

    def aligned(self, parts):
        for part in parts:
            if part['id'] in self.scenes:
                self.scenes[part['id']].update(startSample=round(part['start'] * SAMPLE_RATE),
                                             endSample=round(part['end'] * SAMPLE_RATE))

    def observe(self, identity, raw_words, reported, flags):
        scene = self.scenes.get(identity)
        if scene is None:
            return
        expected = self.expected[identity]
        # Positions refer to differences in the original normalized word stream,
        # before any permitted spelling alias. Insertions mark an expected gap.
        if len(raw_words) <= MAX_OBSERVED_WORDS:
            difference = difflib.SequenceMatcher(None, expected, raw_words, autojunk=False)
            for tag, left, right, _, _ in difference.get_opcodes():
                if tag != 'equal':
                    scene['rawMismatchPositions'].extend(range(left, max(left + 1, right)))
        else:
            self.data['truncated'] = True
        if reported is not None:
            scene['editCount'] = speech_edits(expected, reported)
            scene['protectedMatch'] = protected_speech(expected) == protected_speech(reported)
        scene['gateFlags'] = [key for key, present in flags.items() if present]

    def finish(self, report):
        for item in report['segments']:
            identity = item['segment']
            scene = self.scenes[identity]
            words = item['observed_words']
            scene.update(status=item['status'], observedCount=item['observed_token_count'],
                         nullCount=words.count(None), uncertainPositions=[i for i, w in enumerate(words) if w is None],
                         method=item.get('measurement', {}).get('method'), reason=item.get('reason'))
            if words:
                scene['editCount'] = speech_edits(self.expected[identity], words)
                numeric_phone = (identity == 'phone' and self.expected[identity] == PHONE_WORDS
                                 and scene['method'] == PHONE_PREFIX_METHOD and words == [None, *PHONE_WORDS[1:]])
                scene['protectedMatch'] = numeric_phone or protected_speech(self.expected[identity]) == protected_speech(words)
        total = sum(len(e) for e in self.expected.values())
        edits = [s['editCount'] for s in self.scenes.values()]
        checks = [s['protectedMatch'] for s in self.scenes.values()]
        total_edits = None if None in edits else sum(edits)
        self.data['global'] = {
            'status': report['status'], 'expectedCount': total, 'editCount': total_edits,
            'protectedMatch': False if False in checks else None if None in checks else True,
            'ruleEvaluated': bool(self.scenes) and all(s['status'] == 'matched' for s in self.scenes.values()),
            'editBudgetExceeded': (total_edits * 100 > total * (100 - MIN_GLOBAL_ACCURACY_PERCENT)
                                   if total_edits is not None else None),
        }
        return self.data
