-- PR 6 leftover: scaler wake-up includes uncertain spend. Count only.
-- qos_ai_queue_owner may read reservation rows inside count_due_ai_work.
-- Nothing is deleted.

GRANT SELECT ON TABLE qos.ai_spend_reservations TO qos_ai_queue_owner;--> statement-breakpoint

CREATE POLICY ai_spend_reservations_queue_owner ON qos.ai_spend_reservations
  FOR SELECT
  TO qos_ai_queue_owner
  USING (true);--> statement-breakpoint

CREATE OR REPLACE FUNCTION qos.count_due_ai_work()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    (
      SELECT count(*)
      FROM qos.ai_jobs j
      WHERE j.status = 'leased'
         OR (j.status = 'queued' AND j.next_attempt_at <= pg_catalog.now())
    )
    +
    (
      SELECT count(*)
      FROM qos.ai_spend_reservations r
      WHERE r.state = 'uncertain'
    );
$$;--> statement-breakpoint

GRANT CREATE ON SCHEMA qos TO qos_ai_queue_owner;--> statement-breakpoint
ALTER FUNCTION qos.count_due_ai_work() OWNER TO qos_ai_queue_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA qos FROM qos_ai_queue_owner;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.count_due_ai_work() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.count_due_ai_work() TO qos_ai_scaler;
