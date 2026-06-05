/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════════════════════════════════
// upload-template.js — Phase 3b
//
// Pushes the git-tracked canonical template into the PRIVATE Supabase
// Storage 'templates' bucket (the runtime source for workbook exports).
// Re-run whenever templates/Company_Estimate_Template.xlsx changes.
//
// Requires (read from .env.local via `npm run upload-template`):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (Dashboard → Settings → API; server-side
//                                secret — the bucket has NO write RLS
//                                policy, so only the service role can
//                                upload. Never expose it to the browser.)
//
// After uploading, the script re-downloads the object and byte-compares
// it against the local file to verify round-trip integrity.
// ═══════════════════════════════════════════════════════════════════

const BUCKET = 'templates'; // mirrors TEMPLATE_STORAGE_BUCKET in src/lib/constants.ts
const TEMPLATE_NAME = 'Company_Estimate_Template.xlsx'; // mirrors MASTER_TEMPLATE_NAME
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', TEMPLATE_NAME);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Add SUPABASE_SERVICE_ROLE_KEY to .env.local (Supabase Dashboard → Settings → API).'
    );
    process.exit(1);
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`ERROR: Template file not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(TEMPLATE_PATH);
  console.log(`Uploading ${TEMPLATE_NAME} (${fileBuffer.length} bytes) to private bucket "${BUCKET}"...`);

  const supabase = createClient(url, serviceKey);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(TEMPLATE_NAME, fileBuffer, {
      upsert: true,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  if (uploadError) {
    console.error(`ERROR: upload failed — ${uploadError.message}`);
    process.exit(1);
  }

  // Round-trip verification: download and byte-compare
  const { data, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(TEMPLATE_NAME);
  if (downloadError || !data) {
    console.error(`ERROR: verification download failed — ${downloadError?.message ?? 'empty response'}`);
    process.exit(1);
  }
  const downloaded = Buffer.from(await data.arrayBuffer());
  if (!downloaded.equals(fileBuffer)) {
    console.error(
      `ERROR: round-trip mismatch — uploaded ${fileBuffer.length} bytes but downloaded ${downloaded.length}. ` +
      'Do not trust the Storage copy; investigate before exporting.'
    );
    process.exit(1);
  }

  console.log(`OK: ${TEMPLATE_NAME} uploaded and round-trip verified (${downloaded.length} bytes).`);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
