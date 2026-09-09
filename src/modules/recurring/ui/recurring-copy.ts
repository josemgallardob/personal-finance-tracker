/**
 * Spanish copy of the Recurrentes tab and its management dialogs.
 *
 * The identifiers stay in English; every visible string is Spanish, as the
 * language policy of the repository requires.
 */

export const recurringCopy = {
  addTransaction: "Añadir movimiento",
  amountLabel: "Importe",
  cancel: "Cancelar",
  catchUpNone: "No hay entradas atrasadas pendientes.",
  catchUpOne: "Se creará 1 entrada atrasada con la plantilla actual:",
  catchUpMany: (total: number) =>
    `Se crearán ${total} entradas atrasadas con la plantilla actual:`,
  catchUpLoading: "Comprobando entradas atrasadas…",
  catchUpUnavailable:
    "No se han podido comprobar las entradas atrasadas. Al guardar se crearán igualmente las que estén pendientes.",
  createdNone: "Cambio guardado. No había entradas atrasadas.",
  createdOne: "Se ha creado 1 entrada atrasada con la plantilla anterior.",
  createdMany: (total: number) =>
    `Se han creado ${total} entradas atrasadas con la plantilla anterior.`,
  deactivateConfirm: "Desactivar definitivamente",
  deactivateDescription:
    "Dejará de crear copias nuevas. El movimiento original y las entradas ya creadas se conservan en el historial y en los totales.",
  deactivateError: "No se ha podido desactivar la recurrencia.",
  deactivateIrreversible:
    "Esta acción no se puede deshacer desde la aplicación: no podrás volver a activarla, tendrás que crear otra recurrencia.",
  deactivateTitle: "¿Desactivar esta recurrencia?",
  deactivateAction: "Desactivar",
  deactivateActionOf: (label: string) => `Desactivar ${label}`,
  editAction: "Editar",
  editActionOf: (label: string) => `Editar ${label}`,
  editDescription:
    "Los cambios afectan solo a las próximas generaciones. Las entradas ya creadas se conservan tal y como están.",
  editError: "No se ha podido guardar la recurrencia.",
  editTitle: "Editar recurrencia",
  emptyDescription:
    "Marca “Repetir cada mes” al añadir un movimiento, o actívalo desde uno existente en la pestaña Todos.",
  emptyTitle: "Aún no hay recurrencias activas",
  errorHint: "Revisa la conexión e inténtalo de nuevo.",
  errorTitle: "No se han podido cargar las recurrencias",
  expenseType: "Gasto",
  expensesGroup: "Gastos recurrentes",
  fallbackLabel: "Movimiento recurrente",
  incomeType: "Ingreso",
  incomesGroup: "Ingresos recurrentes",
  listLabel: "Recurrencias activas",
  loading: "Cargando recurrencias…",
  loadError: "No se ha podido cargar esta recurrencia.",
  monthlyDayField: "Día del mes",
  monthlyDayHint:
    "Del 1 al 31. En los meses que no tienen ese día se usa el último día del mes.",
  monthlyDayLabel: (day: number) => `Día ${day} de cada mes`,
  nextDueLabel: (date: string) => `Próxima: ${date}`,
  noTags: "Sin etiquetas",
  retry: "Reintentar",
  save: "Guardar cambios",
  shortMonthNote: "En febrero y en los meses de 30 días se usa el último día.",
  tagsLabel: "Etiquetas",
} as const;

/** Guidance shown when the server refuses a recurrence change. */
export const recurringConflictCopy = {
  alreadyDeactivated:
    "Esta recurrencia ya está desactivada. Actualiza la lista para verla al día.",
  categoryArchived:
    "La categoría de la plantilla está archivada. Elige una categoría activa para poder guardar, o desactiva la recurrencia.",
  categoryIncompatible:
    "Esa categoría no corresponde al tipo elegido. Cambia el tipo o elige una categoría del mismo tipo.",
  categoryNotFound:
    "La categoría de la plantilla ya no existe. Elige otra categoría antes de guardar.",
  staleTemplate:
    "La recurrencia ha cambiado desde que abriste esta ventana. Ciérrala y vuelve a abrirla para no sobrescribir el cambio anterior.",
  tagUnavailable:
    "Alguna etiqueta de la plantilla ya no se puede asignar. Quítala o elige otra antes de guardar.",
  unavailable:
    "El servicio no está disponible ahora mismo. Vuelve a intentarlo en unos minutos; no se ha aplicado ningún cambio.",
} as const;
