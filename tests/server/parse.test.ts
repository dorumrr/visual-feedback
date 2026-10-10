import { it } from "vitest";
import { cases } from "./cases";

for (const { name, run } of cases) it(name, run);
