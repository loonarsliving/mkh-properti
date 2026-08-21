# AI_AND_AGENTS

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
