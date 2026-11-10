# AI_AND_AGENTS

> **DIPERBARUI 2026-11-01:** repo ini kini memiliki **AI CFO** (branch
> `claude/ai-cfo-financial-manager`). Semua angka dihitung deterministik di
> `src/lib/cfo/`; model bahasa MILIK MK CONNECT (Mkhsistem `/api/mkh-property/ai-cfo/narasi`,
> penyedia Gemini MK Connect; MKH Property tidak punya kunci AI) hanya
> menarasikan daftar fakta bernomor dari `src/lib/cfo/server.ts`, dan setiap
> nominal rupiah di jawabannya divalidasi terhadap fakta (`validasiJawaban`)
> — bila gagal, jawaban deterministik yang dipakai. Putusan CEO challenger
> (aman/waspada/tolak) dihitung kode (`penantang.ts`), bukan model. AI CFO
> tidak punya akses tulis ke transaksi. Bagian di bawah menggambarkan keadaan
> sebelum AI CFO.

## Prinsip owner untuk AI CFO / sistem (2026-11-10)

Arahan owner setelah sistem mengirim "Pak Avi minta total harga untuk DP…" ke pelaksana:
"Jangan pernah bawa saya lagi. MKH sistem adalah CFO AI sendiri, jadi harus bisa berpikir
sendiri ketika sebuah pengajuan tidak lengkap, lebih teliti, terus menyempurnakan diri."

1. **Bersuara sebagai sistem/CFO sendiri.** Pesan ke pelaksana/staf tidak pernah
   mengatasnamakan owner, menyebut nama owner, atau "persetujuan owner" (migrasi 0067
   membersihkan pesan Loonars 2; uji `loonars2_uji_total_dp_susulan.sql` menjaga agar
   tidak muncul lagi). Pesan KE owner boleh tetap menyapa owner.
2. **Periksa kelengkapan sendiri sebelum meneruskan.** Pengajuan yang kurang data
   (rekening tujuan — 0056, total DP — 0064/0066, unit — 0047) ditahan dan ditanyakan
   oleh sistem; data yang dijawab disimpan terstruktur (mis. kontrak DP 0065) dan dipakai
   untuk mengecek pembayaran berikutnya.
3. **Batas pengaman tetap berlaku:** angka dihitung kode, bukan model; keputusan uang
   (setuju/tolak/transfer) tetap di owner. "Berkembang sendiri" diwujudkan sebagai
   pemeriksaan baru yang ditambahkan bertahap dan diuji, bukan model yang mengubah aturan
   keuangannya sendiri.

## Status: NOT IMPLEMENTED in this repository.

No AI/LLM SDK, API client, prompt, model reference, or agent framework of any kind exists in this codebase. Searched for Gemini, OpenAI, Anthropic/Claude, and generic "AI"/"agent" code references across all `.html` files and the `supabase/` directory — none found.

## What does exist (external, referenced only in comments)
Migration `0027_material_expense_receipt_wa_ai_submission.sql` documents, in a comment, that the **external MK Connect system** uses AI to read WhatsApp receipt ("nota") photos sent by field staff (Endy/Rebecca) and extract nominal amounts and item details, which are then forwarded into this app via the `sync-inbound` Edge Function as a `material_expense_receipt_submitted` event. Per that same comment: **"no image is stored — read once, then discarded."**

This means:
- The AI model, prompts, and photo-reading logic live entirely in the MK Connect repository — **not in this repo**.
- This repo only implements the **receiving side**: a plain data-insertion handler (`sync-inbound`) that treats the AI-extracted data exactly like a manually-submitted expense (`tipe='bahan'`), with no AI logic of its own.

## Model / provider used by MK Connect's AI
UNKNOWN — NEEDS CONFIRMATION. Not named anywhere in this repository. Would need to be confirmed against the MK Connect repository directly.

## Conclusion
Do not add, assume, or build any AI/agent functionality into this repo based on this document. If a future task requires AI features, that is new functionality outside this audit's scope, and outside what currently exists in `loonarsliving/mkh-properti`.
