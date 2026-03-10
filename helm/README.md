# Paperclip Helm Chart

Deploy Paperclip (control plane for AI-agent companies) on Kubernetes with Helm.

## Prerequisites

- Kubernetes 1.19+
- Helm 3+
- Traefik ingress controller
- cert-manager with `letsencrypt-cert-issuer` ClusterIssuer

## Build and Push Image

The chart expects an image built from the project Dockerfile (includes git and @openai/codex):

```sh
# From repo root
docker build -t <your-registry>/paperclip:latest .
docker push <your-registry>/paperclip:latest
```

## Install

```sh
# Create namespace
kubectl create namespace paperclip

# Install with custom values
helm install paperclip ./helm -n paperclip -f helm/values.yaml \
  --set server.image.repository=<your-registry>/paperclip \
  --set server.image.tag=latest \
  --set server.secrets.betterAuthSecret=$(openssl rand -base64 32)
```

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `postgres.enabled` | Deploy PostgreSQL with chart | `true` |
| `postgres.persistence.size` | PostgreSQL PVC size | `10Gi` |
| `server.image.repository` | Server image | `paperclip` |
| `server.image.tag` | Server image tag | `latest` |
| `server.paperclip.publicUrl` | Public URL for auth/callbacks | `https://dev.ai-harness.com` |
| `server.secrets.betterAuthSecret` | **Required** Better Auth secret | `CHANGE_ME` |
| `server.paperclip.openaiApiKey` | OpenAI API key (optional) | `""` |
| `server.paperclip.anthropicApiKey` | Anthropic API key (optional) | `""` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class (Traefik) | `traefik` |

## Ingress

Default ingress is configured for:

- **URL**: https://dev.ai-harness.com
- **Controller**: Traefik
- **TLS**: cert-manager with `letsencrypt-cert-issuer`

## Persistence

- **PostgreSQL**: PVC `paperclip-postgres-data` (non-ephemeral)
- **Paperclip data**: PVC `paperclip-paperclip-data` (config, storage, run-logs, workspaces)

## External Database

To use an external PostgreSQL instead of the chart's:

```yaml
postgres:
  enabled: false

server:
  database:
    externalUrl: postgres://user:pass@host:5432/paperclip
```
