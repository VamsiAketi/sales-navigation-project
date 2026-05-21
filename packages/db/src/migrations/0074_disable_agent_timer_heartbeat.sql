-- Timer heartbeats are opt-in: disable interval heartbeats for all existing agents.
UPDATE "agents"
SET
  "runtime_config" = jsonb_set(
    jsonb_set(
      COALESCE("runtime_config", '{}'::jsonb),
      '{heartbeat}',
      COALESCE("runtime_config"->'heartbeat', '{}'::jsonb),
      true
    ),
    '{heartbeat,enabled}',
    'false'::jsonb,
    true
  ),
  "updated_at" = NOW();
