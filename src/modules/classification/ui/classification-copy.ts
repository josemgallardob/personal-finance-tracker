/**
 * Spanish copy and failure wording of the classification management view.
 *
 * The transport distinguishes a refusal the server explained, a request that
 * never reached it, a body that is not the contract and a call the view itself
 * cancelled. Each of those needs different wording: only the first one carries
 * a message written for the owner, and the other three would otherwise be
 * rendered as an empty error. Keeping the mapping here lets the list component
 * stay about layout and state.
 */

import type { ApiClientFailure } from "../../../shared/client/api-client";

/** User-visible strings of the classification view. */
export const classificationCopy = {
  categoriesTitle: "Categorías",
  categoriesLoading: "Cargando categorías…",
  categoriesErrorTitle: "No se han podido cargar las categorías.",
  categoriesRetryLabel: "Reintentar la carga de categorías",
  categoriesEmptyTitle: "Aún no hay categorías",
  categoriesEmptyDescription:
    "Crea tu primera categoría para clasificar tus gastos e ingresos.",
  expenseTitle: "Gastos",
  expenseEmpty: "Aún no hay categorías de gasto.",
  incomeTitle: "Ingresos",
  incomeEmpty: "Aún no hay categorías de ingreso.",
  categoriesArchivedNote:
    "Las categorías archivadas conservan su histórico y no pueden asignarse a nuevos movimientos.",
  tagsTitle: "Etiquetas",
  tagsLoading: "Cargando etiquetas…",
  tagsErrorTitle: "No se han podido cargar las etiquetas.",
  tagsRetryLabel: "Reintentar la carga de etiquetas",
  tagsEmptyTitle: "Aún no hay etiquetas",
  tagsEmptyDescription:
    "Las etiquetas se crean al escribirlas en un movimiento y añaden contexto a cualquier categoría.",
  tagsArchivedNote:
    "Las etiquetas archivadas conservan su histórico y no pueden añadirse a nuevos movimientos.",
  archivedBadge: "Archivada",
  retry: "Reintentar",
  createCategory: "Crear categoría",
  createTag: "Crear etiqueta",
  renameAction: "Renombrar",
} as const;

/** Accessible name of the control that opens the category rename dialog. */
export function renameCategoryLabel(name: string): string {
  return `Renombrar ${name}`;
}

/** Accessible name of the control that opens the tag rename dialog. */
export function renameTagLabel(name: string): string {
  return `Renombrar ${name}`;
}

/** Wording of every failure the transport can hand to the view. */
export const classificationFailureCopy = {
  network:
    "No hemos podido conectar con la aplicación. Comprueba la conexión e inténtalo de nuevo.",
  invalidResponse:
    "La respuesta recibida no tiene el formato esperado. Inténtalo de nuevo.",
  aborted: "La carga se ha interrumpido. Inténtalo de nuevo.",
} as const;

/**
 * Returns the Spanish sentence that explains a failed load.
 *
 * A refusal answered by the server already carries generic Spanish copy that
 * describes the exact class of problem, so it is preferred over any wording
 * this module could invent.
 */
export function classificationFailureMessage(
  failure: ApiClientFailure,
): string {
  switch (failure.reason) {
    case "api":
      return failure.error.message;
    case "invalidResponse":
      return classificationFailureCopy.invalidResponse;
    case "aborted":
      return classificationFailureCopy.aborted;
    default:
      return classificationFailureCopy.network;
  }
}

/**
 * Summarises how many items of a section are still assignable and how many
 * are archived, so the state is available as text and not only as a badge.
 */
export function activeArchivedSummary(
  active: number,
  archived: number,
): string {
  const activeLabel = active === 1 ? "activa" : "activas";
  const archivedLabel = archived === 1 ? "archivada" : "archivadas";

  return `${active} ${activeLabel} · ${archived} ${archivedLabel}`;
}
