# Shared Linux speech runtime

The advice source, V11 rendering and hosted/mini-PC synthetic parity fixture
call `scripts/prepare-tip-runtime.sh`. The source and final render use the
same normalized-WAV/ASR tools. The legacy V1 renderer keeps its existing
Whisper installation. No OIDC subject, accepted runner identity, publication
policy or production routing is changed.

The shared lock fixes Node 22.20.0, npm 10.9.3, Python 3.11.14, the two
previously measured Ubuntu FFmpeg/ffprobe binaries, the ASR repository revision,
and all 24 Linux CPython 3.11 Python wheels including transitives and SHA-256s.
The wheels were resolved for Linux x86_64 without installing or executing them
on the local Mac. Both workflow families use the same isolated venv and model
cache preparation; source-only unit checks need no model download.

The provisioner requires the exact FFmpeg package rather than accepting apt's
latest version. If that version is unavailable, preparation fails before a
provider start. A release must deliberately update the lock and qualify the
new tools together. It never changes the system Python or an existing venv.

`tip-runtime.mjs measure` reads the actual host/interpreter, installed package
versions, encoder hashes and the exact-revision ASR cache bytes. The model is streamed through its pinned LFS
SHA-256 and the JSON files through their pinned Git object hashes. It emits a
canonical runtime digest with no file paths or credentials. The source
controller recomputes this digest before the durable start and requires the
source policy's `runtimeSha256` to match. A copied environment receipt or
dispatch hash cannot supply the measurement. Missing tools/cache or drift
cannot spend a TTS take. Preparation happens before the paid stage, then the
recognizer runs offline.

`node scripts/tip-runtime.mjs expected` prints the digest declared by the lock
with `measured:false`. It is useful for preparing the matching machine source
policy. It is not an observed runtime qualification. Use the measurement and
the same-commit synthetic run on each Linux host before qualifying a switch.
The old source policy's digest must be replaced with this qualified digest in
the existing bounded policy process; this source change performs no activation.

The native libraries linked by the encoders, CPU instructions and graphics
implementation are not completely frozen by this lock. The native probe verifies module imports and CPU int8 capability, not a full
model startup. The source scorer owns its separately bounded model startup
and keeps that one model resident for its recognition windows. The output comparison therefore continues to require identical
decoded audio and pictures. Equal tools or a shared installer cannot by
themselves establish an interchangeable render.

The common synthetic fixture from `f0c73b26` is retained. Its v4 receipt records
the measured speech runtime and the decoded picture, decoded audio, frame count
and caption geometry for the Facebook, Instagram and TikTok layouts. Compare two
receipts from the same exact renderer commit and the same orchestration attempt with:

```sh
node scripts/compare-tip-runner-parity.mjs "$RENDERER_SOURCE_SHA" hosted.json mini.json
```

Use the comparator from the reviewed renderer commit. A v3 receipt verifies only
the master and cannot establish destination parity. The recorded `f0c73b26`
exercise had equal tools and decoded audio but different decoded pictures. A
new hosted and mini-PC comparison is required for the v4 receipt.

The production Worker currently accepts only the existing GitHub-hosted advice
identity. A qualified mini-PC fixture does not grant it a production identity.
Runner identity authorization remains a separate explicit change.

The hash-locked installation follows [pip's secure-install requirements](https://pip.pypa.io/en/stable/topics/secure-installs/).
The model cache uses the [exact-revision, offline Hugging Face API](https://huggingface.co/docs/huggingface_hub/package_reference/file_download).
