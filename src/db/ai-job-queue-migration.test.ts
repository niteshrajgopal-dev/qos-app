import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ROLES = ["qos_ai_queue_owner", "qos_ai_scaler", "qos_ai_worker"];
const FUNCTIONS = [
  "cancel_queued_ai_job(text,text,text)",
  "claim_next_ai_job(text,text[],integer,integer,integer,integer)",
  "count_due_ai_work()",
  "heartbeat_ai_job(uuid,uuid,integer)",
];

integrationDescribe("0042 AI job queue migration", () => {
  let connection: Awaited<ReturnType<typeof resetAndMigrate>>;

  beforeAll(async () => {
    connection = await resetAndMigrate();
  }, 120_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
  });

  function asRole<T>(role: string, statement: string) {
    return connection.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      return (await tx.unsafe(statement)) as unknown as T;
    });
  }

  it("creates the worker, scaler and function-owner roles without login or RLS bypass", async () => {
    const roles = await connection.sql`
      SELECT rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolinherit FROM pg_roles
      WHERE rolname IN ${connection.sql(ROLES)}
      ORDER BY rolname`;
    expect(roles).toEqual([
      { rolname: "qos_ai_queue_owner", rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolcreaterole: false, rolinherit: false },
      { rolname: "qos_ai_scaler", rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolcreaterole: false, rolinherit: true },
      { rolname: "qos_ai_worker", rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolcreaterole: false, rolinherit: true },
    ]);

    const members = await connection.sql`
      SELECT member::regrole::text AS member FROM pg_auth_members
      WHERE roleid = 'qos_ai_queue_owner'::regrole AND member::regrole::text IN ('qos_app', 'qos_ai_worker', 'qos_ai_scaler')`;
    expect(members).toEqual([]);
  });

  it("owns the queue functions by the dedicated role, pinned to a safe search path", async () => {
    const functions = await connection.sql`
      SELECT p.oid::regprocedure::text AS signature, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
      FROM pg_proc p
      WHERE p.pronamespace = 'qos'::regnamespace AND p.proowner = 'qos_ai_queue_owner'::regrole
      ORDER BY 1`;
    expect(functions.map((row) => row.signature.replace(/^qos\./, ""))).toEqual(FUNCTIONS);
    for (const row of functions) {
      expect(row).toMatchObject({ owner: "qos_ai_queue_owner", prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"] });
    }
  });

  it("grants each queue function to exactly one caller role", async () => {
    const expected: Record<string, string[]> = {
      "cancel_queued_ai_job(text,text,text)": ["qos_app"],
      "claim_next_ai_job(text,text[],integer,integer,integer,integer)": ["qos_ai_worker"],
      "count_due_ai_work()": ["qos_ai_scaler"],
      "heartbeat_ai_job(uuid,uuid,integer)": ["qos_ai_worker"],
    };
    for (const [fn, callers] of Object.entries(expected)) {
      const allowed: string[] = [];
      for (const role of ["public", "qos_app", ...ROLES.filter((r) => r !== "qos_ai_queue_owner")]) {
        const [row] = await connection.sql`SELECT has_function_privilege(${role}, ${`qos.${fn}`}, 'EXECUTE') AS ok`;
        if (role === "public") {
          const [acl] = await connection.sql`
            SELECT EXISTS (
              SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = ${`qos.${fn}`}::regprocedure AND a.grantee = 0
            ) AS ok`;
          if (acl!.ok) allowed.push(role);
        } else if (row!.ok) {
          allowed.push(role);
        }
      }
      expect({ fn, allowed }).toEqual({ fn, allowed: callers });
    }
  });

  it("keeps the worker off the video queue and the scaler off every table", async () => {
    await expect(
      asRole("qos_ai_worker", "SELECT * FROM qos.claim_next_video_processing_job('w', 60, 1, 1)"),
    ).rejects.toThrow(/permission denied/);
    await expect(asRole("qos_ai_scaler", "SELECT count(*) FROM qos.ai_jobs")).rejects.toThrow(/permission denied/);
    await expect(asRole("qos_ai_scaler", "SELECT count(*) FROM qos.agent_runs")).rejects.toThrow(/permission denied/);
    await expect(asRole<{ count: string }[]>("qos_ai_scaler", "SELECT qos.count_due_ai_work() AS count")).resolves.toEqual([
      { count: "0" },
    ]);
  });

  it("does not let the app role lease, heartbeat or rewrite jobs", async () => {
    await expect(
      asRole("qos_app", "SELECT * FROM qos.claim_next_ai_job('w', ARRAY['menu_manager.run'], 60, 1, 1, 1)"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole("qos_app", "SELECT qos.heartbeat_ai_job(gen_random_uuid(), gen_random_uuid(), 60)"),
    ).rejects.toThrow(/permission denied/);

    const grants = await connection.sql`
      SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE grantee = 'qos_app' AND table_schema = 'qos' AND table_name IN ('ai_jobs', 'ai_job_attempts')
      GROUP BY table_name ORDER BY table_name`;
    expect(grants).toEqual([
      { table_name: "ai_job_attempts", privileges: "SELECT" },
      { table_name: "ai_jobs", privileges: "INSERT,SELECT" },
    ]);
  });

  it("gives the worker no DELETE or INSERT on the queue and no path to the platform admin tables", async () => {
    const grants = await connection.sql`
      SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE grantee = 'qos_ai_worker' AND table_schema = 'qos'
      GROUP BY table_name ORDER BY table_name`;
    expect(Object.fromEntries(grants.map((row) => [row.table_name, row.privileges]))).toEqual({
      agent_provider_connections: "SELECT,UPDATE",
      agent_provider_credentials: "SELECT,UPDATE",
      agent_run_inputs: "SELECT",
      agent_runs: "SELECT,UPDATE",
      ai_job_attempts: "SELECT,UPDATE",
      ai_jobs: "SELECT,UPDATE",
      catalogue_menu_locations: "SELECT",
      catalogue_menus: "SELECT",
      locations: "SELECT",
      staff_identities: "SELECT",
      staff_location_scopes: "SELECT",
      staff_memberships: "SELECT",
      tenant_agent_bindings: "SELECT",
      tenant_audit_events: "INSERT,SELECT",
      tenants: "SELECT",
    });
  });

  it("forces row-level security on the queue tables", async () => {
    const security = await connection.sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'qos'::regnamespace AND relname IN ('ai_jobs', 'ai_job_attempts')
      ORDER BY relname`;
    expect(security).toEqual([
      { relname: "ai_job_attempts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "ai_jobs", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
