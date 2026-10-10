export function next(current: string, published: string | undefined): string;
export function newer(a: string, b: string): boolean;
export function dated(changelog: string, version: string, today: string): string;
export function setVersion(json: string, version: string): string;
