import { NextResponse } from "next/server";
import { answerGolfQuestion } from "@/lib/golfAgent";

export const runtime = "nodejs";
export const maxDuration = 30;

type AskRequest = {
  messages?: unknown;
  passcode?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AskRequest;
    const expectedPasscode = process.env.APP_PASSCODE;
    if (expectedPasscode && body.passcode !== expectedPasscode) {
      return NextResponse.json({ error: "Passcode inválido." }, { status: 401 });
    }

    if (!Array.isArray(body.messages) || !body.messages.every((message) => typeof message === "string")) {
      return NextResponse.json({ error: "El cuerpo debe incluir messages como lista de textos." }, { status: 400 });
    }
    if (body.messages.length === 0 || body.messages.length > 3) {
      return NextResponse.json({ error: "La mini conversación admite entre 1 y 3 mensajes del usuario." }, { status: 400 });
    }

    const result = await answerGolfQuestion(body.messages);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
