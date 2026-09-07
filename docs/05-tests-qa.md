# Tests y QA

**Estado:** aceptado v1.8 para el MVP

**Objetivo:** demostrar que el historial y todas sus representaciones producen
resultados correctos después de cada mutación.

## Estrategia

```text
          E2E: flujos críticos
         Integración: casos de uso + SQLite
    Componentes: interacción y accesibilidad
 Unitarios: dinero, periodos, filtros y agregaciones
Estático: tipos, lint, formato y dependencias
```

La cobertura global no sustituye la selección de casos. Las reglas de cálculo,
filtros y asociaciones de tags deben cubrir todas sus ramas y límites relevantes.

## Strict coverage and test integrity rules

These rules are mandatory for every test, production-code, coverage, test-runner,
and CI change:

1. Do NOT modify, weaken, bypass, or manipulate the code coverage measurement.
2. Do NOT add or use:
   - coverage exclusions;
   - “no cover” pragmas or comments;
   - ignore directives;
   - changes to coverage configuration;
   - changes to test configuration intended to exclude code;
   - changes to CI configuration intended to reduce coverage requirements.
3. Do NOT delete, simplify, or rewrite production code merely to make it easier
   to cover.
4. Do NOT add tests whose only purpose is to execute a line without validating
   meaningful behavior.
5. Do NOT use mocks, stubs, monkey-patching, reflection, or similar techniques to
   bypass the actual logic under test. Use them only when they are genuinely
   required to isolate an external dependency.
7. Every new test must validate a meaningful behavior, business rule, edge case,
   error condition, or important execution path.
8. Cover both successful and failure paths where applicable.
9. Explicitly identify branches, conditions, exceptions, and edge cases that are
   currently uncovered and write tests for them.
10. If a line is difficult to cover because of unreachable or dead code, do NOT
    manipulate coverage to hide it. Report it separately.
11. Preserve the existing coverage configuration and thresholds.
12. Production code changes are allowed ONLY if they are legitimate bug fixes or
    testability improvements that preserve intended behavior. Do not make
    artificial changes solely to increase coverage.

Before finishing any change that adds or modifies tests:

- Run the complete test suite.
- Run the coverage tool.
- Report the final line and branch coverage.
- Identify which uncovered lines and branches remain.
- Explain why any remaining uncovered code could not reasonably be tested.
- Review the generated tests and remove any test that exists only to inflate the
  coverage percentage.

The final result must improve coverage through meaningful tests, not through
coverage manipulation.

### Coverage thresholds

The initial thresholds are mandatory:

- 90% lines globally.
- 90% statements globally.
- 90% functions globally.
- 85% branches globally.
- 100% branch coverage for monetary rules, monthly averages, date-period
  calculations, and recurrence generation.

CI must fail when a threshold is not met. Thresholds may be raised as coverage
improves and must never be lowered to make a change pass.

## Unitarios

- Conversión y formato de céntimos en EUR.
- Balance como ingresos menos gastos.
- Periodos: mes actual, anterior, últimos tres meses, año y rango.
- Comparación con el periodo anterior equivalente.
- Compatibilidad entre tipo y categoría.
- Normalización y eliminación de tags duplicados.
- Semántica OR de filtros con varias etiquetas.
- Agregación por etiquetas solapadas, atribuyendo el importe completo a cada una.
- Parámetros y cursores del historial.
- Rangos diarios abiertos/cerrados, extremos inclusivos y orden inválido.
- Próxima fecha mensual para días 1–31, febrero y años bisiestos.
- Recuperación de varios vencimientos y conservación del día mensual original.
- Ventana de hasta 12 meses cerrados, meses a cero y ausencia de histórico.
- Media de gasto total, por categoría/tag y de balance neto.

## Integración

Las pruebas usan SQLite real y aislado, con la misma configuración de claves
foráneas y WAL que producción:

- esquema, migraciones, restricciones e índices;
- alta y edición atómicas de movimiento y tags;
- borrado en cascada solo de asociaciones, no de categoría/tag;
- archivado que conserva el histórico;
- paginación estable cuando varios movimientos comparten fecha;
- combinación de búsqueda, periodo, tipo, categoría y tags;
- combinación de `dateFrom`/`dateTo` exactos con los demás filtros;
- agregaciones sobre todo el dataset, independientemente de la página;
- aislamiento por `workspace_id`;
- datos mock reiniciables y separados de datos personales;
- generación idempotente y concurrente de vencimientos;
- desactivación sin borrar movimientos ya generados;
- recuperación después de varios meses sin ejecutar la aplicación;
- medias SQL equivalentes a los cálculos de dominio, sin depender del periodo
  seleccionado en el dashboard;
- generación de meses sin movimientos y metadatos exactos de la ventana;
- contención breve entre escritores, `busy_timeout` e idempotencia bajo
  concurrencia;
- backup consistente y restauración desde una instantánea SQLite.

## Componentes

- Formulario rápido con foco, teclado móvil y valores predeterminados.
- Validación de los cuatro campos obligatorios.
- Campos opcionales y selector/creador de múltiples tags.
- Edición, duplicado sin persistencia inmediata y confirmación de borrado.
- Búsqueda, chips de filtros y scroll progresivo.
- Selector diario Desde/Hasta, validación y persistencia en URL.
- Tarjetas, barras, series y navegación desde métricas a movimientos.
- Selectores múltiples buscables, acciones seleccionar/quitar todas, estado vacío
  y selección compartida entre distribución y media.
- Semántica visual verde/rojo, balance cero neutro y significado no dependiente
  exclusivamente del color.
- Formato español `dd/mm/yyyy`, EUR y números negativos.
- Estados de carga, vacío, error, sin resultados y final del historial.
- Nombres, roles, foco y contraste; axe sin infracciones críticas conocidas.

## End-to-end

1. Abrir los datos de demostración y entender el dashboard.
2. Empezar de cero y crear un gasto con los cuatro campos obligatorios.
3. Crear un ingreso y comprobar ingresos, gastos y balance.
4. Editar importe, fecha, categoría y tags; verificar el recálculo.
5. Duplicar un movimiento, modificarlo y confirmar que solo entonces se guarda.
6. Cancelar y después confirmar una eliminación.
7. Buscar y combinar filtros de periodo, tipo, categoría y dos tags.
8. Navegar desde una barra/cifra al historial que la compone.
9. Cargar varias páginas por scroll y comprobar que el dashboard no cambia.
10. Acceder desde viewport móvil a través de la configuración de red privada.
11. Crear, editar y desactivar una recurrencia desde su pestaña.
12. Ejecutar dos veces el generador y comprobar que solo crea un movimiento.
13. Comparar las cuatro medias con un histórico conocido de más de 12 meses.
14. Seleccionar categorías/tags, usar todas/ninguna y verificar que las tarjetas
    y medias globales no cambian.
15. Filtrar entre dos días arbitrarios, incluidos los extremos, y regresar al
    dashboard sin modificar su periodo mensual.

Chromium cubre cada cambio; Firefox y WebKit ejecutan los flujos críticos de forma
programada y antes de publicar una versión.

## Casos de datos esenciales

- Importes de 0,01 €, importes grandes, coma decimal y separadores de miles.
- Rechazo de cero, negativos, más de dos decimales y texto no numérico.
- Fin de mes/año, año bisiesto y zona horaria del servidor distinta a la local.
- Rangos de un día, solo Desde, solo Hasta, sin resultados e inicio posterior al
  final.
- Concepto y nota vacíos, largos, con tildes, emoji y caracteres de control.
- Categorías de ingreso usadas en gasto y viceversa.
- Tags con mayúsculas, espacios, tildes, repetidos y archivados.
- Movimiento sin tags y con varios tags.
- Varios movimientos con la misma fecha y timestamp próximo.
- Periodos sin datos, solo ingresos, solo gastos y balance negativo.
- Dataset de 100 000 movimientos con distribución realista.
- Recurrencias en días 28, 29, 30 y 31, incluida recuperación tras una pausa.
- Cero meses completos, un mes parcial, meses intermedios vacíos, menos de 12
  meses y más de 12 meses de histórico.

## Matriz de riesgo

| Riesgo | Impacto | Verificación |
| --- | --- | --- |
| Total o balance incorrecto | Crítico | unitarios de agregación + integración SQL + E2E |
| Doble conteo accidental en totales por tags | Crítico | agregación general separada y atribución completa solo en vista por tags |
| Fecha en periodo incorrecto | Alto | límites de mes/año y zona horaria |
| Historial pierde o repite filas | Alto | paginación concurrente y cursor estable |
| Dashboard usa solo datos visibles | Crítico | integración con varias páginas + E2E |
| Borrado accidental | Alto | confirmación de UI y cancelación E2E |
| Servicio accesible públicamente | Crítico | revisión de configuración y prueba de red |
| Entrada móvil demasiado lenta | Alto | test de usabilidad y medición de tiempo |
| Movimiento recurrente duplicado | Crítico | restricción única, concurrencia e idempotencia |
| Vencimiento perdido con servidor apagado | Alto | recuperación de fechas pendientes al reiniciar |
| Media inflada al omitir meses a cero | Alto | serie mensual completa y fixture con huecos |
| Media reducida por mes actual parcial | Alto | prueba de exclusión con reloj controlado |
| Selección visual altera totales globales | Alto | test de aislamiento de estado y E2E |
| Color financiero ambiguo o invasivo | Medio | contraste, daltonismo y revisión visual |
| Movimiento omitido en el límite del rango | Alto | extremos inclusivos y zona horaria |

## Rendimiento

Con 100 000 movimientos:

- lectura p95 habitual menor de 500 ms en red privada;
- mutación p95 menor de 800 ms;
- primera página del historial sin descargar páginas posteriores;
- scroll sin filas repetidas ni saltos apreciables;
- dashboard calculado en servidor sin transferir todo el histórico;
- entrada interactiva sin esperar a que carguen gráficas no esenciales.

Los límites se miden en un perfil de hardware documentado, no como cifras
abstractas.

## Seguridad y recuperación

- Verificar que el servicio no queda enlazado a una interfaz pública por defecto.
- Revisar CSRF/origin, cabeceras, validación e inyección.
- Confirmar que logs y errores no contienen datos financieros.
- Escanear secretos y dependencias en CI.
- Crear backup, restaurarlo en entorno desechable y comparar conteos, asociaciones
  e importes agregados.
- Probar migraciones desde la versión inmediatamente anterior.

## CI

GitHub Actions es el proveedor de CI. El flujo inicial está implementado en
`.github/workflows/ci.yml` y crecerá junto a las suites del producto.

### Disparador

El workflow se ejecuta exclusivamente con el evento `merge_group` y el tipo
`checks_requested`, cuando GitHub añade un PR a una merge queue. La ejecución
valida el merge group completo que GitHub prepara para integrar en la rama de
destino. No se ejecuta directamente al abrir, reabrir o actualizar un PR ni por
`push` después del merge.

### Checks obligatorios del PR

Cada solicitud de checks de la merge queue ejecuta desde el scaffolding inicial:

1. formato, lint y TypeScript;
2. tests unitarios;
3. cobertura con todos los umbrales obligatorios;
4. build de producción;
5. escaneo de secretos;
6. auditoría de dependencias.

Las migraciones y pruebas de integración sobre SQLite aislado se añadirán cuando
exista el primer esquema. La suite E2E crítica se añadirá con el primer flujo
vertical ejecutable. No se crean pasos vacíos ni checks que puedan aprobar sin
ejercitar comportamiento real.

Estos checks son obligatorios y deben pasar antes de aceptar el PR. La rama
de destino no permite merge con checks pendientes o fallidos.

### Flujo de ramas

```text
feature/*, fix/* o chore/* ──PR──> merge queue + CI ──> main
                                                   │
                                                   └── futuro PR ──> merge queue + CI ──> stable
```

La existencia de `stable`, el despliegue desde ella y cualquier ejecución
programada se definirán en la fase de despliegue. Una prueba inestable se corrige
o aísla con responsable; no se oculta con reintentos indefinidos.

## Trazabilidad

| Requisito | Unitario | Integración | Componente | E2E |
| --- | --- | --- | --- | --- |
| F-01/F-02 alta | dinero/validación | persistencia | formulario | 2 y 3 |
| F-03 edición | recálculo | atomicidad | edición | 4 |
| F-04 borrado | — | cascadas | diálogo | 6 |
| F-05 duplicado | copia | persistencia diferida | formulario | 5 |
| F-06 filtros | combinaciones | consulta | controles | 7 |
| F-07 dashboard | periodos/totales | agregación | tarjetas | 3 y 8 |
| F-08 categorías | agregación | drill-down | barras | 8 |
| F-09 tags | OR/importe completo | muchos-a-muchos | selector/gráfico | 4 y 7 |
| F-10 scroll | cursor | paginación | lista | 9 |
| F-11/F-12 recurrencia | calendario | generación idempotente | formulario/pestaña | 11 y 12 |
| F-13 desactivación | fecha límite | conservación histórica | confirmación | 11 |
| F-14 medias | ventana/fórmulas | serie mensual SQL | bloque y estado vacío | 13 |
| F-15 selectores visuales | — | totales invariables | multiselect/acciones masivas | 14 |

## Criterio de versión publicable

- F-01 a F-15 aceptados.
- Suite crítica en verde y revisión móvil/escritorio completada.
- Objetivos de rendimiento alcanzados o desviación aceptada explícitamente.
- Sin vulnerabilidades críticas conocidas explotables.
- Acceso privado verificado.
- Backup restaurado con éxito.
