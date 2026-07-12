// MKH Property — sync-inbound Edge Function
//
// Receives cross-system sync events from MK Connect (CRM/HR/Ops). Deployed
// with verify_jwt = false (see supabase/config.toml) — this is a
// server-to-server call from another Supabase project's Postgres trigger via
// pg_net, not a browser request.
//
// Authentication: shared secret (X-Sync-Secret, from Supabase Vault via the
// public.get_sync_secret() RPC — see 0001_sync_foundation.sql) + idempotency
// (every request carries a unique idempotency_key; duplicates are a no-op
// that returns the previously recorded target_ref).
//
// Event types handled:
//   - crm_payment_approved       -> Incoming Cash (2 jurnal rows, direct
//                                    post, matching this app's own existing
//                                    "income posts directly" pattern) +
//                                    a crm_payment_receipts row for the
//                                    CFO's confirmation queue.
//   - sales_commission_approved  -> pengajuan (tipe='komisi'), CFO-approved
//                                    like any other expense.
//   - payroll_salary_generated   -> pengajuan (tipe='gaji').
//   - bonus_approved             -> pengajuan (tipe='bonus').
//   - reimbursement_approved     -> pengajuan (tipe='reimbursement').
//   - hr_expense_approved        -> pengajuan (tipe='hr_lain').
//   - payroll_run_approved       -> informational only (logged, no ledger
//                                    effect — the per-employee
//                                    payroll_salary_generated events are
//                                    what actually create expense records).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

type Payload = Record<string, unknown>;

const PENGAJUAN_TIPE: Record<string, string> = {
  sales_commission_approved: "komisi",
  payroll_salary_generated: "gaji",
  bonus_approved: "bonus",
  reimbursement_approved: "reimbursement",
  hr_expense_approved: "hr_lain",
};

const REVENUE_ACCOUNT: Record<string, { akun: string; nama: string }> = {
  booking_fee: { akun: "4-1002", nama: "Uang Muka Penjualan" },
  dp: { akun: "4-1002", nama: "Uang Muka Penjualan" },
  installment: { akun: "4-1002", nama: "Uang Muka Penjualan" },
  bank_disbursement: { akun: "4-1001", nama: "Penjualan Rumah" },
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: expectedSecret } = await admin.rpc("get_sync_secret");
  const providedSecret = req.headers.get("X-Sync-Secret") ?? "";
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: {
    sync_log_id?: string;
    idempotency_key?: string;
    event_type?: string;
    source_system?: string;
    payload?: Payload;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { idempotency_key, event_type, payload } = body;
  if (!idempotency_key || !event_type || !payload) {
    return new Response(JSON.stringify({ error: "Missing idempotency_key/event_type/payload" }), { status: 400 });
  }

  const { data: inserted, error: insertErr } = await admin
    .from("sync_log")
    .insert({
      direction: "inbound",
      event_type,
      source_table: "mk_connect",
      source_id: crypto.randomUUID(),
      idempotency_key,
      payload,
      status: "sent",
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: existing } = await admin
        .from("sync_log")
        .select("status, target_ref")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      return new Response(JSON.stringify({ status: "duplicate", target_ref: existing?.target_ref ?? null }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ error: insertErr.message }), { status: 500 });
  }

  const syncLogId = inserted!.id as string;

  try {
    let targetRef: string | null = null;

    if (event_type === "crm_payment_approved") {
      targetRef = await handleCrmPaymentApproved(admin, idempotency_key, payload);
    } else if (event_type === "payroll_run_approved") {
      // Informational only — no ledger effect. Individual
      // payroll_salary_generated events carry the actual expense amounts.
      targetRef = null;
    } else if (PENGAJUAN_TIPE[event_type]) {
      targetRef = await handleHrPengajuan(admin, idempotency_key, event_type, payload);
    } else {
      await admin
        .from("sync_log")
        .update({ status: "skipped", last_error: `Unknown event_type: ${event_type}`, updated_at: new Date().toISOString() })
        .eq("id", syncLogId);
      return new Response(JSON.stringify({ status: "skipped", reason: "unknown event_type" }), { status: 200 });
    }

    await admin
      .from("sync_log")
      .update({ status: "succeeded", target_ref: targetRef, updated_at: new Date().toISOString() })
      .eq("id", syncLogId);

    return new Response(JSON.stringify({ status: "ok", target_ref: targetRef }), { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("sync_log")
      .update({ status: "failed", last_error: message.slice(0, 2000), updated_at: new Date().toISOString() })
      .eq("id", syncLogId);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});

// deno-lint-ignore no-explicit-any
async function nextMkhNo(admin: any, prefix: string): Promise<string> {
  const { data, error } = await admin.rpc("next_mkh_no", { p_prefix: prefix });
  if (error) throw new Error(`next_mkh_no failed: ${error.message}`);
  return `${prefix}-${data}`;
}

// deno-lint-ignore no-explicit-any
async function handleCrmPaymentApproved(admin: any, idempotencyKey: string, payload: Payload): Promise<string> {
  const proyek = (payload.mkh_project_code as string | null) || null;
  if (!proyek) {
    throw new Error(
      `Unmapped CRM project "${payload.project_name}" — set crm_projects.mkh_project_code in MK Connect before this payment can sync.`
    );
  }

  const paymentType = (payload.payment_type as string) || "dp";
  const revenue = REVENUE_ACCOUNT[paymentType] ?? REVENUE_ACCOUNT.dp;
  const amount = Number(payload.amount) || 0;
  const tgl = (payload.payment_date as string) || new Date().toISOString().slice(0, 10);
  const no = await nextMkhNo(admin, "KM");

  const { data: project } = await admin.from("mkh_projects").select("rekening, bank").eq("kode", proyek).maybeSingle();
  const cashAkun = project?.rekening || "1-1001";
  const cashNama = project?.rekening ? `Bank ${project.bank ?? ""}`.trim() : "Kas Tunai";

  const ket = [
    "Sinkronisasi CRM:",
    payload.customer_name,
    "-",
    payload.project_name,
    payload.unit_label ? `Unit ${payload.unit_label}` : null,
    `(${paymentType})`,
    "- Sales:",
    payload.sales_name,
    "- Cabang:",
    payload.branch_name,
    payload.reference_number ? `- Ref: ${payload.reference_number}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const { error: jurnalErr } = await admin.from("jurnal").insert([
    {
      tgl,
      no,
      ket,
      akun: cashAkun,
      nama: cashNama,
      proyek,
      d: amount,
      k: 0,
      idempotency_key: `${idempotencyKey}:d`,
      source_system: "mk_connect",
      source_ref: payload.prospect_payment_id,
    },
    {
      tgl,
      no,
      ket,
      akun: revenue.akun,
      nama: revenue.nama,
      proyek,
      d: 0,
      k: amount,
      idempotency_key: `${idempotencyKey}:k`,
      source_system: "mk_connect",
      source_ref: payload.prospect_payment_id,
    },
  ]);
  if (jurnalErr) throw new Error(`jurnal insert failed: ${jurnalErr.message}`);

  const { error: receiptErr } = await admin.from("crm_payment_receipts").insert({
    mkc_payment_id: payload.prospect_payment_id,
    mkc_prospect_id: payload.prospect_id,
    proyek,
    customer_name: payload.customer_name,
    project_name: payload.project_name,
    unit_label: payload.unit_label,
    payment_type: paymentType,
    amount,
    payment_date: tgl,
    reference_number: payload.reference_number,
    sales_name: payload.sales_name,
    branch_name: payload.branch_name,
    jurnal_no: no,
    idempotency_key: idempotencyKey,
  });
  if (receiptErr) throw new Error(`crm_payment_receipts insert failed: ${receiptErr.message}`);

  return no;
}

// deno-lint-ignore no-explicit-any
async function handleHrPengajuan(admin: any, idempotencyKey: string, eventType: string, payload: Payload): Promise<string> {
  const tipe = PENGAJUAN_TIPE[eventType];
  const proyek = (payload.mkh_project_code as string | null) || "HO";

  const nominal =
    eventType === "sales_commission_approved"
      ? Number(payload.commission_amount) || 0
      : eventType === "payroll_salary_generated"
      ? Number(payload.net_salary) || 0
      : Number(payload.amount) || 0;

  const data: Payload = {
    source: "mk_connect",
    nominal,
    tgl: (payload.payment_date ?? payload.expense_date ?? new Date().toISOString().slice(0, 10)) as string,
    proyek_nama: proyek === "HO" ? "Kantor Pusat / Overhead" : proyek,
    employee_name: payload.employee_name,
    employee_code: payload.employee_code,
    mkc_employee_id: payload.employee_id,
    sales_name: payload.sales_name,
    branch_name: payload.branch_name,
    period_month: payload.period_month,
    period_year: payload.period_year,
    base_salary: payload.base_salary,
    description: payload.description,
  };

  const { data: inserted, error } = await admin
    .from("pengajuan")
    .insert({
      proyek,
      tipe,
      data,
      status: "pending",
      created_by: "sync:mk_connect",
      source_system: "mk_connect",
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`pengajuan insert failed: ${error.message}`);
  return String(inserted!.id);
}
