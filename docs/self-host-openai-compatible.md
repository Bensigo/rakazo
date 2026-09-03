# OpenAI-compatible endpoints (self-host)

Use this page when a self-hosted Rakazo deployment should call an
**OpenAI-compatible** HTTP API that you choose (a public hostname, or a
private reverse proxy). The UI path already exists: **Connect a model** /
**Settings → Models**. This page does not change runtime defaults.

## When this applies

- You already run Rakazo on your own host (published images or a source
  checkout). Electron (`RAKAZO_WEB_URL`) and the mobile app (**Use a custom
  server**) can point at that origin; they are clients, not a second control
  plane.
- You want bots to use a model server that speaks the OpenAI Completions
  API. Enter the provider **OpenAI-compatible**, a base URL, the exact model
  id, and an optional API key.
- You do **not** need a vendor-specific Rakazo provider. There is no
  first-party preset list.

If the model server is already on loopback, RFC1918, or
`host.docker.internal`, skip the public-host gate below.

## Enable the public-host gate

By default Rakazo **rejects public hostnames** for user-connected
OpenAI-compatible URLs (SSRF: only loopback, RFC1918, and
`host.docker.internal` are allowed). To permit a public endpoint, set this
on the **deployment** (API/worker environment), then restart those
services:

```env
RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1
```

Leave it unset (or any value other than `1`) to keep the default block.
Opening the gate is an explicit operator choice. Public hostnames must
resolve only to public addresses; redirects and DNS answers that reach
private or link-local networks are rejected.

Published-images `.env` templates leave this unset by default (commented
example in `.env.images.example`). Set `=1` when you need public endpoints.

## Connect in the UI

1. Sign in to your self-hosted web app.
2. **Connect a model** or **Settings → Models**.
3. Choose **OpenAI-compatible**.
4. Base URL, model id, optional API key. Example only:

```text
https://api.example.com/v1
my-model-id
```

If the URL already ends with a versioned root (`/v1`, `/v4`, …), Rakazo
keeps it. It does **not** append another `/v1`. Bare origins such as
`https://api.example.com` become `https://api.example.com/v1`.

Do not put credentials in the URL. Use the API key field. When an API key
is used, prefer HTTPS; `http` is fine for trusted private or loopback links.

## Private reverse proxy

A reverse proxy on `127.0.0.1`, `localhost`, `*.localhost`,
`host.docker.internal`, or an RFC1918 address does **not** need
`RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1`. Point the base URL at that private
listener. From Docker Compose, use `host.docker.internal` or an RFC1918 /
loopback address the **containers** can reach, not only the host's loopback.
Bare Compose DNS hostnames (for example `ollama`) are treated as public and
need `RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC=1`, or switch to a private IP /
`host.docker.internal`.

## Probe failures

Connecting can probe `GET {base}/models` (`models.probeOpenAiCompatible`).
Non-2xx responses become a generic `BAD_REQUEST` string such as
`Model server returned 401` — not a vendor error catalog. Redirects and
oversized bodies are rejected.

If `/models` is missing or non-standard, you can still type the model id
by hand and connect. Probe failure is not a classified provider outage.

## What this page is not

- Not image-pull, registry-mirror, messaging, or installer help.
- Not a change to the default SSRF gate or compose files.
- Not a vendor integration or compliance statement.

## Related

- [Self-hosting](./self-host.md) — published images, TLS origin,
  `RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC`
