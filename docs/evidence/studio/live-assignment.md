# Live cited assignment evidence

Synthetic local QA only. The screenshot shows the normal app chat after an
assignment completed through the existing Pi executor with local `qwen3:14b`
served by Ollama's OpenAI-compatible endpoint. No external model credentials or
paid provider were used. The task Docker computer was provisioned by the existing
supervisor from image `sunrise-studio-computer:qa-e84a0cc8`.

Execution checkpoint: aggregate `f8ffd344` for worker/supervisor; API began at
`25564a99`. The assignment exposed a missing `assignment` trigger in the public
Run schema, which broke subsequent chat reads. API checkpoint `c8779774` includes
the contract fix and rendered the completed response shown here. Source UI is
`17f977ed` and canonical API integration is `5a1fd9c5`.

The run pinned canonical snapshot
`d8eb257e9127feabacf521136ef227f0d01516056967111ddfab098ed9289a92` from repository
commit `64e4ce2035bb481bd9407f418c562f4aaa86194d`. The response correctly cited
README lines 13-15 for save behavior and the inherited studio standard to support
claims with evidence. Database verification showed the run completed without
error, zero external effects, and assignment status remained `draft` with
`acceptedAt` null. The read-only task requested no tools and none were called.

This proves a real model receiving canonical source/foundation context, Docker
provisioning, response persistence and separation of run completion from human
acceptance. It does not prove write tools, delegation, scheduled jobs, human
acceptance, mixed employee-host routing, refreshed production image or deployment.
