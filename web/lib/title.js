'use client';
import { useEffect } from 'react';

// Gives each client-rendered page its own document title (WCAG 2.4.2), so screen-reader and tab users can tell pages apart.
export function usePageTitle(title) {
  useEffect(() => { if (title) document.title = `${title} · Verity`; }, [title]);
}
