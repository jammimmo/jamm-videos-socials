# V11-only deterministic x264 candidate

`remotion.tip-v11.config.ts` fixes the V11 libx264 encoder to one thread and
`asm=0`. The existing closed GOP, audio bitrate and Meta mux rules are preserved.
The global Remotion config, browser backend, browser concurrency and tours are
unchanged. The existing render manifest already hashes this V11 config file.
Copy-only muxing and audio do not receive x264 encoder options.

## Evidence and limits

The two twelve-frame Linux CPU diagnostic runs44183958169 and44184002106 use
sourceb33308174b39c138b6504030c3707a28699640f8. Their raw and PNG inputs,
system FFmpeg and actual bundled FFmpeg hashes match. Preencoder YUV SHA256
values match across hosts. At fixed threads1, default x264 and FFmpeg cpuflags0
still differ across hosts; x264 asm0 and both-disabled modes match both decoded
pixels and complete MP4 hashes. Logs observe `none!` CPU capabilities for asm0.
This localizes the synthetic disagreement to x264 CPU-dependent execution.
FFmpeg cpuflags0 changes conversion pixels and adds no observed parity benefit;
this candidate does not apply it.

Dense12-frame encoding times, one sample per mode:

| Host | Fixed-thread baseline | Fixed-thread asm0 | Ratio |
|---|---:|---:|---:|
| Hosted AMD EPYC9V74 |2.557s|9.223s|3.61×|
| Mini AMD Ryzen7 5825U |2.672s|8.612s|3.22×|

These process timings include PNG decode/conversion and do not predict the
complete V11 duration. Browser rasterization has not been qualified by this
codec-only evidence. No actual V11 parity success or mini-PC qualification is
claimed by this patch. Faster restricted CPU paths remain unmeasured.

## Full synthetic qualification, prepared but not executed

After coordinator review, use one clean checkout of this exact candidate commit
on each Linux x86_64 runner, with the already reviewed hosted/manual and private
WSL/manual carrier pattern. Pin the same candidate SHA in both checkout refs and
`TIP_PARITY_EXPECTED_SHA`. Keep contents read-only and persist-credentials false.
Use the existing shared runtime and isolation wrapper, unchanged:

```bash
TIP_PARITY_EXPECTED_SHA="$candidate" bash scripts/check-tip-runner-parity.sh "$RUNNER_TEMP/tip-runner-parity.json"
```

The wrapper prepares/attests the same locked runtime, runs source checks, then
renders the complete nonpublishable V11 fixture in an outbound-blocked network
namespace and empty environment. The fixture supplies local tone and transcript;
it does not call TTS, infer ASR or deliver/publish. Runtime preparation still
fetches the pinned speech dependencies/model cache as the established wrapper
requires; this document does not authorize a run or runtime installation.
The source inventory hashes the changed V11 config. Synthetic media is removed;
upload only receipts and approved logs. Preserve prior run evidence separately.
The normal render log remains error-level: the argument regression test verifies
the registered override; a synthetic receipt alone does not expose encoder logs.

Compare the two completed receipts with the existing strict comparator:

```bash
node scripts/compare-tip-runner-parity.mjs "$candidate" hosted.json mini.json
```

Require `status: matched`, including decoded video/audio hashes, exact source,
lock, complete runtime and geometry/GOP checks. Do not relax the comparator if
browser pixels still drift; inspect that next stage separately. No switch,
merge or publication follows automatically from this qualification.
