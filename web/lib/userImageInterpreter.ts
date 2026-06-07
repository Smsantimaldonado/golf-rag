import OpenAI from "openai";

const DEFAULT_VISION_MODEL = "gpt-5-mini";

export type UserSituationImage = {
  data: Buffer;
  mimeType: string;
  fileName: string;
};

export type VisualSituationDescription = {
  description: string;
  uncertainty: string;
};

export async function describeUserSituationImage(openai: OpenAI, image: UserSituationImage): Promise<VisualSituationDescription> {
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_ANSWER_MODEL || DEFAULT_VISION_MODEL;
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Describí esta imagen para un asistente de reglas de golf.",
              "No decidas reglas, penalidades ni procedimientos.",
              "No agregues conocimiento externo y no inventes objetos no visibles.",
              "Focalizate en hechos visibles que puedan afectar la búsqueda documental:",
              "reposo/lie de la bola, área aparente del campo, objetos cercanos, posibles obstrucciones, estacas, líneas, bunker, green, agua, stance, swing, línea de juego e incertidumbre visual.",
              "Respondé en JSON válido con estas claves exactas:",
              '{"description":"descripción breve en español","uncertainty":"incertidumbre visual breve; si no hay, usar No se advierte incertidumbre visual relevante."}',
            ].join(" "),
          },
          {
            type: "input_image",
            image_url: imageDataUrl(image),
            detail: "high",
          },
        ],
      },
    ],
  });

  return parseVisualDescription(response.output_text);
}

function imageDataUrl(image: UserSituationImage) {
  return `data:${image.mimeType};base64,${image.data.toString("base64")}`;
}

function parseVisualDescription(text: string): VisualSituationDescription {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description.trim() : text.trim(),
      uncertainty:
        typeof parsed.uncertainty === "string" && parsed.uncertainty.trim()
          ? parsed.uncertainty.trim()
          : "No se advierte incertidumbre visual relevante.",
    };
  } catch {
    return {
      description: text.trim(),
      uncertainty: "No se advierte incertidumbre visual relevante.",
    };
  }
}
