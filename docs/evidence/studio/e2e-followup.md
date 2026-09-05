# Packaged end-to-end follow-up

All accounts, sources, objectives and acceptance decisions here are synthetic local QA. This record supplements the earlier delivery evidence; it does not claim a production deployment, configured vendor-provider success, hosted CI, or acceptance of real business work.

## Reviewed corrections

- PR #16 (`188b2082`): acceptance checks both the completed Task and latest linked Run.
- PR #17 (`4560e752`): the real employee CLI uses durable receipts; hashed filenames and strict persisted schemas reject traversal and malformed evidence without replay.
- PR #18 (`b87518c8`): source refresh clears old wiki projections, serializes source mutations, and unfinished acceptance returns a clear conflict.
- PR #19 (`99f13ee5`): future routine fires resolve current foundation/source context; retries retain their effective manifest. Custom bots keep a null role unless a preset was selected.
- PR #20 (`020498ad`): finalization waits up to 30 seconds and retries only the fenced database commit on expiry, never the completed external tool.
- PR #21 (`85d21878`): bounded two-second read-only Docker home visibility retry; symlink/containment failures remain immediate.

Each correction received an independent review with no remaining P1/P2 finding. A stale PG acceptance fixture was corrected at `8d8b1765` to complete both its Task and Run before the positive acceptance assertion.

## Build and test provenance

The full distribution Dockerfile built app `98e3f0c1f1f2c158ba0cc41b5ecf6a2b0c7e8653` into image `sha256:cc59bb0002c9e0068a1ce6ce592d0cd36a646ff03bc213e2aca572a23833dde1`. A small overlay copied the exact four changed files between that commit and `93a77aea61834135e82cd1527a8230bff03b025d`: two supervisor runtime files and two regression tests. Dependencies and compiled web output are unchanged. The final image is `sha256:04b4bd770f157f9f73cf4f1e3ea0414def4d62db5908a24459e27440d55a986e`; API, worker, web, provider MCP and supervisor use it.

At `93a77aea`: 24/24 workspace checks passed. The focused suite passed 209 tests across 12 files with one existing Linux-only skip on macOS. A fresh disposable PostgreSQL database applied all 78 migrations and passed six integrated files, with no skipped tests, then was removed. The separate finalization suite passed 30/30, including a real six-second thread lock, exactly one terminal message/event, unchanged completed effect, and idempotent duplicate finalization.

The updated source UI passed the installed-Chrome race regression. Its isolated temporary harness mocked authentication and initial Studio RPC state; it proves component race behavior, while the real packaged journeys below prove authentication and persistence.

## Real packaged journeys

Two new employees joined through invitations, selected E2E QA Pair, provisioned Alpha/Beta, reloaded and reapplied. Actual PostgreSQL rows showed two memberships and four distinct employee-owned specialist bots. Shared role configuration and separate ownership survived reapply.

![Employee A persistent specialists](employee-a-persistent-after-reapply.png)
![Employee B persistent specialists](employee-b-persistent-after-reapply.png)

A separate authenticated employee session exercised the actual packaged RPC boundary: `studio.projects` returned both intended shared projects, `studio.permissions` returned `member` with both management permissions false, and `studio.assignments` returned an empty list while the owner's assignment remained present in PostgreSQL. This verifies shared project visibility and private owner-assignment filtering without mocked responses.

![Employee management controls disabled](employee-a-shared-space-privacy.png)

The owner created two projects: E2E Garden Tiles with a source and E2E Studio Operations with none. The registered checkout connected through the canonical scanner/store and real local Ollama embeddings. Source commit `64e4ce2035bb481bd9407f418c562f4aaa86194d` indexed as snapshot `d8eb257e9127feabacf521136ef227f0d01516056967111ddfab098ed9289a92`; refresh indexed `24de220bc65478cd0e6b364219245942b54aaca3` as `f9d3a4996df9d07a83f88f5113ee98e1f2ed291274a71a52bf00ef4725ec4a13`. Both immutable snapshots remained stored. The running assignment retained its original pin when the source advanced.

![Canonical wiki after refresh](e2e-canonical-refresh.png)

A second real refresh on the fixed packaged app at `93a77aea` advanced the fixture to commit `4ecf66352efbbf9577b10520e5695b2453dd6605`, snapshot `ebdc52aa4a1eee058d47e9fef4d2a3e208424d5aeefbe5cfea4414e7cdd57348`. Immediately after clicking Refresh, the selected Architecture heading count was zero and Connect, Wiki and source Refresh were all disabled. After real indexing completed, the page list showed only the new revision; opening Architecture displayed the new snapshot and `README.md:5-8` citation.

![Old selection cleared while refresh is pending](e2e-refresh-pending.png)
![New canonical revision after packaged refresh](e2e-final-canonical-refresh.png)

A newly created custom specialist `cmtoyaa1100004fn1zj1e9q9h` persisted `rolePresetId=null`. Multi-project run `cmtoyg81o000a4fn1t50du00o` used Pi and the real local Qwen model, pinned foundation 1 and the refreshed canonical source, executed one Docker shell command `uname -s`, and completed with exit 0, stdout `Linux\n`, empty stderr. Its model text correctly summarized the architecture but omitted the requested line citation; this record does not claim perfect model citation compliance. The exact source citation is verified in the canonical UI and persisted context.

![Completed Docker model run](e2e-docker-completed.png)

The earlier combined run `cmto6nba7000l3dqcmw3hxu7u` remains failed evidence: its shell succeeded, then the default five-second database finalization expired at 7.49 seconds. It was not rewritten as a pass. The finalization fix and later completed run are separate evidence.

Premature acceptance returned HTTP 409 and the actionable message below. The one-shot creation assignment `cmtoz342200013dpkpr4t3eq5` completed with `CREATED`; an explicit synthetic QA acceptance then persisted across reload. This exercises acceptance controls and is not human acceptance of a production result.

![Unfinished work rejection](e2e-accept-unfinished.png)
![Explicit acceptance of completed synthetic work](e2e-accepted-completed-assignment.png)

## Automatic routine context refresh

The real model created one `@once` routine through `schedule_create`: `cmtoz57kr00040zpkbw0eyz9w`. Its stored descriptor selected Studio scope and no role. Foundation revision 2 was published through authenticated `studio.publishFoundation` at `22:50:31.129Z`, before Graphile fired the routine at `22:51:35.848Z`. The original assignment retained revision 1; new Task `cmtoz92jo000f0zpklj8vaexe` and Run `cmtoz92js000g0zpkvma8ey4l` both completed pinned to revision 2. The model returned exactly: “Revision 2: E2E revision two: shared game studio with trusted project context.”

Final observation showed one inactive routine, no next run, exactly one completed routine run, and no duplicate. The creating assignment recorded one completed `schedule_create` effect; the fired run recorded zero effects.

![Automatically fired routine uses current foundation](e2e-routine-revision-two.png)

## Fresh Docker computer observation

At `93a77aea`, a brand-new synthetic organization failed first provision with HTTP 500 after the full two-second visibility retry: its fresh home was still reported non-writable for uid 1000. A subsequent user retry returned HTTP 200 and started the computer as `1000:1000`. This means PR #21 alone does not satisfy reliable first provision. Follow-up diagnosis is in progress; existing-computer execution must not be presented as proof of successful first provision.

## Host receipt recovery

The final CLI code at `4560e752` was exercised against packaged API `98e3f0c1`. A real HTTP proxy dropped the response only after the API committed the receipt. Before companion restart: marker lines 1, terminal spool entries 1, DB operation completed/exit 0. After a new CLI process with the same configuration: marker lines 1, spool entries 0, DB result unchanged. A stale fence returned 409 and a distinct owner's token returned 401. These were explicit protocol fixtures, not model-created assignments. Their accounts, organizations, hosts, operations and workspaces were removed; final fixture counts were zero.

## Additional observations

Two navigation redirects were observed around service replacement. Four subsequent authenticated deep-link checks, including a traced HTTP-200 bootstrap with the requested bot ID, selected the correct bot. No speculative routing change was made. The earlier missing-thread hypothesis was withdrawn because the thread already existed.

Provider credentials remain unset: MCP transport/security is tested, but no paid vendor action, SMTP delivery, production invitation or native macOS/Xcode/device action is claimed.
