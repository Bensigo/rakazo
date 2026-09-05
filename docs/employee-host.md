# Employee host protocol

An employee host is a small companion process on an employee-owned computer. It makes outbound authenticated poll and heartbeat requests to the Studio API; it does not open an inbound listener and it never receives model or provider credentials.

The control plane enrolls a stable `hostId` against the employee's existing authenticated space membership. Heartbeats carry the observed platform and capabilities, and expire the host when missed. Operations are scoped to `spaceId`, `botId`, and a per-host/per-bot fenced run lease. A stale fence is rejected. Each operation has a durable receipt; the companion does not retry an operation after a disconnected poll unless the control plane explicitly creates a new operation.

The included `LocalEmployeeHostCompanion` executes shell commands only below its bound workspace root. `detectEmployeeHostCapabilities()` reports macOS, Xcode (`xcodebuild`), and Simulator tooling (`xcrun`) when present. GUI observation, graphical input, screen takeover, and multi-screen are deliberately reported as unsupported until a native screen transport exists. Xcode or Simulator command-line work can therefore be advertised truthfully without claiming remote GUI control.

The provider is exposed as `employee-host` through `createSandboxProvider()` when composition supplies an authenticated `EmployeeHostTransport`. The transport and registry are intentionally separate so API persistence can replace the in-memory reference implementation without changing the companion contract.
