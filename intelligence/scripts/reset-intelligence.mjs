#!/usr/bin/env node
// Reset all intelligence prompts to their .default.md canonical values
// Usage: node intelligence/scripts/reset-intelligence.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.development') });
dotenv.config({ path: path.join(projectRoot, 'docker/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);
const promptsDir = path.join(projectRoot, 'intelligence/prompts');

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

async function main() {
  const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.default.md'));
  console.log(`Found ${files.length} default prompt files\n`);

  let ok = 0, fail = 0;
  for (const file of files) {
    const key = 'prompt:' + file.replace('.default.md', '');
    const raw = fs.readFileSync(path.join(promptsDir, file), 'utf-8');
    const content = stripComments(raw);

    const { error } = await sb
      .from('settings')
      .upsert({ key, value: content }, { onConflict: 'key' });

    if (error) {
      console.error(`  FAIL ${key}: ${error.message}`);
      fail++;
    } else {
      console.log(`  OK   ${key} (${content.length} chars)`);
      ok++;
    }
  }

  console.log(`\nDone. ${ok} loaded, ${fail} failed.`);
}

main().catch(err => { console.error(err); process.exit(1); });
