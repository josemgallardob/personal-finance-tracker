# Diseño técnico

**Estado:** aceptado v1.9 para el MVP

**Enfoque:** monolito modular privado, desplegable como una única aplicación.

## Objetivos

- Optimizar la entrada manual desde móvil.
- Mantener exactitud monetaria y estadísticas trazables.
- Operar con poco mantenimiento en un servidor privado.
- Soportar el crecimiento del histórico sin cargarlo completo en el navegador.
- Facilitar una evolución futura hacia finanzas compartidas sin implementar aún
  usuarios, permisos ni cuentas conjuntas.

## Contexto de ejecución

```text
Móvil u ordenador
       │ red privada / VPN
       ▼
Aplicación web (UI + casos de uso)
       │
       └── SQLite en disco local
```

El MVP no incorpora autenticación. Por tanto, el servicio solo puede escuchar en
una red privada de confianza o publicarse detrás de una VPN con control de acceso.
Exponerlo directamente a internet requiere añadir autenticación antes del
despliegue y queda fuera del alcance acordado.

## Módulos

| Módulo        | Responsabilidad                                              |
| ------------- | ------------------------------------------------------------ |
| Movimientos   | altas, edición, eliminación, duplicado, listado y búsqueda   |
| Clasificación | categorías, etiquetas y sus asociaciones                     |
| Analítica     | agregaciones por periodo, tipo, categoría y etiqueta         |
| Recurrencias  | plantillas mensuales, generación idempotente y desactivación |
| Preferencias  | locale, moneda y zona horaria                                |

La UI accede a casos de uso, no directamente a tablas. No se introducen colas,
cachés distribuidas, workers ni servicios separados.

## Modelo de datos

### Preparación para un futuro espacio compartido

Aunque exista una sola persona, las entidades financieras incluirán
`workspace_id`. En el MVP se crea un único espacio implícito. En una evolución,
`WorkspaceMember` podrá relacionar dos personas con ese espacio sin reasignar
todos los movimientos ni mezclar propiedad personal con autenticación.

Esto no implica construir UI multiusuario ni permisos durante el MVP.

### Entidades

- `Workspace`: contenedor de los datos financieros; uno implícito en el MVP.
- `Preference`: español, locale, EUR y zona horaria `Europe/Madrid`.
- `Transaction`: tipo, céntimos, fecha, categoría, concepto, nota y timestamps.
- `Category`: nombre, tipo, icono/color automáticos, orden y fecha de archivado.
- `Tag`: nombre normalizado, presentación y fecha de archivado.
- `TransactionTag`: relación muchos-a-muchos entre movimiento y etiqueta.
- `RecurringRule`: plantilla mensual, día objetivo, próxima fecha, estado y fecha
  de desactivación.
- `RecurringOccurrence`: constancia de que una regla ya procesó una fecha de
  vencimiento. Guarda la regla, la fecha programada y un enlace anulable al
  movimiento creado; no guarda importe ni ningún otro dato personal. Es una
  ampliación del esquema introducida al aceptar estas reglas, no una tabla que
  el diseño ya recogiese.

No existen tablas `Account`, `Balance`, `Transfer`, `Budget` ni `ImportBatch` en
el esquema inicial.

### Invariantes

- `amount_minor INTEGER` entre `1` y `99999999999` —entero de 64 bits de
  SQLite— y moneda fija `EUR`.
- `type` solo admite `income` o `expense`.
- La categoría pertenece al mismo workspace y coincide con el tipo.
- Un movimiento no puede repetir una etiqueta.
- Fecha efectiva como texto ISO `YYYY-MM-DD`; marcas técnicas como enteros Unix
  en milisegundos UTC.
- Los nombres normalizados de categorías y tags activos son únicos dentro de su
  ámbito y workspace: por tipo en categorías y global en tags.
- El nombre normalizado se guarda aparte del nombre de presentación y se obtiene
  recortando, aplicando Unicode NFC, colapsando espacios internos y pasando a
  minúsculas sin eliminar diacríticos.
- `category.type` es inmutable: ninguna mutación del MVP lo modifica.
- Longitudes máximas: concepto 200 caracteres, nota 2.000, nombre de categoría
  o tag 80, y como mucho 20 filas de `TransactionTag` por movimiento. La unidad
  de esos límites es el carácter visible —el grupo de grafemas— y no el punto de
  código ni la unidad UTF-16.
- El archivado conserva asociaciones históricas.
- Cada mutación y sus asociaciones se confirman en una transacción SQL.
- Cada movimiento automático guarda `recurring_rule_id` y `scheduled_for`; una
  restricción única sobre ambos campos impide duplicar un vencimiento.
- `RecurringOccurrence` es único por `(recurring_rule_id, scheduled_for)` y
  sobrevive al borrado de su movimiento: en ese caso su enlace queda nulo y la
  fecha no vuelve a generarse.
- Un movimiento de origen tiene como mucho una `RecurringRule` activa.
- Una regla desactivada no vuelve al estado activo; el MVP no expone reactivar
  ni borrar reglas.
- No se puede archivar una categoría o un tag referenciado por la plantilla de
  una regla activa.

## Contrato de validación de importes y texto

La conversión de importes vive en el dominio y no usa `parseFloat` ni
redondeo implícito. Acepta el texto que cumpla
`^\d{1,3}(\.\d{3})*(,\d{1,2})?$` o `^\d+(,\d{1,2})?$` tras recortar los
extremos, y rechaza cualquier otra forma —punto decimal, grupos de millar
incompletos, más de dos decimales, signo, símbolo de moneda o espacios internos—
con un error de campo. El resultado es un entero de céntimos dentro de
`[1, 99999999999]`.

Las agregaciones acumulan céntimos como enteros y verifican el rango seguro
antes de serializar un total en JSON. Cuando la suma exacta supera
`Number.MAX_SAFE_INTEGER` la consulta devuelve un error controlado en lugar de
un número impreciso; ninguna capa convierte céntimos a coma flotante para sumar.

La normalización de nombres se aplica en el dominio antes de comprobar la
unicidad y antes de escribir. Concepto y nota conservan sus tildes. Los
caracteres de control no imprimibles se rechazan en concepto, nota y nombres; la
nota es el único campo que admite saltos de línea. Esa validación se aplica
sobre el texto recibido, antes de recortar los extremos o colapsar espacios, de
modo que un control situado en un extremo se rechaza en lugar de desaparecer.

Las longitudes máximas se miden en caracteres visibles, segmentando el texto en
grupos de grafemas con `Intl.Segmenter`. Una letra acentuada cuenta uno en su
forma compuesta y en la descompuesta, y una secuencia de emoji con tono de piel,
una bandera o un grupo familiar unido con `ZWJ` cuentan uno.

## Capas

```text
Presentación → Aplicación → Dominio
       │            │          ▲
       └──── Infraestructura ───┘
```

- **Presentación:** rutas, componentes, formularios y parámetros de URL.
- **Aplicación:** casos de uso, transacciones SQL e invalidación de datos.
- **Dominio:** reglas puras de dinero, periodos, filtros y agregación.
- **Infraestructura:** repositorios SQL, reloj, configuración y logs.

## Consultas

### Historial

- Paginación por cursor estable usando `(date, created_at, id)` descendente.
- Tamaño inicial propuesto: 30 movimientos por página.
- El cursor y los filtros se procesan en servidor.
- La búsqueda cubre concepto y nota, con escape y normalización apropiados.
- Los filtros combinan `dateFrom`, `dateTo`, tipo, categoría, texto y tags.
- Al seleccionar varios tags se aplica semántica OR.
- `untagged=true` selecciona los movimientos sin ninguna etiqueta y es
  mutuamente excluyente con el filtro por etiqueta: recibir ambos es un error de
  validación, no una intersección vacía.

`dateFrom` y `dateTo` son fechas ISO sin hora en el contrato, se aplican de
forma inclusiva y son opcionales independientemente. Se validan en el servidor y
se serializan en la URL del historial. No se convierten en el selector mensual
del dashboard ni heredan sus presets salvo al navegar expresamente desde una
métrica.

La carga progresiva solicita páginas sucesivas. Nunca se usa el subconjunto
cargado en cliente para calcular un total global.

### Dashboard

Una consulta de resumen recibe el filtro temporal y devuelve:

- suma de ingresos, gastos y balance;
- agregación mensual de ingreso/gasto;
- gastos por categoría;
- gastos por etiqueta y gasto sin etiquetas;
- comparación con el periodo anterior equivalente;
- medias mensuales de gasto total, gasto por categoría/tag y balance neto sobre
  la ventana móvil de meses completos;
- movimientos recientes.

Las asociaciones muchos-a-muchos de tags deben agregarse por separado para no
multiplicar accidentalmente ingresos/gastos generales. En la agregación por tag,
el importe completo se atribuye a cada tag asociado. La API indicará que los
grupos se solapan y que su suma no representa el gasto total.

El gasto sin etiquetas se calcula como un grupo aparte de la agregación por tag,
sin crear ninguna fila artificial en `Tag`. Los desgloses por categoría y por
tag incluyen los elementos archivados que tengan importe en la ventana y los
marcan como archivados; la selección de la UI decide qué se dibuja, nunca qué
se suma.

La consulta de medias determina en `Europe/Madrid` el último mes natural cerrado
y toma hasta 12 meses, comenzando como pronto en el primer mes natural completo
posterior al primer movimiento. Genera explícitamente la serie de meses para
incluir meses sin datos con valor cero. Si la ventana está vacía devuelve
`insufficientHistory`, no importes cero. La respuesta incluye `windowStart`,
`windowEnd` y `monthCount` para que la UI pueda explicar el cálculo.

Cada media viaja como suma exacta en céntimos y divisor de meses, no como una
cifra ya redondeada. El redondeo al céntimo más próximo, con la mitad alejándose
de cero también en negativos, ocurre solo al presentar. Ningún total se obtiene
sumando medias redondeadas.

La serie de evolución es independiente del selector principal y comprende el mes
actual más hasta 11 meses anteriores, con los meses sin datos materializados a
cero; cuando no existe ningún movimiento, la serie se devuelve vacía en lugar de
una sucesión de ceros.

La comparación con el periodo anterior recorre ambos intervalos hasta el mismo
día ordinal y limita el extremo del intervalo anterior al último día de su mes
cuando ese día no existe. La respuesta incluye los cuatro extremos realmente
comparados para que la UI pueda rotularlos. El cambio porcentual es
`(actual − anterior) ÷ abs(anterior)`; con `anterior = 0` y `actual ≠ 0`
devuelve `null` junto a un motivo que la UI traduce como “Sin base de
comparación”, y con ambos valores a cero devuelve `0`.

Las selecciones de categorías y tags se aplican sobre las series de desglose ya
devueltas o mediante parámetros específicos de visualización. Un estado por
dimensión se comparte entre su distribución del periodo y su media mensual. No se
reutiliza como filtro de la consulta de totales. La selección inicial contiene
los elementos activos; los archivados llegan marcados y sin seleccionar, y un
elemento activo nuevo entra en la selección mientras el usuario no haya
interactuado manualmente con ese selector. Esta separación evita que una
selección parcial cambie accidentalmente ingresos, gastos, balance o medias
globales. El estado se conserva durante la sesión y no requiere persistencia en
base de datos en el MVP.

## Mutaciones críticas

### Crear o editar

1. Validar estructura, importe, fecha, tipo, categoría y tags.
2. Comprobar pertenencia al workspace implícito.
3. Guardar movimiento y relaciones en una transacción SQL.
4. Invalidar resumen y páginas del historial afectadas.
5. Devolver la representación normalizada.

### Duplicar

Duplicar no persiste inmediatamente. Devuelve o abre un formulario precargado
con tipo, importe, categoría, concepto, nota, tags y la fecha del movimiento de
origen, con identificador nuevo solo después de que el usuario confirme. La
copia no arrastra la recurrencia: `recurring_rule_id` y `scheduled_for` quedan
nulos aunque el origen fuese una entrada generada.

### Clasificación archivada al editar

La validación de una mutación compara la clasificación entrante con la que el
movimiento ya tenía:

- una categoría o un tag archivados se aceptan solo si ya estaban asociados a
  ese movimiento antes de la edición;
- cualquier otra categoría o tag archivados se rechazan, igual que en un alta;
- quitar un tag archivado es válido, pero volver a añadirlo ya no lo es;
- si la mutación cambia `type`, exige una categoría activa compatible con el
  nuevo tipo; conservar la categoría anterior deja de ser posible.

La reordenación recibe la lista completa de identificadores de categorías
activas de un solo tipo, sin duplicados ni identificadores ajenos. Las
categorías archivadas no participan en la ordenación.

### Eliminar

Tras confirmación en UI, el caso de uso borra movimiento y relaciones de forma
atómica. El MVP no promete recuperación posterior; la confirmación debe nombrar
claramente la transacción afectada.

### Generar recurrencias

1. Una tarea programada obtiene reglas activas con `next_due_date <= hoy`, usando
   la fecha actual de `Europe/Madrid`.
2. Por cada vencimiento pendiente abre una transacción SQL y crea el movimiento
   con una copia de la plantilla y de sus tags, junto con su
   `RecurringOccurrence`.
3. La restricción `(recurring_rule_id, scheduled_for)` hace idempotente cualquier
   reintento o ejecución concurrente.
4. Calcula el próximo mes utilizando el día objetivo o su último día disponible.
5. Repite hasta que `next_due_date` sea futura para recuperar meses omitidos.

La tarea se ejecuta al menos diariamente y también al arrancar la aplicación. El
dashboard solo consulta movimientos materializados; una regla nunca cuenta como
gasto o ingreso previsto. La tarea recorre únicamente el conjunto de datos
personales.

El arranque del proceso Node llama a esa recuperación antes de servir peticiones,
nunca durante `next build` ni en el runtime Edge. El comando `npm run recurring:run`
imprime una sola línea JSON con recuentos y un código de motivo cerrado, sin
rutas, importes ni conceptos. La instalación del temporizador (cron o el
equivalente del anfitrión) pertenece a operaciones; este repositorio no instala
ni arranca un planificador.

Borrar un movimiento generado elimina el movimiento y sus asociaciones, pero
conserva su `RecurringOccurrence` con el enlace a nulo, de modo que esa fecha
queda procesada para siempre. Borrar el movimiento de origen no toca la regla.

### Editar o desactivar una regla

1. Abrir una transacción SQL y tomar la regla para escritura, de forma que el
   generador no pueda intercalarse.
2. Revalidar dentro de esa transacción los vencimientos pendientes hasta hoy y
   la versión de la plantilla leída por la interfaz; si no coinciden, abortar y
   pedir reintento.
3. Materializar esos vencimientos pendientes con la plantilla anterior.
4. Aplicar la edición o la desactivación y recalcular `next_due_date` como una
   fecha estrictamente futura.
5. Confirmar. Cualquier fallo deja la regla y sus vencimientos como estaban; el
   reintento es idempotente porque la unicidad de
   `(recurring_rule_id, scheduled_for)` impide repetir una fecha.

El punto de corte es ese bloqueo serializado: la recuperación de atrasados y el
cambio de plantilla ocurren en la misma transacción, nunca en dos pasos que el
generador pueda partir por la mitad.

## Seguridad y privacidad

- Escuchar en interfaz privada por defecto y documentar configuración con VPN.
- HTTPS incluso en red privada cuando el proxy utilizado lo permita.
- Protección CSRF/origin en mutaciones y cabeceras de seguridad.
- Validación de entrada y consultas parametrizadas.
- Sin conceptos, notas, importes ni tags personales en logs.
- Secretos y URL de base de datos fuera del repositorio.

## Resiliencia

- SQLite usa WAL, claves foráneas activadas en cada conexión y un `busy_timeout`
  para absorber la breve concurrencia entre peticiones y la tarea de recurrencias.
- El archivo de base de datos reside en disco local persistente, nunca en un
  sistema de archivos de red.
- Backup cifrado automático mediante la API de backup de SQLite o
  `VACUUM INTO`; no se copia en caliente el archivo principal de forma directa.
- Retención inicial: 7 copias diarias, 4 semanales y 12 mensuales.
- Restauración probada en entorno desechable antes de considerar publicable una
  versión que cambie el esquema.
- Migraciones versionadas y hacia delante; backup previo a cambios destructivos.
- La exportación para el usuario se incorporará en una evolución posterior.

## Rendimiento

- Objetivo p95 en red privada: lecturas comunes < 500 ms y mutaciones < 800 ms.
- Índices iniciales: workspace+fecha, workspace+tipo+fecha, categoría+fecha,
  tag+movimiento y nombre normalizado.
- Dataset de validación: 100 000 movimientos con distribución realista.
- El dashboard se agrega en SQLite; no se descarga todo el histórico.
- Cualquier caché futura será derivada, invalidable y reconstruible.

## Decisiones pospuestas

- Identidades, sesiones y miembros de un workspace.
- Separación de movimientos personales y conjuntos.
- Cuentas financieras, saldos y transferencias.
- Importación, sincronización bancaria y exportación.
- Adjuntos, recurrencias distintas de la mensual, presupuestos y múltiples
  monedas.
