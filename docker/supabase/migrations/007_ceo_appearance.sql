-- 007: Add color & skin_tone to CEO table for sprite customization
ALTER TABLE public.ceo ADD COLUMN IF NOT EXISTS color     TEXT DEFAULT '#f1fa8c';
ALTER TABLE public.ceo ADD COLUMN IF NOT EXISTS skin_tone TEXT DEFAULT '#ffcc99';
