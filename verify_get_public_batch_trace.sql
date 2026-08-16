-- ============================================================
-- TraceFlow — Live Verification: get_public_batch_trace(uuid)
-- File: verify_get_public_batch_trace.sql
--
-- READ-ONLY — makes NO changes to schema, data, or functions.
-- Results appear in the Supabase SQL Editor Results grid.
--
-- HOW TO RUN:
--   Paste the entire file into Supabase SQL Editor → Run.
--   All checks appear as rows in the Results grid.
-- ============================================================

DROP TABLE IF EXISTS _verify_out;

CREATE TEMP TABLE _verify_out (
  seq        int,
  check_name text,
  status     text,
  expected   text,
  actual     text,
  details    text
);

DO $$
DECLARE
  v_test_id        uuid;
  v_result         jsonb;
  v_null_result    jsonb;
  v_func_src       text;
  v_acl_text       text;
  v_proacl_null    boolean;
  v_has_public_x   boolean;
  v_json_text      text;
  v_unexpected     text;
  v_bad_entry_keys text;
  v_qr_scan_count  int  := 0;
  v_pass_count     int  := 0;
  v_fail_count     int  := 0;
  v_seq            int  := 0;
BEGIN

  -- ──────────────────────────────────────────────────────────
  -- A. FUNCTION SECURITY
  -- ──────────────────────────────────────────────────────────

  -- A1: Exists + SECURITY DEFINER
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname  = 'get_public_batch_trace'
      AND  p.prosecdef = true
  ) THEN
    v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A1 SECURITY DEFINER','PASS',
      'prosecdef = true','true',NULL);
  ELSE
    v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A1 SECURITY DEFINER','FAIL',
      'prosecdef = true','false or function missing','Re-deploy the function');
  END IF;

  -- A2: SET search_path = public
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname  = 'get_public_batch_trace'
      AND  p.proconfig @> ARRAY['search_path=public']
  ) THEN
    v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A2 search_path = public','PASS',
      'search_path=public','confirmed',NULL);
  ELSE
    v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A2 search_path = public','FAIL',
      'search_path=public','not set','Re-deploy with SET search_path = public');
  END IF;

  -- Resolve raw ACL for A3–A6
  SELECT array_to_string(p.proacl, ', ')
  INTO   v_acl_text
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_public_batch_trace';

  v_seq := v_seq + 1;
  INSERT INTO _verify_out VALUES (v_seq,'A  raw ACL (info)','INFO',
    '(see actual)',
    COALESCE(v_acl_text,'(null — PostgreSQL default PUBLIC grant still active)'),
    NULL);

  -- A3: anon EXECUTE
  IF v_acl_text LIKE '%anon=X%' THEN
    v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A3 anon EXECUTE','PASS','anon=X in ACL','present',NULL);
  ELSE
    v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A3 anon EXECUTE','FAIL','anon=X in ACL','absent',
      'GRANT EXECUTE ... TO anon missing');
  END IF;

  -- A4: authenticated EXECUTE
  IF v_acl_text LIKE '%authenticated=X%' THEN
    v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A4 authenticated EXECUTE','PASS',
      'authenticated=X in ACL','present',NULL);
  ELSE
    v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A4 authenticated EXECUTE','FAIL',
      'authenticated=X in ACL','absent','GRANT EXECUTE ... TO authenticated missing');
  END IF;

  -- A5: service_role EXECUTE
  IF v_acl_text LIKE '%service_role=X%' THEN
    v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A5 service_role EXECUTE','PASS',
      'service_role=X in ACL','present',NULL);
  ELSE
    v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A5 service_role EXECUTE','FAIL',
      'service_role=X in ACL','absent','GRANT EXECUTE ... TO service_role missing');
  END IF;

  -- A6: PUBLIC must NOT have EXECUTE
  SELECT (p.proacl IS NULL)
  INTO   v_proacl_null
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_public_batch_trace';

  SELECT COALESCE(bool_or(acl_entry::text ~ '^=X'), false)
  INTO   v_has_public_x
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN LATERAL unnest(p.proacl) AS acl_entry ON true
  WHERE  n.nspname = 'public' AND p.proname = 'get_public_batch_trace';

  IF v_proacl_null OR v_has_public_x THEN
    v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A6 PUBLIC EXECUTE revoked','FAIL',
      'PUBLIC has no execute','PUBLIC still has execute',
      'REVOKE ALL FROM PUBLIC did not take effect');
  ELSE
    v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
    INSERT INTO _verify_out VALUES (v_seq,'A6 PUBLIC EXECUTE revoked','PASS',
      'PUBLIC has no execute','confirmed revoked',NULL);
  END IF;


  -- ──────────────────────────────────────────────────────────
  -- B. FUNCTIONAL TESTS
  -- ──────────────────────────────────────────────────────────

  -- Resolve the most recent production order UUID
  SELECT id INTO v_test_id
  FROM   production_orders
  ORDER  BY created_at DESC
  LIMIT  1;

  v_seq := v_seq + 1;
  INSERT INTO _verify_out VALUES (v_seq,'B  test UUID (info)','INFO',
    'most recent production_order.id',
    COALESCE(v_test_id::text,'(none — no production_orders rows)'),NULL);

  IF v_test_id IS NULL THEN
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  functional tests','INFO',
      'N/A','SKIPPED','No production_orders rows — cannot run functional checks');
  ELSE

    -- B1: Live call returns non-null JSON (no ERROR 42883 or other runtime error)
    BEGIN
      SELECT get_public_batch_trace(v_test_id) INTO v_result;
      IF v_result IS NOT NULL THEN
        v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
        INSERT INTO _verify_out VALUES (v_seq,'B1 live call returns JSON','PASS',
          'non-null jsonb','non-null jsonb',NULL);
      ELSE
        v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
        INSERT INTO _verify_out VALUES (v_seq,'B1 live call returns JSON','FAIL',
          'non-null jsonb','NULL',
          'production_order exists but function returned NULL — company_id mismatch?');
        -- Cannot validate JSON shape without a result
        RETURN;
      END IF;
    EXCEPTION WHEN others THEN
      v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'B1 live call returns JSON','FAIL',
        'non-null jsonb','RUNTIME ERROR',SQLSTATE || ': ' || SQLERRM);
      -- Surface summary and stop — no point checking shape after a crash
      v_seq := v_seq + 1;
      INSERT INTO _verify_out VALUES (v_seq,'RESULT',
        CASE WHEN v_fail_count = 0 THEN 'PASS' ELSE 'FAIL' END,
        '0 failures',
        v_pass_count::text || ' passed / ' || v_fail_count::text || ' failed',
        CASE WHEN v_fail_count = 0
          THEN 'ALL CHECKS PASSED — READY FOR PHASE 3'
          ELSE 'FAILURES FOUND — DO NOT START PHASE 3'
        END);
      RETURN;
    END;

    -- Informational snapshot of key values
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  product.name','INFO','(any)',
      COALESCE(v_result -> 'product' ->> 'name','(null)'),NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  product.sku','INFO','(any)',
      COALESCE(v_result -> 'product' ->> 'sku','(null)'),NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  product.status','INFO','(any)',
      COALESCE(v_result -> 'product' ->> 'status','(null)'),NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  qc.overall_result','INFO','(any)',
      COALESCE(v_result -> 'qc' ->> 'overall_result','(null)'),NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  risk_level','INFO',
      'none|low|medium|high|critical',
      COALESCE(v_result ->> 'risk_level','(null)'),NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  has_active_recall','INFO','(any)',
      COALESCE(v_result -> 'recall_alert' ->> 'has_active_recall','(null)'),NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  timeline row count','INFO','(any)',
      jsonb_array_length(v_result -> 'timeline')::text,NULL);
    v_seq := v_seq + 1;
    INSERT INTO _verify_out VALUES (v_seq,'B  materials row count','INFO','(any)',
      jsonb_array_length(v_result -> 'materials')::text,NULL);

    -- B2: Unknown batch (zero UUID) must return NULL — no data leakage
    SELECT get_public_batch_trace('00000000-0000-0000-0000-000000000000') INTO v_null_result;
    IF v_null_result IS NULL THEN
      v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'B2 unknown batch → NULL','PASS',
        'NULL','NULL','Zero-UUID returns NULL — no cross-tenant data leakage');
    ELSE
      v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'B2 unknown batch → NULL','FAIL',
        'NULL','non-null','Unknown UUID returned data — investigate immediately');
    END IF;


    -- ────────────────────────────────────────────────────────
    -- C. TOP-LEVEL CONTRACT
    -- ────────────────────────────────────────────────────────

    -- C1: No unexpected top-level keys
    SELECT string_agg(k, ', ' ORDER BY k)
    INTO   v_unexpected
    FROM   jsonb_object_keys(v_result) AS k
    WHERE  k NOT IN ('product','qc','materials','timeline','recall_alert','risk_level');

    IF v_unexpected IS NULL THEN
      v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'C1 no extra top-level keys','PASS',
        '(none)','(none)',NULL);
    ELSE
      v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'C1 no extra top-level keys','FAIL',
        '(none)',v_unexpected,'Extra keys in public response — remove from allowlist');
    END IF;

    -- C2: All 6 required keys present
    IF (v_result ? 'product') AND (v_result ? 'qc') AND (v_result ? 'materials')
      AND (v_result ? 'timeline') AND (v_result ? 'recall_alert') AND (v_result ? 'risk_level')
    THEN
      v_seq := v_seq + 1; v_pass_count := v_pass_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'C2 all 6 required keys present','PASS',
        'product,qc,materials,timeline,recall_alert,risk_level','all present',NULL);
    ELSE
      v_seq := v_seq + 1; v_fail_count := v_fail_count + 1;
      INSERT INTO _verify_out VALUES (v_seq,'C2 all 6 required keys present','FAIL',
        'product,qc,materials,timeline,recall_alert,risk_level','one or more missing',
        'Check STEP 2–6 in function body');
    END IF;


    -- ────────────────────────────────────────────────────────
    -- D. FORBIDDEN-FIELD SCAN
    -- Scans full serialised JSON text for "key": patterns.
    -- ────────────────────────────────────────────────────────
    v_json_text := v_result::text;

    IF position('"inspector_name":'    IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  inspector_name','FAIL','absent','PRESENT','PII leak');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  inspector_name','PASS','absent','absent',NULL); END IF;

    IF position('"inspector_id":'      IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  inspector_id','FAIL','absent','PRESENT','PII leak');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  inspector_id','PASS','absent','absent',NULL); END IF;

    IF position('"actor_email":'       IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  actor_email','FAIL','absent','PRESENT','PII leak');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  actor_email','PASS','absent','absent',NULL); END IF;

    IF position('"actor_user_id":'     IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  actor_user_id','FAIL','absent','PRESENT','PII leak');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  actor_user_id','PASS','absent','absent',NULL); END IF;

    IF position('"owner_name":'        IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  owner_name','FAIL','absent','PRESENT','PII leak');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  owner_name','PASS','absent','absent',NULL); END IF;

    IF position('"initiated_by_name":' IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  initiated_by_name','FAIL','absent','PRESENT','PII leak');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  initiated_by_name','PASS','absent','absent',NULL); END IF;

    IF position('"notes":'             IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  notes','FAIL','absent','PRESENT','Internal notes leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  notes','PASS','absent','absent',NULL); END IF;

    IF position('"sales":'             IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  sales','FAIL','absent','PRESENT','B2B commercial data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  sales','PASS','absent','absent',NULL); END IF;

    IF position('"customer_name":'     IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  customer_name','FAIL','absent','PRESENT','B2B commercial data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  customer_name','PASS','absent','absent',NULL); END IF;

    IF position('"sold_at":'           IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  sold_at','FAIL','absent','PRESENT','B2B commercial data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  sold_at','PASS','absent','absent',NULL); END IF;

    IF position('"supplier_name":'     IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  supplier_name','FAIL','absent','PRESENT','Supply chain data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  supplier_name','PASS','absent','absent',NULL); END IF;

    IF position('"supplier_id":'       IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  supplier_id','FAIL','absent','PRESENT','Supply chain data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  supplier_id','PASS','absent','absent',NULL); END IF;

    IF position('"lot_number":'        IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  lot_number','FAIL','absent','PRESENT','Supply chain data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  lot_number','PASS','absent','absent',NULL); END IF;

    IF position('"lot_id":'            IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  lot_id','FAIL','absent','PRESENT','Supply chain data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  lot_id','PASS','absent','absent',NULL); END IF;

    IF position('"raw_material_lot_id":' IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  raw_material_lot_id','FAIL','absent','PRESENT','Supply chain data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  raw_material_lot_id','PASS','absent','absent',NULL); END IF;

    IF position('"bom_id":'            IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  bom_id','FAIL','absent','PRESENT','Supply chain data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  bom_id','PASS','absent','absent',NULL); END IF;

    IF position('"capas":'             IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  capas','FAIL','absent','PRESENT','CAPA internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  capas','PASS','absent','absent',NULL); END IF;

    IF position('"capa_number":'       IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  capa_number','FAIL','absent','PRESENT','CAPA internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  capa_number','PASS','absent','absent',NULL); END IF;

    IF position('"root_cause":'        IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  root_cause','FAIL','absent','PRESENT','CAPA/RCA internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  root_cause','PASS','absent','absent',NULL); END IF;

    IF position('"corrective_action":' IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  corrective_action','FAIL','absent','PRESENT','CAPA internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  corrective_action','PASS','absent','absent',NULL); END IF;

    IF position('"preventive_action":' IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  preventive_action','FAIL','absent','PRESENT','CAPA internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  preventive_action','PASS','absent','absent',NULL); END IF;

    IF position('"risk_score":'        IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  risk_score','FAIL','absent','PRESENT','Internal score leaked — only risk_level label is allowed');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  risk_score','PASS','absent','absent',NULL); END IF;

    IF position('"issue_signals":'     IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  issue_signals','FAIL','absent','PRESENT','Internal model data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  issue_signals','PASS','absent','absent',NULL); END IF;

    IF position('"material_trace":'    IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  material_trace','FAIL','absent','PRESENT','Internal trace data leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  material_trace','PASS','absent','absent',NULL); END IF;

    IF position('"source_table":'      IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  source_table','FAIL','absent','PRESENT','Schema internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  source_table','PASS','absent','absent',NULL); END IF;

    IF position('"entity_id":'         IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  entity_id','FAIL','absent','PRESENT','Schema internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  entity_id','PASS','absent','absent',NULL); END IF;

    IF position('"entity_type":'       IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  entity_type','FAIL','absent','PRESENT','Schema internals leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  entity_type','PASS','absent','absent',NULL); END IF;

    IF position('"user_agent":'        IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  user_agent','FAIL','absent','PRESENT','Scan telemetry leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  user_agent','PASS','absent','absent',NULL); END IF;

    IF position('"browser":'           IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  browser','FAIL','absent','PRESENT','Scan telemetry leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  browser','PASS','absent','absent',NULL); END IF;

    IF position('"device_type":'       IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  device_type','FAIL','absent','PRESENT','Scan telemetry leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  device_type','PASS','absent','absent',NULL); END IF;

    IF position('"metadata":'          IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  metadata','FAIL','absent','PRESENT','Raw metadata blob leaked');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  metadata','PASS','absent','absent',NULL); END IF;

    -- D: recall.reason must not be in public response (confirmed privacy blocker — FIX 1)
    IF position('"reason":'            IN v_json_text) > 0 THEN v_seq:=v_seq+1; v_fail_count:=v_fail_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  recall.reason','FAIL','absent','PRESENT','Internal investigation text / customer names leaked via recalls.reason — remove from STEP 6a');
    ELSE v_seq:=v_seq+1; v_pass_count:=v_pass_count+1; INSERT INTO _verify_out VALUES(v_seq,'D  recall.reason','PASS','absent','absent',NULL); END IF;

    -- D: qr.scan must not appear in any timeline entry
    SELECT COUNT(*) INTO v_qr_scan_count
    FROM   jsonb_array_elements(v_result -> 'timeline') AS entry
    WHERE  entry ->> 'event_type' = 'qr.scan';

    IF v_qr_scan_count > 0 THEN
      v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'D  qr.scan absent in timeline','FAIL',
        '0','found: ' || v_qr_scan_count,'Visitor scan telemetry in public timeline');
    ELSE
      v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'D  qr.scan absent in timeline','PASS',
        '0','0',NULL);
    END IF;


    -- ────────────────────────────────────────────────────────
    -- E. PUBLIC TIMELINE SHAPE
    -- ────────────────────────────────────────────────────────

    -- E1: No extra keys on any timeline entry
    SELECT string_agg(DISTINCT extra_key, ', ' ORDER BY extra_key)
    INTO   v_bad_entry_keys
    FROM   jsonb_array_elements(v_result -> 'timeline') AS entry,
           jsonb_object_keys(entry) AS extra_key
    WHERE  extra_key NOT IN ('event_type','event_timestamp','title');

    IF v_bad_entry_keys IS NULL THEN
      v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'E1 timeline entry — no extra keys','PASS',
        'event_type,event_timestamp,title only','correct',NULL);
    ELSE
      v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'E1 timeline entry — no extra keys','FAIL',
        'event_type,event_timestamp,title only',v_bad_entry_keys,'Remove extra keys');
    END IF;

    -- E2: All 3 required keys on every entry
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'timeline') AS entry
      WHERE NOT ((entry ? 'event_type') AND (entry ? 'event_timestamp') AND (entry ? 'title'))
    ) THEN
      v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'E2 timeline entry — required keys','FAIL',
        'all 3 keys on every row','one or more rows missing a key','Incomplete timeline entries');
    ELSE
      v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'E2 timeline entry — required keys','PASS',
        'all 3 keys on every row','correct (or timeline empty)',NULL);
    END IF;

    -- ────────────────────────────────────────────────────────
    -- G. POST-AUDIT CHECKS (added after Phase 2 audit)
    -- ────────────────────────────────────────────────────────

    -- G1: No recall entry in the array contains a "reason" key
    --     (structural check — supplements D text-scan above)
    IF EXISTS (
      SELECT 1
      FROM   jsonb_array_elements(v_result -> 'recall_alert' -> 'recalls') AS entry
      WHERE  entry ? 'reason'
    ) THEN
      v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'G1 recall array — reason key absent','FAIL',
        'no recall entry has "reason" key','PRESENT in one or more recall entries',
        'Remove ''reason'', r.reason from STEP 6a jsonb_build_object');
    ELSE
      v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
      INSERT INTO _verify_out VALUES(v_seq,'G1 recall array — reason key absent','PASS',
        'no recall entry has "reason" key','confirmed absent',NULL);
    END IF;

  END IF; -- end v_test_id IS NOT NULL


  -- ──────────────────────────────────────────────────────────
  -- F. FUNCTION SOURCE — TENANT SCOPING + TYPE CORRECTNESS
  -- ──────────────────────────────────────────────────────────
  SELECT p.prosrc INTO v_func_src
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_public_batch_trace';

  -- F1: v_company_id cross-query tenant guard
  IF position('v_company_id' IN v_func_src) > 0 THEN
    v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F1 v_company_id tenant guard','PASS',
      'present in function body','present',NULL);
  ELSE
    v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F1 v_company_id tenant guard','FAIL',
      'present in function body','MISSING','Cross-tenant scoping removed — critical');
  END IF;

  -- F2: b.company_id AND dr.company_id both scoped in Source D
  IF position('b.company_id' IN v_func_src) > 0 AND position('dr.company_id' IN v_func_src) > 0 THEN
    v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F2 distribution company scoping','PASS',
      'b.company_id + dr.company_id','both present',NULL);
  ELSE
    v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F2 distribution company scoping','FAIL',
      'b.company_id + dr.company_id','one or both missing',
      'Distribution chain not fully company-scoped');
  END IF;

  -- F3: Source D join — b.id = dr.batch_id (uuid = uuid, no ::text cast)
  --     distribution_records.batch_id is UUID in the live DB.
  IF position('b.id = dr.batch_id' IN v_func_src) > 0
    AND position('b.id::text = dr.batch_id' IN v_func_src) = 0
  THEN
    v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F3 Source D join (uuid = uuid)','PASS',
      'b.id = dr.batch_id','correct — no ::text cast',NULL);
  ELSE
    v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F3 Source D join (uuid = uuid)','FAIL',
      'b.id = dr.batch_id','wrong or missing',
      'Source D has incorrect ::text cast or pattern not found');
  END IF;

  -- F4: Source F join — b.id = be.batch_id (uuid = uuid, no ::text cast)
  --     batch_events.batch_id confirmed UUID by live information_schema diagnostic.
  --     Previous state b.id::text = be.batch_id → ERROR 42883: text = uuid.
  IF position('b.id = be.batch_id' IN v_func_src) > 0
    AND position('b.id::text = be.batch_id' IN v_func_src) = 0
  THEN
    v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F4 Source F join (uuid = uuid)','PASS',
      'b.id = be.batch_id','correct — no ::text cast',NULL);
  ELSE
    v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F4 Source F join (uuid = uuid)','FAIL',
      'b.id = be.batch_id','wrong or missing',
      'Source F has ::text cast → ERROR 42883 will recur — re-deploy fix');
  END IF;

  -- F5: Closed recalls excluded from current risk score (FIX 2)
  --     Counts occurrences of status <> 'closed' in the function body.
  --     After FIX 2 the pattern appears 5 times:
  --       v_has_active_recall  (pre-existing)
  --       v_open_capas         (pre-existing — capas, not recalls)
  --       v_open_recalls       (pre-existing)
  --       v_critical_recalls   (added by FIX 2)
  --       v_affected_units     (added by FIX 2)
  --     Before FIX 2: 3 occurrences — check fails, signalling re-deploy needed.
  IF (
    length(v_func_src) - length(replace(v_func_src, '<> ''closed''', ''))
  ) / length('<> ''closed''') >= 5
  THEN
    v_seq:=v_seq+1; v_pass_count:=v_pass_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F5 closed-recall risk exclusion','PASS',
      '>= 5 status <> closed filters in function body',
      'confirmed — v_critical_recalls + v_affected_units exclude closed recalls',NULL);
  ELSE
    v_seq:=v_seq+1; v_fail_count:=v_fail_count+1;
    INSERT INTO _verify_out VALUES(v_seq,'F5 closed-recall risk exclusion','FAIL',
      '>= 5 status <> closed filters in function body',
      'only ' || (
        (length(v_func_src) - length(replace(v_func_src, '<> ''closed''', '')))
        / length('<> ''closed''')
      )::text || ' found',
      'Apply AND status <> ''closed'' to v_critical_recalls and v_affected_units — re-deploy');
  END IF;


  -- ──────────────────────────────────────────────────────────
  -- SUMMARY — final row
  -- ──────────────────────────────────────────────────────────
  v_seq := v_seq + 1;
  INSERT INTO _verify_out VALUES (
    v_seq,
    '══ RESULT ══',
    CASE WHEN v_fail_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    '0 failures',
    v_pass_count::text || ' passed / ' || v_fail_count::text || ' failed',
    CASE WHEN v_fail_count = 0
      THEN 'ALL CHECKS PASSED — READY FOR PHASE 3'
      ELSE 'FAILURES FOUND — DO NOT START PHASE 3'
    END
  );

END;
$$;

SELECT * FROM _verify_out ORDER BY seq;
