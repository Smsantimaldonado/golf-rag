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

// Golf narration commonly uses "el jugador cayo en el bunker" as shorthand
// for the player's ball, rather than a literal fall by the person.
const playerBallFallRe = /\b(?:el|la|un|una|mi|su)?\s*jugador(?:a)?\s+(?:se\s+)?(?:cae|caia|cayo|ha\s+caido|habia\s+caido|va\s+a\s+caer|caera|termino\s+cayendo)\b/i;
const explicitPhysicalFallRe = /\b(?:cuerpo|fisic(?:amente|o|a)|lastim\w*|lesion\w*|tropez\w*|resbal\w*)\b/i;
const ballCollisionRe = /\b(?:desviad\w*|detenid\w*|golpead\w*|choc\w*)\b/i;
const otherPlayerBallRe = /\b(?:pelota|bola)(?:\s+del?|\s+de)?\s*(?:(?:un|una|el|la)\s+)?(?:otro|otra|segundo|segunda)\s+jugador(?:a)?\b/i;
const movingBallRe = /\b(?:en\s+movimiento|rodando|moviendose)\b/i;
const multipleMovingBallsRe = /\b(?:ambas|las\s+dos|ambos)\s+(?:pelotas|bolas)[\s\S]{0,60}\b(?:en\s+movimiento|rodando|moviendose)\b/i;
const firstBallExplicitlyMovingRe = /\b(?:pelota|bola)(?:\s+del?|\s+de)?\s*(?:(?:un|una|el|la)\s+)?(?:primer|primera)?\s*jugador(?:a)?[\s\S]{0,80}\b(?:en\s+movimiento|rodando|moviendose)\b[\s\S]{0,80}\b(?:desviad\w*|detenid\w*|golpead\w*|choc\w*)\b/i;

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
    const interpretation = normalizeInterpretation(JSON.parse(response.output_text));
    return applyBallCollisionConvention(applyGolfBallFallConvention(interpretation, messages), messages);
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
        "Convencion de lenguaje golfistico: si el usuario dice que el jugador cae o cayo en un lugar, o una variante equivalente, interpretalo como que la pelota del jugador cayo o entro en ese lugar. No pidas aclaracion sobre una caida corporal, salvo que el usuario mencione expresamente el cuerpo, una lesion o una caida fisica.",
        "Cuando una pelota de un primer jugador es desviada accidentalmente por la pelota de un segundo jugador en movimiento, presumi que la primera estaba en reposo antes del impacto, salvo que el usuario diga expresamente que tambien estaba en movimiento. Registra por separado: primera pelota movida por otra pelota en movimiento y segunda pelota en movimiento desviada accidentalmente. No pidas una aclaracion sobre si la primera estaba en reposo cuando se cumple esta descripcion.",
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

function applyGolfBallFallConvention(interpretation: InterpretedSituation, messages: string[]): InterpretedSituation {
  const caseText = messages.join("\n").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!playerBallFallRe.test(caseText) || explicitPhysicalFallRe.test(caseText)) {
    return interpretation;
  }

  const ballFact = "La expresion 'el jugador cae' se refiere a que la pelota del jugador cayo o entro en el lugar indicado.";
  const ballTerm = "pelota del jugador cayo o entro en el lugar indicado";
  return {
    ...interpretation,
    facts: appendUnique(interpretation.facts, ballFact),
    normalizedTerms: appendUnique(interpretation.normalizedTerms, ballTerm),
    // This convention resolves the ambiguity before the caller can stop to
    // ask an unnecessary clarification question.
    confidence: interpretation.confidence === "baja" ? "media" : interpretation.confidence,
    requiresClarification: false,
    clarifyingQuestion: null,
  };
}

function applyBallCollisionConvention(interpretation: InterpretedSituation, messages: string[]): InterpretedSituation {
  const caseText = messages.join("\n").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const describesCollision = ballCollisionRe.test(caseText) && otherPlayerBallRe.test(caseText) && movingBallRe.test(caseText);
  if (!describesCollision || multipleMovingBallsRe.test(caseText) || firstBallExplicitlyMovingRe.test(caseText)) {
    return interpretation;
  }

  const atRestFact = "La primera pelota se presume en reposo antes del impacto y fue movida por la segunda pelota en movimiento.";
  const movingFact = "La segunda pelota estaba en movimiento y fue desviada accidentalmente al impactar la primera pelota.";
  return {
    ...interpretation,
    facts: appendUnique(appendUnique(interpretation.facts, atRestFact), movingFact),
    normalizedTerms: appendUnique(
      appendUnique(interpretation.normalizedTerms, "Regla 9.6: pelota en reposo movida por otra pelota en movimiento"),
      "Regla 11.1: pelota en movimiento desviada accidentalmente",
    ),
    expandedQuery: appendQueryTerms(
      interpretation.expandedQuery,
      "colision accidental entre dos pelotas: primera pelota en reposo movida por segunda pelota en movimiento Regla 9.6 Regla 11.1",
    ),
    confidence: interpretation.confidence === "baja" ? "media" : interpretation.confidence,
    requiresClarification: false,
    clarifyingQuestion: null,
  };
}

function appendUnique(items: string[], item: string) {
  return items.includes(item) ? items : [...items, item];
}

function appendQueryTerms(query: string, terms: string) {
  return query.includes(terms) ? query : [query, terms].filter(Boolean).join(" ");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}
