import { NextResponse } from "next/server";
import { answerGolfQuestion, answerGolfQuestionWithImage } from "@/lib/golfAgent";
import type { UserSituationImage } from "@/lib/userImageInterpreter";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxImageBytes = 5 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type AskRequest = {
  messages?: unknown;
  passcode?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await parseAskRequest(request);
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
    if (!body.image && !body.messages.some((message) => message.trim())) {
      return NextResponse.json({ error: "Ingresá texto o adjuntá una imagen." }, { status: 400 });
    }

    const result = body.image ? await answerGolfQuestionWithImage(body.messages, body.image) : await answerGolfQuestion(body.messages);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function parseAskRequest(request: Request): Promise<AskRequest & { image?: UserSituationImage }> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const passcode = formData.get("passcode");
    const messagesValue = formData.get("messages");
    const messages = parseMessages(messagesValue);
    const image = await parseImage(formData.get("image"));
    return {
      passcode: typeof passcode === "string" ? passcode : "",
      messages,
      image,
    };
  }

  return (await request.json()) as AskRequest;
}

function parseMessages(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    throw new Error("El cuerpo debe incluir messages como JSON.");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("messages debe ser una lista JSON válida.");
  }
}

async function parseImage(value: FormDataEntryValue | null): Promise<UserSituationImage | undefined> {
  if (!value || typeof value === "string") {
    return undefined;
  }
  if (value.size === 0) {
    return undefined;
  }
  if (!allowedImageTypes.has(value.type)) {
    throw new Error("La imagen debe ser JPG, PNG o WEBP.");
  }
  if (value.size > maxImageBytes) {
    throw new Error("La imagen no puede superar 5 MB.");
  }

  return {
    data: Buffer.from(await value.arrayBuffer()),
    mimeType: value.type,
    fileName: value.name || "imagen",
  };
}
