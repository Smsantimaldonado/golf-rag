import { NextResponse } from "next/server";
import { answerGolfQuestion, type PerfMetric } from "@/lib/golfAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

type AskRequest = {
  messages?: unknown;
};

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = now();
  const timings: PerfMetric[] = [];

  try {
    console.info("[ask] request_start", { requestId });
    const body = (await request.json()) as AskRequest;

    if (!Array.isArray(body.messages) || !body.messages.every((message) => typeof message === "string")) {
      console.warn("[ask] validation_error", { requestId, reason: "messages_not_string_array" });
      return NextResponse.json({ error: "El cuerpo debe incluir messages como lista de textos." }, { status: 400 });
    }
    if (body.messages.length === 0 || body.messages.length > 3) {
      console.warn("[ask] validation_error", { requestId, reason: "message_count_out_of_range", messageCount: body.messages.length });
      return NextResponse.json({ error: "La mini conversaci\u00f3n admite entre 1 y 3 mensajes del usuario." }, { status: 400 });
    }

    const result = await answerGolfQuestion(body.messages, {
      requestId,
      onMetric: (metric) => timings.push(metric),
    });
    console.info("[ask] request_end", { requestId, durationMs: roundMs(now() - startedAt), messageCount: body.messages.length });
    return NextResponse.json(result, {
      headers: {
        "Server-Timing": buildServerTiming(timings),
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    console.error("[ask] request_error", {
      requestId,
      durationMs: roundMs(now() - startedAt),
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: message }, { status: 500, headers: { "X-Request-Id": requestId } });
  }
}

function buildServerTiming(metrics: PerfMetric[]) {
  return metrics.map((metric) => `${metric.stage};dur=${metric.durationMs}`).join(", ");
}

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}
