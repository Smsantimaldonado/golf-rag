import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_ANSWER_MODEL = "gpt-5-mini";
const DEFAULT_TOP_K = 8;
const MAX_CONVERSATION_USER_MESSAGES = 3;

const ruleReferenceRe = /\b(?:Regla\s+)?(\d{1,2}\.\d{1,2}[a-z]?)\b/gi;
const specialModificationRe = /\b(?:discapacidad|discapacidades|movilidad|ruedas|silla)\b/i;
const penaltyAreaRe =
  /\b(?:area de penalizacion|area penalizacion|penalizacion roja|penalizacion amarilla|estaca roja|estacas rojas|estaca amarilla|estacas amarillas|agua|lago|arroyo|zanja)\b/i;
const strokeDistanceRe = /\b(?:golpe y distancia|perdida|perdido|fuera de limites|repetir|golpe anterior|provisional)\b/i;
const inspectionRe = /\b(?:verificar|comprobar|identificar|levantar|no estoy seguro|duda|revisar)\b/i;
const replaceRe = /\b(?:reponer|repuesta|reponerla|colocar|colocarla|marcar|marcada|movida|se movio|se movió)\b/i;
const interruptionRe = /\b(?:interrump|suspend|reanudar|suspension|suspensión)\b/i;
const naturalForcesRe = /\b(?:viento|gravedad|fuerzas naturales|se movio sola|se movió sola)\b/i;
const bunkerRe = /\b(?:bunker|búnker|arena)\b/i;
const worsenedConditionsRe = /\b(?:empeorad|despues|después|otra persona|animal|alguien|dañad|danad|huella|pisada)\b/i;

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
- No menciones modificaciones para jugadores con discapacidades o dispositivos de movilidad salvo que el usuario lo indique o pregunte por eso.
- Si recuperás reglas tangenciales, no las cites salvo que sostengan directamente la decisión.
- No le pidas al usuario que facilite texto de reglas o documentos. Tu única fuente documental es el CONTEXTO recuperado.
- No hagas remisiones vacías como "tome alivio según la Regla 19" sin explicar qué debe hacer el jugador. Si mencionás una regla de alivio, resumí las opciones operativas disponibles en el CONTEXTO: dónde dropear/jugar, cuántas longitudes de palo corresponden y cuántos golpes de penalización tiene cada opción.
- En la sección "Decisión", respondé como indicación práctica para reanudar el juego. Si hay alternativas de alivio, enumeralas con regla, penalidad y medida básica. Ejemplo: golpe y distancia; línea hacia atrás; alivio lateral de dos palos.
- En consultas de lie malo, hueco, árbol o bola injugable, mencioná primero la opción de jugar la bola como reposa sin penalidad cuando el CONTEXTO la sostenga, y luego las alternativas de alivio con penalidad.
- En la sección "Explicación", justificá esas opciones con la regla citada, sin repetir toda la mecánica si ya quedó clara en "Decisión".
- No cites reglas de marcar, levantar, reponer o colocar la bola salvo que el usuario pregunte por ese procedimiento o que sean necesarias para la decisión principal. Para una consulta de alivio/injugable, enfocá la respuesta en opciones de alivio, penalidad y área de alivio.
- En "Incertidumbre", mencioná solo datos faltantes necesarios para decidir la consulta. Si la decisión está suficientemente cubierta, escribí "No se advierte incertidumbre relevante con la información provista."
- Si escribís "No se advierte incertidumbre relevante con la información provista.", no agregues ninguna otra frase en ese apartado.
- No uses "Incertidumbre" para sugerir nuevas consultas, pedir más datos no necesarios o listar escenarios especiales no mencionados.

Presunciones operativas para evitar sobre-incertidumbre:
- No conviertas excepciones no mencionadas en incertidumbre. Si el usuario no menciona agua, agua temporal, bola moviéndose en agua, bunker, área de penalización, fuera de límites, green, condición anormal, regla local o modalidad especial, no agregues esas posibilidades en "Incertidumbre".
- Tampoco menciones esas excepciones como "aclaración" o "salvedad" si no fueron mencionadas por el usuario y no son necesarias para contestar la pregunta.
- Si el usuario no dice que la bola está en bunker, área de penalización, green u otra área especial, asumí que está en el área general.
- Si el usuario no dice que existe una condición anormal del campo, interferencia, obstrucción, agua temporal, terreno en reparación o animal peligroso, asumí una condición normal del juego.
- Tratá objetos comunes con sentido golfístico: un rastrillo, botella, toalla o manguera suelta suelen ser obstrucciones movibles; un aspersor, camino artificial, drenaje o tapa fija suelen ser obstrucciones inamovibles; árboles, arbustos, plantas y ramas que crecen forman parte natural del campo y no son obstrucciones.
- Si una palabra común tiene una categoría evidente en golf, usala. Por ejemplo, "aspersor" implica obstrucción inamovible salvo que el usuario diga que está suelto o movible; "árbol" implica objeto natural/condición normal del campo salvo que el usuario diga que es una estaca, tutor artificial u objeto artificial.
- Si el usuario dice que la bola "queda en", "está en", "reposa en", "queda sobre", "está sobre", "reposa sobre", "queda pegada a" o "está pegada a" un objeto, asumí que ese objeto interfiere con el lie/reposo de la bola. No trates ese caso como mera interferencia con la línea de juego salvo que el usuario lo diga.
- Solo declarás incertidumbre cuando un dato cambia materialmente la decisión principal, no cuando solo existe una excepción remota no mencionada.
- No uses "Incertidumbre" para repetir las presunciones operativas aplicadas. Si aplicaste una presunción normal y la decisión queda cubierta, escribí simplemente que no hay incertidumbre relevante.

Mini conversación:
- Puede haber hasta 3 mensajes del usuario sobre un mismo caso. Usá esos mensajes solo para reconstruir los hechos y la intención de la consulta, nunca como fuente de reglas.
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

export async function answerGolfQuestion(userMessages: string[], topK = DEFAULT_TOP_K) {
  const question = buildConversationQuestion(userMessages);
  const openai = new OpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") });
  const chunks = await retrieve(question, openai, topK);
  const context = formatContext(chunks);
  const answer = await generateAnswer(openai, question, context);

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
  };
}

export function buildConversationQuestion(userMessages: string[]) {
  const cleanedMessages = userMessages.map((message) => message.trim()).filter(Boolean);
  if (cleanedMessages.length === 0) {
    throw new Error("Ingresá al menos un mensaje.");
  }
  if (cleanedMessages.length > MAX_CONVERSATION_USER_MESSAGES) {
    throw new Error(`La mini conversación admite hasta ${MAX_CONVERSATION_USER_MESSAGES} mensajes del usuario.`);
  }
  if (cleanedMessages.length === 1) {
    return cleanedMessages[0];
  }

  const lines = [
    "CASO EN MINI CONVERSACIÓN:",
    "Los siguientes mensajes pertenecen a un mismo caso. Usalos para consolidar los hechos antes de responder.",
    "Si hay contradicciones, priorizá el mensaje más reciente del usuario.",
    "",
  ];
  cleanedMessages.forEach((message, index) => {
    lines.push(`Mensaje ${index + 1} del usuario: ${message}`);
  });
  lines.push("", "Respondé la consulta considerando el caso completo y la última intervención del usuario.");
  return lines.join("\n");
}

async function retrieve(question: string, openai: OpenAI, topK: number) {
  const retrievalQuery = buildRetrievalQuery(question);
  const normalizedQuestion = stripAccents(question);
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const embedding = (await openai.embeddings.create({ model: embeddingModel, input: retrievalQuery })).data[0].embedding;
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("match_golf_rule_chunks", {
    query_embedding: embedding,
    match_count: topK,
    exclude_rule_prefixes: excludedRulePrefixes(normalizedQuestion),
  });

  if (error) {
    throw new Error(`Supabase retrieval failed: ${error.message}`);
  }

  const chunks = (data as MatchRow[]).map(rowToChunk);
  const expanded = await expandRuleReferences(supabase, retrievalQuery, filterTangentialChunks(chunks, normalizedQuestion));
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
  supabase: ReturnType<typeof createClient>,
  question: string,
  chunks: RetrievedChunk[],
  maxExtra = 8,
) {
  const seenIds = new Set(chunks.map((chunk) => chunk.id));
  const references = extractRuleReferences(`${question}\n${chunks.map((chunk) => chunk.text).join("\n")}`);
  const expanded = [...chunks];

  for (const ruleNumber of references) {
    if (expanded.length >= chunks.length + maxExtra) {
      break;
    }
    if (ruleNumber.startsWith("25.") && !specialModificationRe.test(question)) {
      continue;
    }

    const { data, error } = await supabase
      .from("golf_rule_chunks")
      .select("id, content, source, page_start, page_end, heading, rule_number, chunk_type, has_visual_context, visual_assets, metadata")
      .eq("rule_number", ruleNumber)
      .limit(1);

    if (error || !data?.length || seenIds.has(data[0].id)) {
      continue;
    }
    expanded.push(rowToChunk({ ...(data[0] as Omit<MatchRow, "distance">), distance: 1 }));
    seenIds.add(data[0].id);
  }

  return filterTangentialChunks(expanded, stripAccents(question));
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
    if (!strokeDistanceRe.test(normalizedQuestion) && ruleNumber === "18.1") return false;
    if (!inspectionRe.test(normalizedQuestion) && ruleNumber === "16.4") return false;
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

async function generateAnswer(openai: OpenAI, question: string, context: string) {
  const answerModel = process.env.OPENAI_ANSWER_MODEL || DEFAULT_ANSWER_MODEL;
  const response = await openai.responses.create({
    model: answerModel,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
      {
        role: "user",
        content: [{ type: "input_text", text: `CONSULTA:\n${question}\n\nCONTEXTO:\n${context}` }],
      },
    ],
  });
  return response.output_text.trim();
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

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
