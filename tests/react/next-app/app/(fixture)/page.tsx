import { Feedback } from "visual-feedback/react";

// Rendered on each request, not only once at build time.
export const dynamic = "force-dynamic";

// A server component: the props cross to the client, as in a real Next.js app.
export default function Page() {
  return (
    <main>
      <h1>Next.js fixture</h1>
      <Feedback endpoint="/api/feedback" />
    </main>
  );
}
