export type SourceFile = {
  path: string;
  source: string;
};

export function findClientBoundaryViolations(files: readonly SourceFile[]): string[];
