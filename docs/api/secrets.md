---
title: Secrets
summary: Secrets CRUD
---

Manage encrypted secrets that agents reference in their environment configuration.

## List Secrets

```
GET /api/companies/{companyId}/secrets
```

Returns secret metadata (not decrypted values).

## Create Secret

```
POST /api/companies/{companyId}/secrets
{
  "name": "anthropic-api-key",
  "value": "sk-ant-..."
}
```

The value is encrypted at rest. Only the secret ID and metadata are returned.

## Update Secret

```
PATCH /api/secrets/{secretId}
{
  "value": "sk-ant-new-value..."
}
```

Creates a new version of the secret. Agents referencing `"version": "latest"` automatically get the new value on next heartbeat.

## Using secrets in agent config

Reference encrypted values from `adapter_config.env` instead of inline plaintext. Two binding shapes are supported:

The server resolves both **`secret_ref`** and **`project_secret_ref`** whenever adapter config is resolved (heartbeat, test environment, skills listing, etc.). **`project_secret_ref`** looks up the secret by id, checks it belongs to the company, and decrypts using that row’s project scope.

## Company secret reference (`secret_ref`)

```json
{
  "env": {
    "ANTHROPIC_API_KEY": {
      "type": "secret_ref",
      "secretId": "{companySecretId}",
      "version": "latest"
    }
  }
}
```

## Project secret reference (`project_secret_ref`)

Create or list secrets with `POST` / `GET` **`/api/projects/{projectId}/project-secrets`**. Responses include metadata and **`id`**; values are never returned. Use that UUID:

```json
{
  "env": {
    "DEPLOY_TOKEN": {
      "type": "project_secret_ref",
      "secretId": "{projectSecretUuid}",
      "version": "latest"
    }
  }
}
```

