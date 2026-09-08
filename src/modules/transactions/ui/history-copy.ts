/**
 * Spanish copy of the movement history and its Todos/Recurrentes tabs.
 */

export const historyCopy = {
  actions: "Acciones",
  actionsOf: (label: string) => `Acciones de ${label}`,
  allTab: "Todos",
  amountColumn: "Importe",
  caption: "Historial de movimientos",
  categoryColumn: "Categoría",
  conceptColumn: "Concepto",
  dateColumn: "Fecha",
  deleteAction: "Eliminar",
  description:
    "Consulta tus ingresos y gastos. Los más recientes aparecen primero.",
  duplicateAction: "Duplicar",
  editAction: "Editar",
  errorHint: "Revisa la conexión e inténtalo de nuevo.",
  errorTitle: "No se ha podido cargar el historial",
  expense: "Gasto",
  fallbackLabel: "Movimiento",
  filtersLabel: "Filtros del historial",
  income: "Ingreso",
  loading: "Cargando movimientos…",
  noTags: "Sin etiquetas",
  recurringDescription:
    "Las plantillas mensuales aparecerán en esta pestaña cuando la recurrencia esté lista.",
  recurringTab: "Recurrentes",
  recurringTitle: "Recurrencias aún no disponibles",
  retry: "Reintentar",
  searchLabel: "Buscar",
  searchPlaceholder: "Concepto o nota",
  tagsColumn: "Etiquetas",
  tagsFilterLabel: "Etiquetas",
  tagsFilterTitle: "Filtrar por etiquetas",
  typeAll: "Todos los tipos",
  typeLabel: "Tipo",
  categoryAll: "Todas las categorías",
  categoryLabel: "Categoría",
  chipsLabel: "Filtros activos",
  clearFilters: "Quitar todos",
  removeFilter: (label: string) => `Quitar filtro ${label}`,
  searchChip: (query: string) => `Búsqueda: ${query}`,
  tabsLabel: "Secciones de movimientos",
} as const;

/** Query value of the Todos history tab. */
export const HISTORY_ALL_TAB = "all";

/** Query value of the Recurrentes tab. */
export const HISTORY_RECURRING_TAB = "recurring";

export type HistoryTab = typeof HISTORY_ALL_TAB | typeof HISTORY_RECURRING_TAB;

/**
 * Reads the history tab from a URL query value.
 *
 * Anything other than `recurring` is Todos, including a missing or repeated
 * parameter, so `/transactions` and `/transactions?tab=all` show the same list.
 */
export function readHistoryTab(
  value: string | readonly string[] | undefined,
): HistoryTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === HISTORY_RECURRING_TAB
    ? HISTORY_RECURRING_TAB
    : HISTORY_ALL_TAB;
}
