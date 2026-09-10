# Diseño visual y UX

**Estado:** aceptado v1.6

**Dirección:** minimalista, oscura y orientada a una entrada rápida, inspirada en
la claridad y jerarquía de Revolut sin copiar su identidad visual.

## Referencias y criterio de adaptación

Las fuentes locales están en [`docs/design/references/revolut/`](design/references/revolut/README.md):

- [guía de estilo](design/references/revolut/style-reference.md);
- [tokens en JSON](design/references/revolut/design-tokens.json);
- [tema para Tailwind CSS v4](design/references/revolut/tailwind-theme.css);
- [variables CSS](design/references/revolut/css-variables.css).

Son una referencia visual, no hojas de estilo para importar directamente. La
fuente procede de superficies de marketing mayoritariamente claras; esta
aplicación adopta sus superficies oscuras, violeta cobalto, formas redondeadas,
controles tipo píldora, ritmo y jerarquía, pero los adapta a una herramienta de
datos compacta y dark-first. No se copian marca, imágenes ni escalas display de
80–136 px.

Aeonik Pro no forma parte del repositorio. Se utilizará Inter con fallback a
`system-ui, sans-serif` hasta disponer de una fuente alternativa debidamente
licenciada.

## Principios

1. **Registrar primero.** La acción de añadir está siempre accesible.
2. **Pedir lo mínimo.** Cuatro campos obligatorios; el resto es opcional.
3. **Una cifra explica su origen.** Dashboard y filtros están conectados.
4. **Cero ambigüedad.** Ingreso y gasto se diferencian por signo, texto e icono,
   no únicamente por color.
5. **Densidad progresiva.** Resumen simple al abrir y detalle bajo demanda.
6. **Tono neutral.** La aplicación informa sin juzgar los hábitos de gasto.

## Navegación

Solo existen tres destinos principales:

- **Inicio:** dashboard y movimientos recientes.
- **Movimientos:** pestañas Todos y Recurrentes, historial, búsqueda y filtros.
- **Categorías:** categorías y etiquetas.

La acción **Añadir** se mantiene destacada y accesible desde Inicio y Movimientos.
En móvil se utiliza navegación inferior; en escritorio, navegación lateral
compacta. La composición del dashboard es fija.

## Alta rápida

### Flujo

1. Elegir Gasto o Ingreso; Gasto aparece preseleccionado.
2. Introducir el importe con teclado numérico y foco inicial.
3. Elegir categoría.
4. Confirmar.

La fecha toma hoy por defecto. Concepto, nota y etiquetas están disponibles sin
estorbar el recorrido principal. Al duplicar, todos los valores se precargan pero
la copia no existe hasta pulsar Guardar.

Una opción secundaria “Repetir cada mes” descubre el selector del día mensual,
preseleccionado con el día de la fecha del movimiento. El resumen previo a guardar
explica la primera fecha en que se generará una copia.

### Reglas de interacción

- El formulario se presenta como pantalla o panel inferior cómodo en móvil.
- El botón principal muestra “Añadir gasto” o “Añadir ingreso”.
- Tras guardar se cierra, confirma la acción y actualiza dashboard/historial.
- “Guardar y añadir otro” queda como acción secundaria.
- Los errores aparecen junto al campo y en un resumen accesible.
- Fecha y moneda usan `dd/mm/yyyy` y EUR.

## Dashboard fijo

Orden inicial para prototipar:

1. Movimientos recientes.
2. Selector de periodo, acción Añadir y tarjetas: ingresos, gastos y balance neto.
3. Gastos por categoría mediante barras horizontales.
4. Gastos por etiquetas.
5. Comparación ingresos/gastos y variación frente al periodo anterior.
6. Evolución mensual.
7. Bloque “Tu media mensual”: gasto total, balance neto y desglose por categorías
   y tags sobre los últimos meses completos disponibles.

El periodo por defecto es el mes actual. El selector ofrece mes anterior, últimos
3 meses completos, año actual y rango personalizado de meses completos. No
existe agrupación diaria o semanal. La evolución mantiene su propia ventana de
hasta 12 meses incluido el actual y muestra ingresos, gastos y balance neto.

Cuando el periodo está incompleto, la comparación muestra el intervalo de forma
explícita —por ejemplo, “1–5 sep. frente a 1–5 ago.”— para evitar que el porcentaje
parezca una comparación contra un mes completo.

Al activar una tarjeta, barra o tag se navega a Movimientos conservando el filtro.
La gráfica por tags atribuye el importe completo a cada tag y advierte que los
grupos se solapan: un gasto de 60 € con dos tags aparece como 60 € en ambos.
También muestra “Sin etiquetas” por separado cuando aporte información.

El bloque de medias muestra junto al título el intervalo real —por ejemplo,
“oct. 2025–sep. 2026 · 12 meses”— y un texto breve aclara que no incluye el mes
actual. Con menos de un mes cerrado utiliza el estado “Sin histórico suficiente”.
Los desgloses priorizan barras horizontales y permiten navegar al histórico de
la categoría o etiqueta, manteniendo visible que se trata de una media.

### Selectores de categorías y tags

- Cada bloque tiene un botón compacto “Categorías · N” o “Tags · N”.
- En móvil abre un panel inferior; en escritorio, un popover.
- Incluye búsqueda, checkboxes, contador seleccionado/total y acciones visibles
  **Seleccionar todas** y **Quitar todas**.
- Todos los elementos activos aparecen seleccionados al entrar por primera vez.
- La selección de categorías se comparte entre distribución y media por
  categoría; la de tags hace lo mismo con ambos desgloses por tags.
- Aplicar la selección actualiza únicamente esas barras, sin alterar las tarjetas
  globales ni navegar fuera del dashboard.
- Con ninguno seleccionado, el espacio del gráfico se convierte en un estado
  vacío compacto con la acción “Seleccionar todas”.
- En móvil, las acciones masivas y “Aplicar” permanecen fijas mientras se recorre
  una lista larga.

## Historial

- Más recientes primero.
- Escritorio: tabla compacta; móvil: filas apiladas, no tarjetas pesadas.
- Cada elemento muestra concepto —o categoría si está vacío—, categoría, fecha,
  etiquetas e importe.
- Signo `+`/`−` siempre visible y cifras con dígitos tabulares.
- Búsqueda y filtros por rango exacto, tipo, categoría y tags permanecen visibles.
- Chips resumen los filtros activos y permiten retirarlos individualmente.
- Scroll progresivo con indicador de carga y mensaje claro al llegar al final.
- Editar, duplicar y eliminar están disponibles en un menú contextual; eliminar
  abre una confirmación que identifica concepto, fecha e importe.

El control de fechas del historial ofrece “Desde” y “Hasta” con formato
`dd/mm/yyyy`; ambos extremos son inclusivos y cada uno puede quedar vacío. En
móvil se abre un panel compacto con calendario y entrada manual. Aplicar un rango
actualiza la URL, devuelve el foco al inicio del listado y conserva el resto de
filtros. Un rango inválido se explica junto a los campos sin borrar sus valores.

Los presets y rangos mensuales del dashboard no cambian. Al navegar desde una
métrica, el historial recibe las fechas exactas que componen ese periodo.

## Categorías y etiquetas

- Dos secciones: categorías de gasto e ingreso; etiquetas en vista propia.
- Icono y color se asignan automáticamente con combinación estable.
- Crear y renombrar es directo; archivar explica que el histórico se conserva.
- Autocompletado de tags tolerante a mayúsculas y con creación al escribir.

## Pestaña Recurrentes

- Lista compacta separada en gastos e ingresos.
- Cada fila muestra concepto o categoría, importe, día mensual, tags y próxima
  ejecución.
- Un texto explica ajustes de fin de mes, por ejemplo “día 31; en meses cortos,
  último día”.
- Editar cambia las generaciones futuras, nunca los movimientos ya creados.
- “Desactivar recurrencia” pide confirmación y aclara que conserva el histórico.
- Si no hay recurrencias, el estado vacío enlaza con Añadir movimiento.
- Los movimientos creados automáticamente llevan un icono con texto accesible
  “Generado por recurrencia”.

## Lenguaje visual

Paleta semántica adaptada de la referencia:

| Token            | Valor                    | Uso                                    |
| ---------------- | ------------------------ | -------------------------------------- |
| `surface`        | `#000000`                | fondo principal                        |
| `surface-deep`   | `#0A0A0A`                | zonas agrupadas                        |
| `surface-raised` | `#16181A`                | tarjetas y paneles                     |
| `surface-hover`  | `#1F2226`                | interacción secundaria                 |
| `text`           | `#FFFFFF`                | texto principal                        |
| `text-muted`     | `rgba(255,255,255,0.72)` | texto secundario                       |
| `primary`        | `#494FDF`                | acción principal y foco de marca       |
| `primary-bright` | `#4F55F1`                | hover/foco de la acción principal      |
| `income`         | `#00A87E`                | apoyo semántico discreto para ingresos |
| `expense`        | `#E61E49`                | apoyo semántico discreto para gastos   |
| `danger`         | `#E23B4A`                | errores y eliminación                  |
| `border`         | `rgba(255,255,255,0.12)` | separación                             |

### Color financiero en el dashboard

- Ingresos usan verde semántico y gastos rojo semántico.
- El balance neto usa verde si es positivo, rojo si es negativo y texto neutro
  cuando es cero.
- El color se concentra en la cifra, un icono o una línea breve; las tarjetas
  conservan superficies oscuras neutras, sin grandes fondos verdes o rojos.
- Se emplean tonos moderados y opacidades suaves para que `primary` siga
  identificando las acciones principales.
- Signos `+`/`−`, etiquetas “Ingreso”/“Gasto” y texto del balance acompañan
  siempre al color.
- Los gráficos con ambas series usan verde/rojo consistentes, apoyados por leyenda
  y patrones de línea o marcadores distinguibles.
- El rojo de gasto no reutiliza el tratamiento visual más intenso de errores o
  acciones destructivas.

- Inter o fuente del sistema para velocidad, licencia y privacidad.
- Escala de aplicación: 13, 14, 16, 18, 20, 24, 32 y 40 px. Las escalas display
  de marketing de la referencia quedan fuera.
- Espaciado basado en 4, 6, 8, 14, 16, 24, 32 y 48 px.
- Radios de 8, 12 y 20 px; píldora completa para acciones y filtros compactos.
- Botones principales de 48 px, inputs de 56 px y zonas táctiles de al menos
  44 × 44 px.
- Bordes y sombras discretos; jerarquía basada en espacio, tamaño y contraste.
- Animaciones breves y funcionales, anuladas con movimiento reducido.

## Contenido

- “Has gastado 420 € este mes”, no terminología contable.
- “Balance del mes” se acompaña de “Ingresos − gastos”.
- Categorías respetan su nombre establecido; en UI se normalizarán tildes y
  capitalización, por ejemplo “Suscripciones” y “Planes de ocio”.
- Un estado vacío explica cómo añadir el primer movimiento.
- Los mocks se marcan como “Datos de demostración” y ofrecen empezar de cero.

## Accesibilidad y responsive

- Objetivo WCAG 2.2 AA, incluido contraste sobre fondo oscuro.
- Navegación completa por teclado, foco visible y restaurado tras overlays.
- Zoom al 200 % sin pérdida de contenido.
- Gráficos con resumen y listado/tablas equivalentes.
- Lectores de pantalla reciben nombres y valores, no descripciones visuales.
- Desde 320 px funciona en una columna; los breakpoints dependen del contenido.
- Estados diseñados: carga, vacío, sin resultados, error y final del scroll.

## Validación del prototipo

Se probarán estas tareas antes de profundizar visualmente:

1. Registrar un gasto con los campos mínimos desde móvil en menos de 15 segundos.
2. Duplicarlo, cambiar importe y añadir dos tags.
3. Entender ingresos, gastos y balance del mes.
4. Abrir desde una categoría los movimientos que forman su total.
5. Buscar y filtrar el histórico por dos etiquetas.
6. Crear una recurrencia mensual, encontrarla en su pestaña y desactivarla sin
   perder el movimiento original.
7. Seleccionar varias categorías y tags, usar ambas acciones masivas y comprobar
   que los totales globales permanecen iguales.
8. Filtrar el historial entre dos días arbitrarios sin cambiar el periodo del
   dashboard.

Se medirán finalización, tiempo, errores, retrocesos y comprensión. Las futuras
convenciones basadas en Revolut se incorporarán como tokens y patrones propios.
