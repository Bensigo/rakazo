# Employee host protocol

An employee host is a small companion process on an employee-owned computer. It makes outbound authenticated poll and heartbeat requests to the Studio API; it does not open an inbound listener and it never receives model or provider credentials.

The control plane enrolls a stable `hostId` against the employee's existing authenticated space membership. Heartbeats carry the observed platform and capabilities, and expire the host when missed. Operations are scoped to `spaceId`, `botId`, and a per-host/per-bot fenced run lease. A stale fence is rejected. Each operation has a durable receipt; the companion does not retry an operation after a disconnected poll unless the control plane explicitly creates a new operation.

The included `LocalEmployeeHostCompanion` executes shell commands only below its bound workspace root. `detectEmployeeHostCapabilities()` reports macOS, Xcode (`xcodebuild`), and Simulator tooling (`xcrun`) when present. GUI observation, graphical input, screen takeover, and multi-screen are deliberately reported as unsupported until a native screen transport exists. Xcode or Simulator command-line work can therefore be advertised truthfully without claiming remote GUI control.

The employee workspace is a path boundary, not an operating-system sandbox. Commands run with the employee account's normal OS permissions, subject to the companion's environment and timeout limits; install and review the companion accordingly.

The provider is exposed as `employee-host` through `createSandboxProvider()` when composition supplies an authenticated `EmployeeHostTransport`. The transport and registry are intentionally separate so API persistence can replace the in-memory reference implementation without changing the companion contract.

## Register and run the companion

1. Sign in, select the target workspace, and open **Sunrise Studio**.
2. Under **Register a computer**, enter a display name and the absolute local directory that the employee is authorizing for command execution. Select **Register** to download `rakazo-employee-host.json`. The enrollment token is returned only in this download.
3. Store the file where only the employee account can read it:

   ```sh
   mkdir -p ~/.config/rakazo
   mv ~/Downloads/rakazo-employee-host.json ~/.config/rakazo/employee-host.json
   chmod 600 ~/.config/rakazo/employee-host.json
   ```

4. From a trusted Rakazo checkout, run the outbound companion in the foreground:

   ```sh
   pnpm --filter @rakazo/employee-host start
   ```

The server writes its configured public `API_URL` into `controlPlaneUrl`; verify that the employee computer can reach that HTTPS origin. Set `RAKAZO_EMPLOYEE_HOST_CONFIG` to an alternate owner-only config path when needed.

After the first heartbeat, the registered computer appears in the assignment computer selector. Stopping the foreground process makes it unavailable after its heartbeat expires. Re-register to rotate a lost enrollment token; do not copy the token into project files or commit it.
