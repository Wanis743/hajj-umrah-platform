export function normalizeSearchTerm(term: string): string {
  return term.trim().replace(/[%(),]/g, ' ').slice(0, 200);
}
