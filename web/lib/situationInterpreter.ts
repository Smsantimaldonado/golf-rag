import OpenAI from "openai";

const DEFAULT_INTERPRETER_MODEL = "gpt-5-mini";

export type InterpretationConfidence = "alta" | "media" | "baja";

export type InterpretedSituation = {
  facts: string[];
  originalTerms: string[];
  normalizedTerms: string[];
  ruleCategories: string[];
  expandedQuery: string;
  confidence: InterpretationConfidence;
  requiresClarification: boolean;
  clarifyingQuestion: string | null;
};

const fallbackInterpretation: InterpretedSituation = {
  facts: [],
  originalTerms: [],
  normalizedTerms: [],
  ruleCategories: [],
  expandedQuery: "",
  confidence: "media",
  requiresClarification: false,
  clarifyingQuestion: null,
};

export async function interpretUserSituation(openai: OpenAI, messages: string[]): Promise<InterpretedSituation> {
  const prompt = buildInterpreterPrompt(messages);
  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_INTERPRETER_MODEL || process.env.OPENAI_ANSWER_MODEL || DEFAULT_INTERPRETER_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Sos un normalizador semántico para un asistente de reglas de golf.",
                "Tu tarea no es decidir reglas, penalidades ni procedimientos.",
                "Transformá lenguaje natural o coloquial del usuario en hechos y categorías buscables para recuperación documental.",
                "Podés emparentar términos del usuario con categorías golfísticas probables cuando la relación sea razonable.",
                "Si un término es ambiguo y la categoría cambiaría la búsqueda o decisión, pedí una aclaración breve.",
                "No propongas reglas locales ni categorías de reglas locales salvo que el usuario mencione expresamente una regla local.",
                "Respondé solo JSON válido, sin Markdown.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    });
    return normalizeInterpretation(JSON.parse(response.output_text));
  } catch {
    return fallbackInterpretation;
  }
}

function buildInterpreterPrompt(messages: string[]) {
  return JSON.stringify(
    {
      user_messages: messages,
      output_schema: {
        facts: ["hechos concretos del caso sin decidir reglas"],
        originalTerms: ["términos relevantes usados por el usuario"],
        normalizedTerms: ["términos normalizados o emparentados para búsqueda"],
        ruleCategories: ["categorías de reglas probables para búsqueda"],
        expandedQuery: "consulta expandida para búsqueda documental, no una respuesta",
        confidence: "alta | media | baja",
        requiresClarification: "boolean",
        clarifyingQuestion: "string|null",
      },
      guidance: [
        "Ejemplo: 'boca de riego' puede emparentarse con instalación fija de riego, aspersor, obstrucción inamovible, condición anormal del campo si el contexto sugiere que es fija y está en el suelo.",
        "Ejemplo: 'tapa metálica fija' puede emparentarse con obstrucción inamovible.",
        "Ejemplo: 'manguera suelta' puede emparentarse con obstrucción movible.",
        "No inventes penalidades ni procedimientos.",
        "No incluyas reglas locales como categoría probable si el usuario no las mencionó.",
        "Si la confianza es baja, requiresClarification debe ser true y clarifyingQuestion debe confirmar el término ambiguo.",
      ],
    },
    null,
    2,
  );
}

function normalizeInterpretation(raw: unknown): InterpretedSituation {
  if (!raw || typeof raw !== "object") {
    return fallbackInterpretation;
  }
  const value = raw as Record<string, unknown>;
  const confidence = value.confidence === "alta" || value.confidence === "baja" ? value.confidence : "media";
  const requiresClarification = Boolean(value.requiresClarification);
  return {
    facts: stringArray(value.facts),
    originalTerms: stringArray(value.originalTerms),
    normalizedTerms: stringArray(value.normalizedTerms),
    ruleCategories: stringArray(value.ruleCategories),
    expandedQuery: typeof value.expandedQuery === "string" ? value.expandedQuery.trim() : "",
    confidence,
    requiresClarification,
    clarifyingQuestion: typeof value.clarifyingQuestion === "string" && value.clarifyingQuestion.trim() ? value.clarifyingQuestion.trim() : null,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}
