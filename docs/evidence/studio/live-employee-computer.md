# Live employee computer assignment

Synthetic local QA on 2026-09-05. API, worker, supervisor and UI used aggregate
`42b525567f599020c008a967a6ca1cfb7e21acd4`. The employee registered a computer through
the Studio UI, downloaded its private companion configuration, and ran the
foreground companion against the same API. No credential is included in this evidence.

The existing Pi executor with local Ollama `qwen3:14b` ran assignment
`cmto2vl4l0003visbyna2chd1` on the selected employee computer. Operation
`778da759-81c9-475c-ba06-6731d8a68f3e` returned an accepted exit-0 receipt and created
`studio-routing-proof.txt` containing `host-routing-ok` in the enrolled temporary
workspace. The actual file and receipt were checked independently of the model text.
The run completed at `2026-09-05T07:48:29.816Z`. The assignment remained `draft`
with no human acceptance timestamp.

This proves real model-to-companion execution on the selected exec-only computer.
It does not prove native GUI, Xcode, physical-device operation or reconnect recovery.
A subsequent assignment selected Docker correctly but reused this host working
directory from conversation history and failed its shell command. That switch is
recorded as an open runtime-context defect, not a successful Docker shell test.
