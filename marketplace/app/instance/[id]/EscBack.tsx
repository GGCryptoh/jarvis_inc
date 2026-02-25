'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EscBack() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.push('/gallery');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  return null;
}
