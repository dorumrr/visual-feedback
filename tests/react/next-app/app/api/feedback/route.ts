import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

const received: string[] = [];

export async function POST(request: Request): Promise<Response> {
  try {
    const { report } = await parseFeedbackRequest(request);
    received.push(report.note);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}

export function GET(): Response {
  return Response.json(received);
}
