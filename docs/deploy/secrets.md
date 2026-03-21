---
title: Secrets Management
summary: Master key, encryption, and strict mode
---

Paperclip encrypts secrets at rest using a local master key. Agent environment variables that contain sensitive values (API keys, tokens) are stored as encrypted secret references.

## Default Provider: `local_encrypted`

Secrets are encrypted with a local master key stored at:

```
~/.paperclip/instances/default/secrets/master.key
```

This key is auto-created during onboarding. The key never leaves your machine.

## Configuration

### CLI Setup

Onboarding writes default secrets config:

```sh
pnpm paperclipai onboard
```

Update secrets settings:

```sh
pnpm paperclipai configure --section secrets
```

Validate secrets config:

```sh
pnpm paperclipai doctor
```

### Environment Overrides

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_SECRETS_MASTER_KEY` | 32-byte key as base64, hex, or raw string |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | Custom key file path |
| `PAPERCLIP_SECRETS_STRICT_MODE` | Set to `true` to enforce secret refs |

### Kubernetes / multi-node

On Kubernetes, **do not rely on the default key file** unless you mount persistent storage at that path: the server resolves the default file relative to `process.cwd()` (often `/app` in the container image), which is **not** the same as the `/paperclip` PVC used for instance data.

**Recommended:** set `PAPERCLIP_SECRETS_MASTER_KEY` from a Kubernetes `Secret` so every pod (any node) uses the same key across restarts. The Helm chart supports `server.secrets.paperclipSecretsMasterKey`; tenant deploy workflows can inject it from a GitHub Actions secret `PAPERCLIP_SECRETS_MASTER_KEY` (generate once per environment or tenant with `openssl rand -base64 32` and store it safely).

**Alternative:** set `PAPERCLIP_SECRETS_MASTER_KEY_FILE` to a path **on your RWX volume** (e.g. under `/paperclip/...`) and ensure that file exists and is backed up with your volume snapshots.

## Strict Mode

When strict mode is enabled, sensitive env keys (matching `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.

```sh
PAPERCLIP_SECRETS_STRICT_MODE=true
```

Recommended for any deployment beyond local trusted.

## Migrating Inline Secrets

If you have existing agents with inline API keys in their config, migrate them to encrypted secret refs:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Secret References in Agent Config

Agent environment variables use secret references:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": {
      "type": "secret_ref",
      "secretId": "8f884973-c29b-44e4-8ea3-6413437f8081",
      "version": "latest"
    }
  }
}
```

The server resolves and decrypts these at runtime, injecting the real value into the agent process environment.
