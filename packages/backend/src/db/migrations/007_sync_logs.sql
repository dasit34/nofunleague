-- =============================================
-- Sync Run Log
-- Records every scheduled or manually-triggered sync job.
-- =============================================

CREATE TABLE IF NOT EXISTS sync_logs (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name     VARCHAR(60)  NOT NULL,                    -- 'player_master' | 'player_stats' | 'league_rosters'
  trigger      VARCHAR(20)  NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'manual'
  status       VARCHAR(20)  NOT NULL DEFAULT 'running',   -- 'running' | 'success' | 'failure'
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  duration_ms  INTEGER,
  result       JSONB,       -- job-specific result payload on success
  error        TEXT,        -- error message on failure
  context      JSONB        -- extra context (week, season, etc.)
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_job_name   ON sync_logs(job_name);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status     ON sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at ON sync_logs(started_at DESC);
