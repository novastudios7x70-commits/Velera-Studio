-- Enables Realtime change streams for jobs (the Processing screen subscribes
-- to job.status transitions instead of polling a fake timer) and clips (the
-- Results screen can pick up rows the instant the worker inserts them).
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table clips;
