/** Data files imported `with { type: 'file' }` resolve to a path (embedded when compiled). */
declare module '*.tsv.gz' {
  const path: string;
  export default path;
}
