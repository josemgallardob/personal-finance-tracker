# ADR 0004 — Ciclo de vida de las recurrencias y aislamiento de la demostración

- **Estado:** sustituido parcialmente
- **Fecha:** 2026-09-06
- **Responsables:** propietario del producto
- **Sustituye a:** no aplica
- **Sustituido por:** retirada del modo de demostración en producción (2026-09-10)

> Nota de vigencia: las decisiones sobre recurrencias siguen aceptadas. Las
> decisiones sobre el modo y el archivo de demostración se conservan aquí como
> registro histórico, pero dejaron de aplicar al producto en producción el
> 2026-09-10.

## Contexto

El diseño describía la generación mensual y una demostración “separada”, pero no
decía qué ocurre al borrar una entrada ya generada, al borrar el movimiento de
origen, al archivar una categoría que una regla activa sigue usando, ni al
editar o desactivar una regla que arrastra vencimientos atrasados. Tampoco
fijaba dónde viven los datos de demostración ni qué pasa al salir de ella. Sin
esas respuestas la recurrencia podía duplicar o perder movimientos según la
lectura, y la demostración podía contaminar datos personales.

## Opciones consideradas

### Tratar la entrada generada como cualquier otro movimiento

Borrarla la haría desaparecer y la siguiente ejecución volvería a crearla,
porque la única prueba de que la fecha se procesó es el propio movimiento. El
usuario vería reaparecer lo que acaba de borrar.

### Marcar el movimiento como borrado en lugar de eliminarlo

Evita la regeneración, pero conserva importe, concepto y tags de algo que el
usuario pidió eliminar, y obliga a filtrar ese estado en todas las consultas.

### Separar la constancia del vencimiento del movimiento

Guardar un registro mínimo por regla y fecha, sin datos personales y con enlace
anulable al movimiento. Borrar el movimiento vacía el enlace y la fecha queda
procesada. Cuesta una tabla nueva, pero deja el historial limpio y la generación
idempotente.

### Un archivo separado para la demostración

Un único archivo con una columna de modo sería más simple de desplegar, pero
mezcla los dos conjuntos en cada consulta y un error de filtro expone o borra
datos personales. Un archivo propio con el mismo esquema hace imposible ese
fallo.

## Decisión

Se adoptan la tercera y la cuarta opción, con estas reglas finales:

1. No se puede archivar una categoría o etiqueta usada por la plantilla de una
   regla activa; la operación se rechaza con un conflicto que identifica esa
   regla y pide editarla o desactivarla antes.
2. Eliminar una entrada generada no la vuelve a crear: se conserva la constancia
   del vencimiento, sin importe ni datos personales y con el enlace al
   movimiento anulado.
3. Eliminar el movimiento de origen no detiene la regla.
4. Duplicar una entrada generada produce un movimiento manual sin regla ni
   vencimiento asociados.
5. Un movimiento de origen admite como mucho una regla activa.
6. Desactivar una regla es irreversible desde la interfaz del MVP.
7. Antes de editar o desactivar, se generan los vencimientos pendientes hasta
   hoy con la plantilla anterior; después se aplica el cambio y la próxima fecha
   queda estrictamente en el futuro.
8. La confirmación explica cuántas entradas atrasadas se crearán y con qué
   valores; si la recuperación falla, el cambio no se aplica y el reintento no
   duplica ninguna fecha.
9. La demostración vive en un archivo SQLite propio con el mismo esquema. Lo
   selecciona una cookie de sesión que solo contiene un valor de modo acotado,
   validado en el servidor y resuelto contra dos rutas configuradas; la cookie
   nunca lleva una ruta ni un identificador de espacio de trabajo. Salir
   devuelve a los datos personales existentes sin copiarlos ni borrarlos, y si
   están vacíos se empieza de cero.
10. El reinicio actúa solo sobre la demostración, exige confirmación y se
    coordina con las escrituras en curso; la tarea de recurrencias personal no
    procesa la demostración.

### Tabla de eventos aceptada

| Evento | Antes | Después |
| --- | --- | --- |
| Eliminar una entrada generada | regla activa; vencimiento procesado y enlazado | el movimiento sale del historial y de los totales; el vencimiento sigue constando, sin importe ni enlace, y no se regenera |
| Eliminar el movimiento de origen | regla activa creada desde ese movimiento | la regla sigue activa y generando; solo desaparece ese movimiento |
| Duplicar una entrada generada | entrada enlazada a su regla | copia manual sin regla ni vencimiento; la regla no cambia |
| Archivar una clasificación usada por una regla activa | clasificación activa en uso | rechazo con conflicto que nombra la regla; nada cambia |
| Archivarla tras editar o desactivar esa regla | ninguna regla activa la usa | se archiva y el histórico conserva sus asociaciones |
| Editar una plantilla con atrasos | regla activa con fechas pendientes hasta hoy | primero se crean los atrasados con la plantilla anterior; después se guarda el cambio y la próxima fecha es futura |
| Desactivar una regla con atrasos | regla activa con fechas pendientes hasta hoy | se crean esos atrasados con la plantilla anterior; después la regla no genera nada más |
| Fallar la recuperación de atrasados | regla activa | el cambio no se aplica; la regla queda igual y el reintento no duplica fechas |
| Desactivar una regla | regla activa | deja de generar de forma irreversible; el origen y las entradas creadas permanecen |
| Entrar en la demostración | sesión sobre datos personales | la sesión pasa al archivo de demostración; los datos personales quedan intactos |
| Salir de la demostración | sesión sobre la demostración | vuelve a los datos personales existentes; si están vacíos, se empieza de cero |
| Reiniciar la demostración | archivo de demostración modificado | solo ese archivo vuelve a su contenido reproducible, previa confirmación |

### Punto de corte con el generador

La edición o desactivación toma la regla para escritura, revalida dentro de la
misma transacción los vencimientos pendientes y la versión de plantilla que vio
la interfaz, materializa los atrasados con la plantilla anterior y solo entonces
aplica el cambio. Recuperación y cambio no son dos pasos separables, de modo que
el generador no puede intercalarse entre ambos. La unicidad de regla más fecha
programada mantiene idempotente cualquier reintento.

## Consecuencias

- El esquema incorpora `RecurringOccurrence`. Es una tabla nueva, no una que el
  diseño técnico ya recogiera, y debe aparecer en su migración correspondiente.
- El borrado de un movimiento generado deja de ser un borrado completo: la
  constancia del vencimiento permanece, aunque sin datos personales.
- Archivar deja de ser siempre posible; la interfaz necesita explicar el
  conflicto y ofrecer el camino de editar o desactivar la regla.
- Editar o desactivar puede crear movimientos como efecto previo, así que la
  confirmación tiene que anunciarlos antes de ejecutarse.
- El despliegue pasa a operar con dos archivos SQLite en lugar de uno.
- Si en el futuro se permitieran reactivar reglas o recurrencias no mensuales,
  esta decisión debería sustituirse por otra ADR.

## Evidencia

Reglas trasladadas al [diseño funcional](../01-diseno-funcional.md)
—recurrencias, eventos, datos de demostración y reglas de negocio 31 a 38— y al
[diseño técnico](../02-diseno-tecnico.md) —entidad `RecurringOccurrence`,
invariantes, generación, edición o desactivación y aislamiento de la
demostración—. El propietario del producto aprobó estas reglas el 2026-09-06.
