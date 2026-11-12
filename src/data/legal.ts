// The public pages the app renders itself (components/LegalView.tsx). The
// worker serves the app shell for the same three paths (worker/index.ts).

export type LegalDoc = 'privacy' | 'terms' | 'support';

const PATHS: Record<string, LegalDoc> = { '/privacy': 'privacy', '/terms': 'terms', '/support': 'support' };

export function legalDocForPath(pathname: string): LegalDoc | null {
  return PATHS[pathname.replace(/\/+$/, '')] ?? null;
}
