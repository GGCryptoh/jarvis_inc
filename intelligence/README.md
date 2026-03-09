# /intelligence/ — Prompt Intelligence System

## How This Works

```
/intelligence/*.default.md  →  (reset script)  →  DB settings table  →  (Settings UI edits)  →  Runtime
```

### Runtime Flow
1. Code calls `getPrompt('ceo-system-core')` from `database.ts`
2. Checks DB `settings` table for key `prompt:ceo-system-core`
3. If found → uses DB value (may have been edited in Settings UI)
4. If not found → falls back to hardcoded default in source code

### Files
- `*.default.md` — **Canonical defaults. Maintained by developers.** These are the "factory reset" versions.
  - DO NOT edit these at runtime. They are the version-controlled source of truth.
  - HTML comments (`<!-- -->`) are stripped when loading into DB.
- `scripts/reset-intelligence.mjs` — Reads all `*.default.md` files and writes them into the DB `settings` table, overwriting any UI edits.

### Editing Prompts
- **Quick edits:** Use Settings → Intelligence Management in the app UI
- **Permanent changes:** Edit the `*.default.md` file, then run the reset script to push to DB
- **Reset to defaults:** Run `node intelligence/scripts/reset-intelligence.mjs`

### DB Storage
Prompts are stored in the `settings` table as:
- Key: `prompt:<filename-without-default.md>` (e.g., `prompt:ceo-system-core`)
- Value: The prompt text content

### Adding New Prompts
1. Create `intelligence/prompts/<name>.default.md` with the prompt text
2. Run the reset script to load it into DB
3. Reference it in code via `getPrompt('<name>')` from `src/lib/database.ts`
4. Add it to the `PROMPT_REGISTRY` in `src/components/Settings/SettingsView.tsx`
5. Update `AI/Intelligence-System.md` doc

### IMPORTANT: System Changes
Changes to LLM behavior require updates in **4 places**:
1. The `.default.md` file in `/intelligence/prompts/`
2. The hardcoded fallback in the source code file
3. The `PROMPT_REGISTRY` in `SettingsView.tsx`
4. The `AI/Intelligence-System.md` architecture doc
