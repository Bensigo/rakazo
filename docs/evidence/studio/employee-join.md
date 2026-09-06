# Two employees join one Studio

Real installed-Chrome UI and PostgreSQL QA on 2026-09-05, using synthetic local
accounts. Invitation implementation `8cdecc61545751c62223314f88cc77cc23f4e9b6` was
integrated in API checkpoint `6453b79007b8a1898671cbf16d60d3959a8532b3`.

The administrator created two invitations in the normal Studio form. Each employee
opened the invitation in a separate browser session, created an account with the
invited email, returned to the invitation, accepted it, and selected Game developer.
Both provisioned their own Engineer and Reviewer. No fixture RPC, manual membership
SQL, external email delivery or copied authentication cookie was used.

Database inspection confirmed both employees are members of the same shared Studio
space, each has exactly two specialist bindings there, and each retained an independent
personal space as owner with no specialist bindings. Their UI displayed the shared
foundation and disabled administrator controls. The seeded organization retained its
existing default name, Personal, as shown accurately in the invitation screenshot.

Integrated database tests at `5b2cb3eb4064b2fb02987e799672dda914a5f21c` applied all 78
migrations to a fresh isolated database and passed the invitation, membership, job-role,
context, routing and employee-host gates (6 files, 6 tests, no skips). These include
wrong-email, expired/replayed invitation and private-space isolation checks.

This is local signup/join/provisioning evidence; no production invitation or email was sent.
