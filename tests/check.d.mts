export type Result = {
  name: string;
  state: "PASS" | "FAIL" | "STOP";
  ms: number;
  code?: number | string | null;
  output?: string;
  log?: string;
};
export function steps(scripts: Record<string, string>): string[];
export function plain(text: string): string;
export function ends(lines: string[]): string;
export function duration(ms: number): string;
export function summary(results: Result[], total: number): string;
export function report(failed: Result[], facts: string): string;
