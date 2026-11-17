"""Read the private speech runtime without recognizing or receiving any text."""

import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys


def installed_packages():
    """Enumerate reality rather than selecting only the expected package names."""
    packages = {}
    for distribution in importlib.metadata.distributions():
        name = re.sub(r'[-_.]+', '-', distribution.metadata['Name']).lower()
        if name == 'pip':
            continue  # The exact Python's venv bootstrap tool is not an ASR dependency.
        if name in packages:
            raise ValueError('Duplicate runtime distribution')
        packages[name] = distribution.version
    return packages


def verify_cache_files(directory, expected):
    """Check every pinned byte before a provider can start, without model load.

    HF stores its cache files as symlinks to immutable blobs. Follow the cache
    link, then hash the complete bytes against the independently pinned LFS
    SHA-256 / Git object. Never allocate the 1.6 GB model in Python memory.
    """
    for name, identity in expected.items():
        if Path(name).name != name or name in ('.', '..'):
            raise ValueError('Invalid pinned model path')
        path = Path(directory) / name
        size = path.stat().st_size
        if not path.is_file() or not 0 < size <= 2 * 1024 ** 3:
            raise ValueError('Invalid pinned model file')
        if identity['algorithm'] == 'sha256':
            digest = hashlib.sha256()
        elif identity['algorithm'] == 'git-sha1' and size <= 8 * 1024 ** 2:
            digest = hashlib.sha1()
            digest.update(b'blob ' + str(size).encode('ascii') + b'\0')
        else:
            raise ValueError('Unknown model hash algorithm')
        count = 0
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                count += len(block)
                if count > size:
                    raise ValueError('Pinned model file changed')
                digest.update(block)
        if count != size or path.stat().st_size != size or digest.hexdigest() != identity['sha']:
            raise ValueError('Pinned model bytes differ')


def probe(lock, scripts_directory):
    from huggingface_hub import snapshot_download
    import av
    import ctranslate2
    from faster_whisper import WhisperModel

    # Imports and native CPU support are distinct from a full model startup.
    # The scorer owns that bounded startup and reuses its one resident model.
    if 'int8' not in ctranslate2.get_supported_compute_types('cpu'):
        raise ValueError('Native CPU int8 is unavailable')
    sys.path.insert(0, str(scripts_directory))
    from align_tip_v11 import ASR_REPO, ASR_REVISION
    if ASR_REPO != lock['asr']['repository'] or ASR_REVISION != lock['asr']['revision']:
        raise ValueError('Recognizer revision differs from runtime lock')
    snapshot = Path(snapshot_download(repo_id=ASR_REPO, revision=ASR_REVISION, local_files_only=True))
    verify_cache_files(snapshot, lock['asr']['files'])
    return {
        'python': '.'.join(map(str, sys.version_info[:3])),
        'pythonIsolated': sys.prefix != sys.base_prefix,
        'pythonPackages': installed_packages(),
        'asrRepository': ASR_REPO, 'asrRevision': snapshot.name,
        'asrNativeImportsReady': True, 'asrFilesVerified': True,
    }


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Expected runtime lock and source directory')
        print(json.dumps(probe(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]))))
    except Exception:
        print('Pinned speech runtime verification failed', file=sys.stderr)
        sys.exit(1)
