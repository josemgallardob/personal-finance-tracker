/**
 * Spanish copy of the dashboard summary, its period selector and the recent
 * movements block.
 *
 * The tone is neutral and informative: the application reports figures and
 * never judges the habits behind them.
 */

export const dashboardCopy = {
  title: "Inicio",
  description:
    "Consulta tus ingresos, gastos y balance del periodo que elijas y los últimos movimientos registrados.",
  periodLabel: "Periodo",
  periodGroupLabel: "Periodo del dashboard",
  currentMonth: "Mes actual",
  previousMonth: "Mes anterior",
  lastThreeMonths: "Últimos 3 meses",
  currentYear: "Año actual",
  customMonthRange: "Rango personalizado",
  monthRangeTitle: "Rango de meses completos",
  monthRangeDescription:
    "Elige el primer y el último mes. Ambos se incluyen completos.",
  monthRangeApply: "Aplicar",
  monthRangeCancel: "Cancelar",
  monthFromLabel: "Mes inicial",
  monthToLabel: "Mes final",
  monthHint: "Elige un mes completo.",
  monthRequired: "Elige un mes",
  monthInvalid: "Introduce un mes válido",
  monthInverted: "El mes inicial no puede ser posterior al final",
  summaryLabel: "Resumen del periodo",
  income: "Ingresos",
  expense: "Gastos",
  net: "Balance neto",
  netHint: "Ingresos − gastos",
  incomeHint: "Total de ingresos del periodo",
  expenseHint: "Total de gastos del periodo",
  rangeLabel: (start: string, end: string) => `${start} – ${end}`,
  periodRange: (range: string) => `Periodo analizado: ${range}`,
  movementCount: (count: number) =>
    count === 1 ? "1 movimiento" : `${count} movimientos`,
  viewIncome: "Ver movimientos de ingresos",
  viewExpense: "Ver movimientos de gastos",
  viewNet: "Ver todos los movimientos del periodo",
  changeLabel: "Variación",
  comparisonTitle: "Comparación con el periodo anterior",
  comparisonRanges: (current: string, previous: string) =>
    `${current} frente a ${previous}`,
  comparisonConcept: "Concepto",
  comparisonCurrent: "Periodo actual",
  comparisonPrevious: "Periodo anterior",
  comparisonChange: "Variación",
  noComparisonBase: "Sin base de comparación",
  recentTitle: "Movimientos recientes",
  recentCaption: "Últimos movimientos registrados",
  recentEmptyTitle: "Aún no hay movimientos",
  recentEmptyDescription:
    "Añade tu primer gasto o ingreso para ver aquí los más recientes.",
  trendTitle: "Evolución mensual",
  trendLoading: "Cargando la evolución mensual…",
  trendErrorTitle: "No se ha podido cargar la evolución mensual",
  trendCaption: "Evolución mensual de ingresos y gastos",
  trendWindow: (start: string, end: string, months: number) =>
    `${start}–${end} · ${months === 1 ? "1 mes" : `${months} meses`}`,
  trendIndependent:
    "Esta serie mantiene su propia ventana de hasta 12 meses y no depende del periodo elegido en las tarjetas.",
  trendEmptyTitle: "Todavía no hay evolución que mostrar",
  trendEmptyDescription:
    "Registra tu primer movimiento para ver cómo evolucionan tus ingresos y gastos mes a mes.",
  monthColumn: "Mes",
  categoryTitle: "Gastos por categoría",
  categoryCaption: "Gasto por categoría del periodo",
  categoryColumn: "Categoría",
  categoryEmptyTitle: "Sin gastos en este periodo",
  categoryEmptyDescription:
    "Cuando registres un gasto dentro del periodo verás aquí su reparto por categorías.",
  tagTitle: "Gastos por etiquetas",
  tagCaption: "Gasto por etiqueta del periodo",
  tagColumn: "Etiqueta",
  tagOverlap:
    "Un gasto con varias etiquetas cuenta su importe completo en cada una, así que los grupos se solapan y su suma no es el gasto total.",
  tagEmptyTitle: "Sin gastos por etiqueta en este periodo",
  tagEmptyDescription:
    "Cuando etiquetes un gasto del periodo verás aquí su reparto por etiquetas.",
  untagged: "Sin etiquetas",
  categorySelectorTitle: "Categorías que se dibujan",
  categorySelectorTrigger: "Categorías",
  tagSelectorTitle: "Etiquetas que se dibujan",
  tagSelectorTrigger: "Etiquetas",
  selectionEmptyTitle: "No hay ninguna serie seleccionada",
  selectionEmptyDescription:
    "Elige al menos una serie para volver a dibujar estas barras. Los totales y las medias no cambian.",
  selectAll: "Seleccionar todas",
  averagesTitle: "Tu media mensual",
  averagesCaption: "Medias mensuales de la ventana",
  averagesWindow: (start: string, end: string, months: number) =>
    `${start}–${end} · ${months === 1 ? "1 mes completo" : `${months} meses completos`}`,
  averagesExcludesCurrentMonth:
    "La ventana usa meses completos y nunca incluye el mes actual, que todavía está en curso.",
  averagesLoading: "Cargando tus medias mensuales…",
  averagesErrorTitle: "No se han podido cargar las medias mensuales",
  averageExpense: "Gasto medio mensual",
  averageNet: "Balance neto medio mensual",
  averageCategoryTitle: "Media mensual por categoría",
  averageCategoryCaption: "Media mensual de gasto por categoría",
  averageTagTitle: "Media mensual por etiqueta",
  averageTagCaption: "Media mensual de gasto por etiqueta",
  averageCategoryEmptyTitle: "Sin gasto por categoría en la ventana",
  averageCategoryEmptyDescription:
    "Cuando la ventana contenga gasto verás aquí su media mensual por categoría.",
  averageTagEmptyTitle: "Sin gasto por etiqueta en la ventana",
  averageTagEmptyDescription:
    "Cuando etiquetes gasto dentro de la ventana verás aquí su media mensual.",
  averageColumn: "Media mensual",
  unavailableAverage: "No disponible",
  viewWindowMovements: "Ver movimientos de la ventana",
  archived: "Archivada",
  archivedOf: (label: string) => `${label} (archivada)`,
  amountColumn: "Importe",
  countColumn: "Movimientos",
  shareColumn: "Porcentaje",
  shareOfExpense: (percent: string) => `${percent} del gasto`,
  chartAlternative: "Los mismos datos están disponibles en la tabla siguiente.",
  comparisonChartLabel: "Comparación visual de ingresos y gastos",
  loading: "Cargando el resumen…",
  errorTitle: "No se ha podido cargar el resumen",
  errorHint: "Revisa la conexión e inténtalo de nuevo.",
  retry: "Reintentar",
} as const;
