# Golden Set De Pruebas Textuales

Este set sirve para validar manualmente el MVP textual antes y después de cada cambio relevante. Las respuestas pueden variar en redacción, pero deben cumplir los criterios esperados.

## Cómo Usarlo

1. Correr la WebApp local o usar la URL deployada.
2. Enviar cada caso como una consulta nueva, salvo los casos marcados como mini conversación.
3. Confirmar que la respuesta cite reglas, sea operativa y no agregue excepciones no planteadas.
4. Registrar cualquier fallo repetible antes de ajustar prompt, recuperación o normalización semántica.

## Casos

### 1. Bola equivocada en juego por golpes

Consulta:

```text
Jugué una bola equivocada en juego por golpes. ¿Qué penalización tengo?
```

Criterios esperados:

- Debe citar Regla 6.3c.
- Debe indicar penalización general de dos golpes en juego por golpes.
- Debe explicar que el error debe corregirse jugando la bola correcta.
- No debe mencionar agua, área de penalización ni excepciones no planteadas.

### 2. Bola no encontrada

Consulta:

```text
Pegué la bola, la vi caer en el medio del fairway y cuando llegué no la encuentro. ¿Cómo sigo?
```

Criterios esperados:

- Debe explicar la búsqueda de tres minutos.
- Si no se encuentra e identifica dentro de ese plazo, debe tratarla como bola perdida.
- Debe indicar volver al lugar del golpe anterior y jugar otra bola con un golpe de penalización bajo golpe y distancia.
- No debe quedarse en "proceda según la Regla 18" sin decir cómo seguir.

### 3. Bola injugable en zona general

Consulta:

```text
Mi bola quedó en un hueco y quiero sacarla para mejorar el lie. ¿Qué puedo hacer?
```

Criterios esperados:

- Debe mencionar jugar como reposa sin penalidad si el jugador no declara injugable.
- Debe citar Regla 19.2 y sus opciones cuando el jugador declara la bola injugable.
- Debe incluir golpe y distancia, línea hacia atrás y alivio lateral.
- Debe indicar penalidad y medidas básicas, incluyendo un palo para línea hacia atrás y dos palos para alivio lateral cuando el contexto lo sostenga.

### 4. Bola injugable dentro de bunker

Consulta:

```text
Mi bola está injugable dentro de un bunker. ¿Puedo dropear fuera?
```

Criterios esperados:

- Debe distinguir opciones normales de bola injugable dentro del bunker.
- Debe indicar cuándo las opciones mantienen el alivio dentro del bunker con un golpe de penalización.
- Debe mencionar la opción de alivio fuera del bunker con dos golpes de penalización si el contexto recuperado la sostiene.
- No debe tratarlo como zona general.

### 5. Aspersor fijo

Consulta:

```text
Mi bola quedó sobre un aspersor fijo en el fairway y me molesta el stance. ¿Qué hago?
```

Criterios esperados:

- Debe interpretar el aspersor fijo como obstrucción inamovible o condición anormal del campo.
- Debe priorizar alivio sin penalidad si hay interferencia con lie, stance o swing.
- No debe presentar "jugar como reposa" como la decisión principal.
- No debe usar Regla 14.7 como fundamento para negar el alivio específico.

### 6. Boca de riego fija

Consulta:

```text
Mi bola quedó sobre una boca de riego fija en el fairway y me molesta el stance. ¿Qué hago?
```

Criterios esperados:

- Debe emparentar "boca de riego fija" con una instalación fija de riego, aspersor u obstrucción inamovible.
- Debe recuperar y aplicar la regla de alivio sin penalidad si el contexto lo sostiene.
- Si el término le resulta ambiguo, debe pedir una aclaración breve antes de decidir.
- No debe depender de una frase hardcodeada exacta.

### 7. Árbol

Consulta:

```text
Mi bola queda pegada a un árbol. ¿Cómo la juego y qué liberaciones tengo?
```

Criterios esperados:

- Debe tratar el árbol como parte natural del campo, no como obstrucción movible o inamovible.
- Debe indicar jugar como reposa sin penalidad o declarar bola injugable.
- Si menciona bola injugable, debe explicar opciones operativas de Regla 19.2.
- No debe agregar área de penalización o bunker si el usuario no lo planteó.

### 8. Mini conversación

Mensajes del usuario:

```text
Mensaje 1: Mi bola quedó injugable debajo de un arbusto. ¿Qué puedo hacer?
Mensaje 2: Estoy en juego por golpes y no está en bunker.
Mensaje 3: Quiero saber específicamente si puedo ir hacia el costado.
```

Criterios esperados:

- La primera respuesta debe usar el formato obligatorio.
- La respuesta al segundo o tercer mensaje debe responder directo, sin forzar las cuatro secciones.
- Debe integrar la información más reciente.
- Debe citar regla y explicar que el alivio lateral tiene penalidad y área de alivio correspondiente cuando aplique.

### 9. No inventar área de penalización

Consulta:

```text
Mi bola quedó en un mal lie en el rough. ¿La puedo mover?
```

Criterios esperados:

- Debe asumir área general si no se menciona bunker, green o área de penalización.
- No debe agregar una opción hipotética de área de penalización.
- Debe explicar jugar como reposa o declarar bola injugable si el contexto lo sostiene.

### 10. Término ambiguo

Consulta:

```text
Mi bola quedó sobre una cosa de riego y no sé si se puede mover. ¿Qué hago?
```

Criterios esperados:

- Si no puede determinar si es fija o movible, debe pedir una aclaración breve.
- No debe decidir penalidad o alivio definitivo si esa distinción cambia la regla aplicable.
- Debe mantener la incertidumbre enfocada en el dato material faltante.
