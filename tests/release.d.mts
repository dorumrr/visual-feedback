export function next(current: string, published: string | undefined): string;
export function top(
  changelog: string,
): { version: string; waiting: boolean; text: string } | undefined;
export function offer(current: string, published: string | undefined, changelog: string): string;
export function refusal(changelog: string, version: string): string | undefined;
export function newer(a: string, b: string): boolean;
export function dated(changelog: string, version: string, today: string): string;
export function setVersion(json: string, version: string): string;
