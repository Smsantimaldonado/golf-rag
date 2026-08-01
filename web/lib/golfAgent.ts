import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { interpretUserSituation, type InterpretedSituation } from "./situationInterpreter";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_ANSWER_MODEL = "gpt-5-mini";
const DEFAULT_TOP_K = 8;
const MAX_CONVERSATION_USER_MESSAGES = 3;

const ruleReferenceRe = /\b(?:Regla\s+)?(\d{1,2}\.\d{1,2}[a-z]?)\b/gi;
const specialModificationRe = /\b(?:discapacidad|discapacidades|movilidad|ruedas|silla)\b/i;
const penaltyAreaRe =
  /\b(?:area de penalizacion|area penalizacion|penalizacion roja|penalizacion amarilla|estaca roja|estacas rojas|estaca amarilla|estacas amarillas|agua|lago|arroyo|zanja)\b/i;
const strokeDistanceRe = /\b(?:golpe y distancia|perdida|perdido|fuera de limites|repetir|golpe anterior|provisional)\b/i;
const lostBallRe =
  /\b(?:no la encuentro|no encuentro mi bola|no encuentro la bola|no aparece|buscar tres minutos|busque tres minutos|busqué tres minutos|bola perdida|perdida|perdido)\b/i;
const inspectionRe = /\b(?:verificar|comprobar|identificar|levantar|no estoy seguro|duda|revisar)\b/i;
const replaceRe = /\b(?:reponer|repuesta|reponerla|colocar|colocarla|marcar|marcada|movida|se movio|se movió)\b/i;
const noPlayZoneRe = /\b(?:zona de juego prohibida|zona prohibida|prohibido jugar|prohibida jugar|no play zone)\b/i;
const interruptionRe = /\b(?:interrump|suspend|reanudar|suspension|suspensión)\b/i;
const naturalForcesRe = /\b(?:viento|gravedad|fuerzas naturales|se movio sola|se movió sola)\b/i;
const bunkerRe = /\b(?:bunker|búnker|arena)\b/i;
const worsenedConditionsRe = /\b(?:empeorad|despues|después|otra persona|animal|alguien|dañad|danad|huella|pisada)\b/i;

const ballCollisionRe = /\b(?:pelota|bola)[\s\S]{0,140}\b(?:desviad\w*|detenid\w*|golpead\w*|choc\w*)\b|\b(?:desviad\w*|detenid\w*|golpead\w*|choc\w*)\b[\s\S]{0,140}\b(?:pelota|bola)\b/i;

const queryExpansions: Array<[RegExp, string]> = [
  [
    /\baspersor(?:es)?\b/i,
    "obstrucción inamovible condición anormal del campo Regla 16.1 punto más cercano de alivio total alivio sin penalización",
  ],
  [
    /\b(?:rastrillo|rastrillos|manguera|mangueras|botella|botellas|toalla|toallas)\b/i,
    "obstrucción movible Regla 15.2 alivio sin penalización quitar obstrucción movible",
  ],
  [
    /\b(?:arbol|arboles|arbusto|arbustos|planta|plantas|rama|ramas)\b/i,
    "objeto natural fijo en crecimiento condición normal del campo jugar como reposa Regla 8.1a bola injugable Regla 19.1 Regla 19.2 Regla 19.2a Regla 19.2b Regla 19.2c alivio con penalización",
  ],
  [
    /\b(?:hueco|pozo|depresion|depresiones|lie malo|mal lie|enterrada|enterrado|injugable)\b/i,
    "jugar como reposa Regla 8.1a bola injugable Regla 19.1 Regla 19.2 Regla 19.2a Regla 19.2b Regla 19.2c golpe y distancia línea hacia atrás alivio lateral dos palos un golpe de penalización",
  ],
  [
    /\bbola equivocada\b/i,
    "Regla 6.3c bola equivocada juego por golpes penalización general dos golpes corregir error",
  ],
  [
    lostBallRe,
    "bola perdida Regla 18.2 golpe y distancia volver al lugar del golpe anterior un golpe de penalización bola provisional Regla 18.3 antes de ir a buscar",
  ],
  [
    ballCollisionRe,
    "colision accidental entre pelotas Regla 9.6 pelota en reposo movida por otra pelota en movimiento reponer sin penalidad Regla 11.1 pelota en movimiento desviada accidentalmente jugar como reposa excepcion juego por golpes pelota jugada desde green golpea pelota en reposo green",
  ],
];

const systemPrompt = `Sos un asistente experto en Reglas de Golf.

Restricciones obligatorias:
- Responde solo con la evidencia documental provista en CONTEXTO.
- No uses conocimiento externo ni memoria general del modelo.
- Si el contexto no alcanza para decidir, decí que no se puede responder claramente e intente reformular la consulta.
- Citá siempre número de regla cuando exista.
- Si hay incertidumbre factual, indicala explícitamente.
- No inventes reglas, penalizaciones, procedimientos ni excepciones.
- Da primero la regla general aplicable. Mencioná excepciones o modificaciones especiales solo si el usuario las pregunta o si son necesarias para evitar una respuesta engañosa.
- Aunque el CONTEXTO recuperado incluya excepciones, no las menciones si dependen de hechos que el usuario no planteó. La existencia de una excepción en la regla no la vuelve relevante por sí sola.
- No menciones modificaciones para jugadores con discapacidades o dispositivos de movilidad salvo que el usuario lo indique o pregunte por eso.
- Si recuperás reglas tangenciales, no las cites salvo que sostengan directamente la decisión.
- No agregues consejos laterales sobre reglas de mejorar condiciones, mover objetos, práctica, reglas locales u otras materias si el usuario no preguntó por eso y no son necesarias para reanudar el juego.
- No le pidas al usuario que facilite texto de reglas o documentos. Tu única fuente documental es el CONTEXTO recuperado.
- No hagas remisiones vacías como "tome alivio según la Regla 19" sin explicar qué debe hacer el jugador. Si mencionás una regla de alivio, resumí las opciones operativas disponibles en el CONTEXTO: dónde dropear/jugar, cuántas longitudes de palo corresponden y cuántos golpes de penalización tiene cada opción.
- No uses frases como "proceda según la Regla X", "ver Regla X" o "continúe bajo la Regla X" como reemplazo de la decisión. Siempre explicá directamente qué debe hacer el jugador: desde dónde jugar, si debe dropear o repetir el golpe, cómo medir el área de alivio cuando corresponda y cuántos golpes de penalización tiene.
- Si el CONTEXTO menciona una regla aplicable pero no trae toda la mecánica operativa, da la parte operativa que sí esté sustentada y decí brevemente qué detalle no queda cubierto.
- En la sección "Decisión", respondé como indicación práctica para reanudar el juego. Si hay alternativas de alivio, enumeralas con regla, penalidad y medida básica. Ejemplo: golpe y distancia; línea hacia atrás; alivio lateral de dos palos.
- En consultas de lie malo, hueco, árbol o bola injugable, mencioná primero la opción de jugar la bola como reposa sin penalidad cuando el CONTEXTO la sostenga, y luego las alternativas de alivio con penalidad.
- No generalices "jugar como reposa" cuando el usuario pregunta por alivio de una condición anormal u obstrucción inamovible que interfiere directamente con el lie, stance o swing, como una bola sobre un aspersor fijo. En esos casos, no presentes "jugar como reposa" como opción; la decisión debe indicar el alivio sin penalidad si el CONTEXTO lo sostiene.
- Si una regla específica de alivio aplica a la situación, esa regla desplaza la regla general de jugar la bola como reposa. Si el CONTEXTO también trae una regla general sobre jugar desde lugar equivocado, tratala solo como contexto de penalidad por jugar desde un lugar incorrecto, no como fundamento para negar el alivio específico.
- En la sección "Explicación", justificá esas opciones con la regla citada, sin repetir toda la mecánica si ya quedó clara en "Decisión".
- Solo citar reglas de marcar, levantar, reponer o colocar la bola solo cuando el usuario pregunte por ese procedimiento o que sean necesarias para la decisión principal. Para una consulta de alivio/injugable, enfocá la respuesta en opciones de alivio, penalidad y área de alivio.
- En "Incertidumbre", mencioná solo datos faltantes necesarios para decidir la consulta. Si la decisión está suficientemente cubierta, escribí "No se advierte incertidumbre relevante con la información provista."
- Si escribís "No se advierte incertidumbre relevante con la información provista.", no agregues ninguna otra frase en ese apartado.
- No uses "Incertidumbre" para sugerir nuevas consultas, pedir más datos no necesarios o listar escenarios especiales no mencionados.
- Si el usuario pregunta una penalización o procedimiento puntual y el CONTEXTO alcanza para responderlo, no uses "Incertidumbre" para pedir datos que solo afectarían consecuencias posteriores o casos derivados. Esos datos pueden mencionarse condicionalmente en "Decisión" o "Explicación" si son necesarios.
- La respuesta debe terminar al finalizar el contenido de "Incertidumbre". No agregues frases finales como "si facilita datos..." o invitaciones a continuar.

Presunciones operativas para evitar sobre-incertidumbre:
- No conviertas excepciones no mencionadas en incertidumbre. Si el usuario no menciona agua, agua temporal, bola moviéndose en agua, bunker, área de penalización, fuera de límites, green, condición anormal, regla local o modalidad especial, no agregues esas posibilidades en "Incertidumbre".
- Tampoco menciones esas excepciones como "aclaración" o "salvedad" si no fueron mencionadas por el usuario y no son necesarias para contestar la pregunta.
- No menciones la excepción de bola equivocada moviéndose en agua o agua temporal salvo que el usuario haya dicho que la bola estaba moviéndose en agua, agua temporal o un área de penalización.
- Si el usuario no menciona área de penalización, no incluyas una opción adicional del tipo "si estuviera en un área de penalización..." ni cites la Regla 17 como salvedad.
- No cites reglas de zona de juego prohibida o alivio obligatorio por zona prohibida salvo que el usuario mencione expresamente una zona de juego prohibida, una zona prohibida o que está prohibido jugar desde ahí.
- Si el usuario no dice que la bola está en bunker, área de penalización, green u otra área especial, asumí que está en el área general.
- Si el usuario no dice que existe una condición anormal del campo, interferencia, obstrucción, agua temporal, terreno en reparación o animal peligroso, asumí una condición normal del juego.
- Tratá objetos comunes con sentido golfístico: un rastrillo, botella, toalla o manguera suelta suelen ser obstrucciones movibles; un aspersor, camino artificial, drenaje o tapa fija suelen ser obstrucciones inamovibles; árboles, arbustos, plantas y ramas que crecen forman parte natural del campo y no son obstrucciones.
- Si una palabra común tiene una categoría evidente en golf, usala. Por ejemplo, "aspersor" implica obstrucción inamovible salvo que el usuario diga que está suelto o movible; "árbol" implica objeto natural/condición normal del campo salvo que el usuario diga que es una estaca, tutor artificial u objeto artificial.
- Si el usuario dice que la bola "queda en", "está en", "reposa en", "queda sobre", "está sobre", "reposa sobre", "queda pegada a" o "está pegada a" un objeto, asumí que ese objeto interfiere con el lie/reposo de la bola. No trates ese caso como mera interferencia con la línea de juego salvo que el usuario lo diga.
- Solo declarás incertidumbre cuando un dato cambia materialmente la decisión principal, no cuando solo existe una excepción remota no mencionada.
- No uses "Incertidumbre" para repetir las presunciones operativas aplicadas. Si aplicaste una presunción normal y la decisión queda cubierta, escribí simplemente que no hay incertidumbre relevante.
- Si la consulta pide la penalización por bola equivocada en juego por golpes y el CONTEXTO trae la Regla 6.3c, la penalización queda cubierta: no pidas datos sobre agua, titularidad de la bola, momento exacto del descubrimiento o corrección salvo que el usuario pregunte por descalificación o por cómo corregir después de otro golpe.

Mini conversación:
- Puede haber hasta 3 mensajes del usuario sobre un mismo caso. Usá esos mensajes solo para reconstruir los hechos y la intención de la consulta, nunca como fuente de reglas.
- El formato obligatorio con secciones "Decisión", "Explicación", "Regla citada" e "Incertidumbre" aplica solo al primer mensaje del usuario. Si la consulta indica "TIPO DE RESPUESTA: seguimiento", respondé directamente lo que el usuario pide en esa continuación, sin forzar esas cuatro secciones, pero mantené la cita de regla y la explicación suficiente para que la respuesta no quede incompleta.
- Si el usuario agrega información, integrala al caso antes de decidir.
- Si el usuario corrige o contradice algo anterior, priorizá el dato más reciente.
- Si el usuario dice que la respuesta anterior no le satisface, revisá si faltó una decisión práctica, penalidad, medida de alivio o regla citada, pero seguí respondiendo solo con el CONTEXTO.

Formato obligatorio:
Decisión:
Explicación:
Regla citada:
Incertidumbre:`;

type MatchRow = {
  id: string;
  content: string;
  source: string | null;
  page_start: number | null;
  page_end: number | null;
  heading: string | null;
  rule_number: string | null;
  chunk_type: string | null;
  has_visual_context: boolean;
  visual_assets: unknown;
  metadata: Record<string, unknown> | null;
  distance: number;
};

type RetrievedChunk = {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  distance: number;
};

type SupabaseResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type PerfStage = "total" | "interpretation" | "embedding" | "supabase_match" | "supabase_expand" | "final_answer";

export type PerfMetric = {
  stage: PerfStage;
  durationMs: number;
};

type AnswerGolfQuestionOptions = {
  topK?: number;
  requestId?: string;
  onMetric?: (metric: PerfMetric) => void;
};

type ResolvedAnswerGolfQuestionOptions = AnswerGolfQuestionOptions & {
  topK: number;
};

export async function answerGolfQuestion(userMessages: string[], options: number | AnswerGolfQuestionOptions = {}) {
  const resolvedOptions = normalizeOptions(options);
  const totalStartedAt = now();
  logStageStart("total", resolvedOptions, { messageCount: userMessages.length, topK: resolvedOptions.topK });

  const openai = new OpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") });
  try {
    const interpretation = await measureStage("interpretation", resolvedOptions, () => interpretUserSituation(openai, userMessages));

    if (interpretation.requiresClarification && interpretation.confidence === "baja" && interpretation.clarifyingQuestion) {
      emitMetric("total", totalStartedAt, resolvedOptions, { clarified: true });
      return {
        answer: interpretation.clarifyingQuestion,
        citations: [],
        interpretation,
      };
    }

    const question = buildConversationQuestion(userMessages, interpretation);
    const chunks = await retrieve(question, openai, resolvedOptions.topK, resolvedOptions);
    const context = formatContext(chunks);
    const answer = await measureStage("final_answer", resolvedOptions, () => generateAnswer(openai, question, context, interpretation), {
      contextChunks: chunks.length,
      model: process.env.OPENAI_ANSWER_MODEL || DEFAULT_ANSWER_MODEL,
    });

    emitMetric("total", totalStartedAt, resolvedOptions, { contextChunks: chunks.length });
    return {
      answer,
      citations: chunks.map((chunk) => ({
        id: chunk.id,
        rule: chunk.metadata.rule_number || null,
        heading: chunk.metadata.heading || null,
        source: chunk.metadata.source || null,
        pageStart: chunk.metadata.page_start || null,
        pageEnd: chunk.metadata.page_end || null,
        distance: chunk.distance,
      })),
      interpretation,
    };
  } catch (error) {
    logStageError("total", totalStartedAt, resolvedOptions, error);
    throw error;
  }
}

export function buildConversationQuestion(userMessages: string[], interpretation?: InterpretedSituation) {
  const cleanedMessages = userMessages.map((message) => message.trim()).filter(Boolean);
  if (cleanedMessages.length === 0) {
    throw new Error("Ingresá al menos un mensaje.");
  }
  if (cleanedMessages.length > MAX_CONVERSATION_USER_MESSAGES) {
    throw new Error(`La mini conversación admite hasta ${MAX_CONVERSATION_USER_MESSAGES} mensajes del usuario.`);
  }
  if (cleanedMessages.length === 1) {
    return appendInterpretation(["TIPO DE RESPUESTA: primera_respuesta", "", cleanedMessages[0]].join("\n"), interpretation);
  }

  const lines = [
    "TIPO DE RESPUESTA: seguimiento",
    "",
    "CASO EN MINI CONVERSACIÓN:",
    "Los siguientes mensajes pertenecen a un mismo caso. Usalos para consolidar los hechos antes de responder.",
    "Si hay contradicciones, priorizá el mensaje más reciente del usuario.",
    "",
  ];
  cleanedMessages.forEach((message, index) => {
    lines.push(`Mensaje ${index + 1} del usuario: ${message}`);
  });
  lines.push("", "Respondé la consulta considerando el caso completo y la última intervención del usuario.");
  return appendInterpretation(lines.join("\n"), interpretation);
}

async function retrieve(question: string, openai: OpenAI, topK: number, options: AnswerGolfQuestionOptions) {
  const retrievalQuery = buildRetrievalQuery(question);
  const normalizedQuestion = stripAccents(question);
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const embedding = (
    await measureStage("embedding", options, () => openai.embeddings.create({ model: embeddingModel, input: retrievalQuery }), {
      model: embeddingModel,
      inputLength: retrievalQuery.length,
    })
  ).data[0].embedding;
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const excludeRulePrefixes = excludedRulePrefixes(normalizedQuestion);

  const { data, error } = (await measureStage(
    "supabase_match",
    options,
    () =>
      supabase.rpc("match_golf_rule_chunks", {
        query_embedding: embedding,
        match_count: topK,
        exclude_rule_prefixes: excludeRulePrefixes,
      }),
    { matchCount: topK, excludedPrefixes: excludeRulePrefixes.join(",") },
  )) as SupabaseResult<MatchRow[]>;

  if (error) {
    throw new Error(`Supabase retrieval failed: ${error.message}`);
  }

  const chunks = (data || []).map(rowToChunk);
  const filteredChunks = filterTangentialChunks(chunks, normalizedQuestion);
  const expanded = await measureStage("supabase_expand", options, () => expandRuleReferences(supabase, retrievalQuery, filteredChunks), {
    initialChunks: filteredChunks.length,
  });
  return prioritizeReferencedRules(expanded, retrievalQuery);
}

function rowToChunk(row: MatchRow): RetrievedChunk {
  return {
    id: row.id,
    text: row.content,
    metadata: {
      ...(row.metadata || {}),
      source: row.source || "",
      page_start: row.page_start || "",
      page_end: row.page_end || "",
      heading: row.heading || "",
      rule_number: row.rule_number || "",
      chunk_type: row.chunk_type || "",
      has_visual_context: row.has_visual_context,
      visual_assets: row.visual_assets,
    },
    distance: row.distance,
  };
}

async function expandRuleReferences(
  supabase: SupabaseClient,
  question: string,
  chunks: RetrievedChunk[],
  maxExtra = 8,
) {
  const seenIds = new Set(chunks.map((chunk) => chunk.id));
  const expanded = [...chunks];

  // A vector hit often contains only the eligibility half of a rule. Before
  // adding unrelated cross-references, close the local rule family when that
  // hit explicitly points to a sibling subsection. This keeps the procedure
  // that completes the decision (for example, 16.3a -> 16.3b) in context.
  const targets = collectEvidenceTargets(question, chunks);
  const [familyRows, referenceRows] = await Promise.all([
    fetchRuleFamilies(supabase, targets.families),
    fetchRuleReferences(supabase, targets.references),
  ]);

  for (const row of [...familyRows, ...referenceRows]) {
    if (expanded.length >= chunks.length + maxExtra || seenIds.has(row.id)) {
      continue;
    }
    expanded.push(rowToChunk({ ...row, distance: 1 }));
    seenIds.add(row.id);
  }

  return filterTangentialChunks(expanded, stripAccents(question));
}

type EvidenceTargets = {
  families: string[];
  references: string[];
};

function collectEvidenceTargets(question: string, chunks: RetrievedChunk[]): EvidenceTargets {
  const families: string[] = [];
  const references = extractRuleReferences(question).filter((reference) => !reference.startsWith("25.") || specialModificationRe.test(question));

  for (const chunk of [...chunks].sort((left, right) => left.distance - right.distance)) {
    const sourceRule = String(chunk.metadata.rule_number || "");
    const sourceFamily = ruleFamily(sourceRule);

    for (const reference of extractRuleReferences(chunk.text)) {
      if (reference.startsWith("25.") && !specialModificationRe.test(question)) {
        continue;
      }
      if (sourceFamily && ruleFamily(reference) === sourceFamily) {
        appendUniqueValue(families, sourceFamily);
      } else {
        appendUniqueValue(references, reference);
      }
    }
  }

  // Keep context bounded. Families are fetched first because they supply the
  // directly dependent procedural text; the remaining capacity is available
  // for cross-rule references.
  return { families: families.slice(0, 3), references: references.slice(0, 8) };
}

function ruleFamily(ruleNumber: string) {
  const match = /^(\d{1,2}\.\d{1,2})/.exec(ruleNumber);
  return match?.[1] || null;
}

function appendUniqueValue(values: string[], value: string) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

async function fetchRuleFamilies(supabase: SupabaseClient, families: string[]) {
  if (families.length === 0) {
    return [] as Omit<MatchRow, "distance">[];
  }
  const filters = families.flatMap((family) => [`rule_number.eq.${family}`, `rule_number.like.${family}.%`]).join(",");
  const { data, error } = await supabase
    .from("golf_rule_chunks")
    .select("id, content, source, page_start, page_end, heading, rule_number, chunk_type, has_visual_context, visual_assets, metadata")
    .or(filters);
  return error || !data ? [] : (data as Omit<MatchRow, "distance">[]);
}

async function fetchRuleReferences(supabase: SupabaseClient, references: string[]) {
  if (references.length === 0) {
    return [] as Omit<MatchRow, "distance">[];
  }
  const { data, error } = await supabase
    .from("golf_rule_chunks")
    .select("id, content, source, page_start, page_end, heading, rule_number, chunk_type, has_visual_context, visual_assets, metadata")
    .in("rule_number", references);
  return error || !data ? [] : (data as Omit<MatchRow, "distance">[]);
}

function buildRetrievalQuery(question: string) {
  const normalizedQuestion = stripAccents(question);
  const additions = queryExpansions.flatMap(([pattern, expansion]) => (pattern.test(normalizedQuestion) ? [expansion] : []));
  if (additions.length === 0) {
    return question;
  }
  return `${question}\n\nTerminos de recuperacion: ${additions.join(" ")}`;
}

function filterTangentialChunks(chunks: RetrievedChunk[], normalizedQuestion: string) {
  return chunks.filter((chunk) => {
    const ruleNumber = String(chunk.metadata.rule_number || "");
    if (excludedRulePrefixes(normalizedQuestion).some((prefix) => ruleNumber.startsWith(prefix))) return false;
    if (!strokeDistanceRe.test(normalizedQuestion) && !lostBallRe.test(normalizedQuestion) && ruleNumber === "18.1") return false;
    if (!inspectionRe.test(normalizedQuestion) && ruleNumber === "16.4") return false;
    if (!noPlayZoneRe.test(normalizedQuestion) && ruleNumber === "16.1f") return false;
    if (!naturalForcesRe.test(normalizedQuestion) && ruleNumber === "9.3") return false;
    if (!worsenedConditionsRe.test(normalizedQuestion) && ruleNumber === "8.1d") return false;
    return true;
  });
}

function excludedRulePrefixes(normalizedQuestion: string) {
  const prefixes: string[] = [];
  if (!specialModificationRe.test(normalizedQuestion)) prefixes.push("25.");
  if (!penaltyAreaRe.test(normalizedQuestion)) prefixes.push("17.");
  if (!replaceRe.test(normalizedQuestion)) prefixes.push("14.1", "14.2");
  if (!interruptionRe.test(normalizedQuestion)) prefixes.push("5.7");
  if (!bunkerRe.test(normalizedQuestion)) prefixes.push("12.", "19.3");
  return prefixes;
}

function extractRuleReferences(text: string) {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ruleReferenceRe)) {
    const ruleNumber = match[1];
    if (!seen.has(ruleNumber)) {
      references.push(ruleNumber);
      seen.add(ruleNumber);
    }
  }
  return references;
}

function prioritizeReferencedRules(chunks: RetrievedChunk[], query: string) {
  const references = extractRuleReferences(query);
  if (references.length === 0) {
    return chunks;
  }
  return [...chunks].sort((left, right) => {
    const leftIndex = references.indexOf(String(left.metadata.rule_number || ""));
    const rightIndex = references.indexOf(String(right.metadata.rule_number || ""));
    if (leftIndex === -1 && rightIndex === -1) return left.distance - right.distance;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

async function generateAnswer(openai: OpenAI, question: string, context: string, interpretation: InterpretedSituation) {
  const answerModel = process.env.OPENAI_ANSWER_MODEL || DEFAULT_ANSWER_MODEL;
  const situationInstructions = buildSituationInstructions(question);
  const prompt = `${systemPrompt}\n\nInstrucciones prioritarias para esta consulta:\n${situationInstructions}`;
  const response = await openai.responses.create({
    model: answerModel,
    input: [
      { role: "system", content: [{ type: "input_text", text: prompt }] },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `CONSULTA:\n${question}\n\nINTERPRETACIÓN SEMÁNTICA:\n${formatInterpretation(interpretation)}\n\nCONTEXTO:\n${context}`,
          },
        ],
      },
    ],
  });
  return response.output_text.trim();
}

function appendInterpretation(question: string, interpretation?: InterpretedSituation) {
  if (!interpretation || !interpretation.expandedQuery) {
    return question;
  }
  return `${question}\n\nInterpretación semántica para búsqueda:\n${formatInterpretation(interpretation)}`;
}

function buildSituationInstructions(question: string) {
  const normalizedQuestion = stripAccents(question).toLowerCase();
  const playerBallFall = /\b(?:el|la|un|una|mi|su)?\s*jugador(?:a)?\s+(?:se\s+)?(?:cae|caia|cayo|ha\s+caido|habia\s+caido|va\s+a\s+caer|caera|termino\s+cayendo)\b/.test(normalizedQuestion);
  const explicitPhysicalFall = /\b(?:cuerpo|fisic(?:amente|o|a)|lastim\w*|lesion\w*|tropez\w*|resbal\w*)\b/.test(normalizedQuestion);
  const sprinklerOrImmovable = /\b(?:aspersor|obstruccion inamovible|camino artificial|drenaje|tapa fija)\b/.test(normalizedQuestion);
  const directInterference = /\b(?:stance|swing|reposo|lie|sobre|encima|molesta|interfiere|interferencia|pegada|pegado)\b/.test(normalizedQuestion);
  const firstBallAtRestCollision = /primera pelota se presume en reposo antes del impacto/.test(normalizedQuestion);
  const instructions: string[] = [];
  if (playerBallFall && !explicitPhysicalFall) {
    instructions.push(
      "En esta consulta, 'el jugador cae/cayo' significa que la pelota del jugador cayo o entro en el lugar indicado.",
      "No pidas una aclaracion sobre una caida fisica; aplica las reglas de la pelota en ese lugar.",
    );
  }
  if (firstBallAtRestCollision) {
    instructions.push(
      "La primera pelota estaba en reposo antes del impacto y fue movida por la segunda, que estaba en movimiento; no pidas aclaracion sobre ese hecho.",
      "Analiza cada pelota por separado y cita las Reglas 9.6 y 11.1 solo si el CONTEXTO recuperado las respalda.",
      "Solo analiza la excepcion de la Regla 11.1a si la consulta afirma que ambas pelotas estaban en el green antes del golpe y que se juega por golpes.",
    );
  }
  if (sprinklerOrImmovable && directInterference) {
    instructions.push(
      "La consulta describe una obstrucción inamovible con interferencia directa.",
      "No presentes 'jugar como reposa' como opción y no cites la Regla 14.7 como permiso para jugar la bola donde quedó.",
      "La Regla 14.7 trata jugar desde lugar equivocado, no desplaza el alivio específico.",
      "No trates el aspersor como zona de juego prohibida ni cites la Regla 16.1f salvo que el usuario mencione expresamente una zona prohibida.",
      "Respondé con el alivio sin penalidad de la Regla 16.1/16.1b y el procedimiento práctico.",
    );
  }
  return instructions.length ? instructions.join(" ") : "No hay instrucciones específicas adicionales.";
}

function formatInterpretation(interpretation: InterpretedSituation) {
  return [
    interpretation.facts.length ? `Hechos: ${interpretation.facts.join("; ")}` : "",
    interpretation.originalTerms.length ? `Términos originales: ${interpretation.originalTerms.join(", ")}` : "",
    interpretation.normalizedTerms.length ? `Términos normalizados: ${interpretation.normalizedTerms.join(", ")}` : "",
    interpretation.ruleCategories.length ? `Categorías para búsqueda: ${interpretation.ruleCategories.join(", ")}` : "",
    interpretation.expandedQuery ? `Consulta expandida: ${interpretation.expandedQuery}` : "",
    `Confianza: ${interpretation.confidence}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatContext(chunks: RetrievedChunk[]) {
  return chunks
    .map((chunk, index) => {
      return [`[${index + 1}] ${formatCitation(chunk.metadata)}`, `chunk_id: ${chunk.id}`, `distancia: ${chunk.distance.toFixed(4)}`, "texto:", chunk.text].join(
        "\n",
      );
    })
    .join("\n\n");
}

function formatCitation(metadata: Record<string, unknown>) {
  const rule = metadata.rule_number || "sin regla detectada";
  const heading = metadata.heading || "";
  const source = metadata.source || "";
  const pageStart = metadata.page_start;
  const pageEnd = metadata.page_end;
  const pages = pageStart && pageEnd && pageStart !== pageEnd ? `pags. ${pageStart}-${pageEnd}` : pageStart ? `pag. ${pageStart}` : "página no disponible";
  return `Regla ${rule} | ${heading} | ${source} | ${pages}`;
}

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeOptions(options: number | AnswerGolfQuestionOptions): ResolvedAnswerGolfQuestionOptions {
  if (typeof options === "number") {
    return { topK: options };
  }
  return { ...options, topK: options.topK ?? DEFAULT_TOP_K };
}

async function measureStage<T>(
  stage: PerfStage,
  options: AnswerGolfQuestionOptions,
  work: () => PromiseLike<T> | T,
  detail: Record<string, string | number | boolean | null> = {},
) {
  const startedAt = now();
  logStageStart(stage, options, detail);
  try {
    const result = await work();
    emitMetric(stage, startedAt, options, detail);
    return result;
  } catch (error) {
    logStageError(stage, startedAt, options, error, detail);
    throw error;
  }
}

function logStageStart(stage: PerfStage, options: AnswerGolfQuestionOptions, detail: Record<string, string | number | boolean | null> = {}) {
  console.info("[golf-rag.perf] stage_start", compactLogObject({ requestId: options.requestId, stage, ...detail }));
}

function emitMetric(
  stage: PerfStage,
  startedAt: number,
  options: AnswerGolfQuestionOptions,
  detail: Record<string, string | number | boolean | null> = {},
) {
  const metric = { stage, durationMs: roundMs(now() - startedAt) };
  options.onMetric?.(metric);
  console.info("[golf-rag.perf] stage_end", compactLogObject({ requestId: options.requestId, ...metric, ...detail }));
  return metric;
}

function logStageError(
  stage: PerfStage,
  startedAt: number,
  options: AnswerGolfQuestionOptions,
  error: unknown,
  detail: Record<string, string | number | boolean | null> = {},
) {
  console.error(
    "[golf-rag.perf] stage_error",
    compactLogObject({
      requestId: options.requestId,
      stage,
      durationMs: roundMs(now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      ...detail,
    }),
  );
}

function compactLogObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
