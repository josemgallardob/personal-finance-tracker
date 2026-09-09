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
  loading: "Cargando el resumen…",
  errorTitle: "No se ha podido cargar el resumen",
  errorHint: "Revisa la conexión e inténtalo de nuevo.",
  retry: "Reintentar",
} as const;
