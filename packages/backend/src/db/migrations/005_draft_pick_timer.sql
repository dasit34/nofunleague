-- Track when the clock started for the current pick so REST clients
-- can compute seconds_remaining = seconds_per_pick - elapsed.
ALTER TABLE draft_sessions
  ADD COLUMN IF NOT EXISTS pick_started_at TIMESTAMPTZ;
