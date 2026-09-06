# Live Docker assignment after employee computer work

Real local Pi / Ollama qwen3:14b execution on 2026-09-05, with API, worker and provider
MCP from aggregate `5b2cb3eb4064b2fb02987e799672dda914a5f21c`. The original supervisor
and Docker computer image were retained (`sunrise-studio-computer:qa-e84a0cc8`).

The same specialist and conversation previously completed an employee-host marker
operation, then a Docker attempt failed because the model carried that host's working
directory into Docker. PR #14 adds current-computer identity and workspace guidance
without changing cwd resolution or silently redirecting commands.

The employee selected the Docker computer again in Studio and submitted the same
objective: run `uname -s` and `pwd` exactly once, without modifying files. Run
`cmto57lq800025osbn0achm72` persisted computer `cmtnzvx010005yksb94pjpr7n`. Its one shell
receipt recorded cwd `/home/rakazo`, command `uname -s && pwd`, exit code 0,
empty stderr and stdout `Linux\n/home/rakazo\n`. It completed at
`2026-09-05T08:52:49.398Z`; the assignment remained `draft` and `acceptedAt` null.

The screenshot intentionally retains the earlier failed attempt and the successful
retry. It is actual app state, not a fixture. This proves mixed selected-host/Docker
execution and the corrected model context. It does not claim native GUI, disconnected
host recovery, business acceptance, paid provider accounts or production deployment.
