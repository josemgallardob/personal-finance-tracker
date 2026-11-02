# Plan de implementación

**Estado:** aceptado v1.1

**Estrategia:** construir el recorrido registrar → automatizar → ver actualización
→ entender detalle, mediante entregas verticales utilizables.

Las fases indican dependencias, no fechas.

## Fase 0 — Prototipo y decisiones

- Incorporar las convenciones visuales inspiradas en Revolut que facilite el
  propietario.
- Prototipar alta rápida móvil, dashboard e historial filtrado.
- Validar en menos de 15 segundos el alta con cuatro campos.
- Registrar ADR de SQLite, workspace implícito y despliegue sin autenticación.
- Configurar `Europe/Madrid` y definir el mecanismo VPN elegido.

**Salida:** prototipo validado y decisiones difíciles de revertir documentadas.

## Fase 1 — Cimientos y clasificación

- Crear proyecto, SQLite en modo WAL, migraciones, CI y configuración.
- Configurar GitHub Actions para ejecutar los checks completos en PRs dirigidos a
  `main` y, cuando exista, a `stable`, con umbrales obligatorios de cobertura.
- No añadir workflows hasta comenzar la implementación.
- Implementar workspace implícito, preferencias, categorías y tags.
- Cargar categorías iniciales e iconos/colores automáticos.
- Preparar Docker Compose y acceso solo por red privada.

**Validación:** instalación limpia con catálogo inicial, tanto en escritorio como
en móvil.

## Fase 2 — Registro rápido e historial

- Crear ingreso/gasto con cuatro campos obligatorios.
- Añadir concepto, nota y múltiples tags opcionales.
- Editar, duplicar y eliminar con confirmación.
- Listar por cursor, buscar y filtrar con scroll progresivo.
- Filtrar el historial por fechas diarias exactas e inclusivas, separado de los
  periodos mensuales del dashboard.
- Completar estados de carga, vacío, error y sin resultados.

**Demostración:** registrar un gasto desde móvil en menos de 15 segundos y
encontrarlo mediante categoría y tags.

## Fase 3 — Dashboard trazable

- Tarjetas de ingresos, gastos y balance.
- Comparación con periodo anterior y evolución mensual.
- Gastos por categoría y etiquetas.
- Movimientos recientes y selector de periodo.
- Navegación desde cada métrica al historial filtrado.
- Actualización inmediata tras cada mutación.
- Medias mensuales de gasto, categorías, tags y balance sobre hasta 12 meses
  completos, con intervalo y estado sin histórico.
- Selectores múltiples de categorías/tags con acciones todas/ninguna.
- Tratamiento semántico discreto verde/rojo para ingresos, gastos y balance.

**Demostración:** cambiar un movimiento y observar el recálculo correcto de todas
sus representaciones sin recargar manualmente.

## Fase 4 — Recurrencias mensuales

- Marcar un ingreso o gasto como recurrente y elegir día mensual.
- Añadir pestaña de plantillas con edición y desactivación.
- Ejecutar generación diaria idempotente y recuperación al arrancar.
- Cubrir meses cortos, años bisiestos, reinicios y ejecuciones concurrentes.
- Identificar los movimientos generados sin tratarlos como previsiones.

**Demostración:** generar una única entrada aunque la tarea se ejecute dos veces,
recuperar un vencimiento omitido y detener futuras copias sin borrar el histórico.

## Fase 5 — Endurecimiento

- Probar 100 000 movimientos y optimizar consultas/índices medidos.
- Completar accesibilidad, navegadores y revisión responsive.
- Configurar backup cifrado y demostrar restauración.
- Revisar exposición de red, cabeceras, logs, secretos y dependencias.
- Documentar instalación, actualización y reversión.

**Demostración:** desplegar en servidor privado, acceder por móvil y restaurar una
copia manteniendo movimientos, tags y totales.

## Después del MVP

Se priorizará con evidencia de uso:

1. exportación y portabilidad;
2. importación CSV;
3. segundo miembro y finanzas compartidas;
4. autenticación si cambia la exposición;
5. sincronización bancaria;
6. cuentas, saldos y transferencias;
7. presupuestos, objetivos y recurrencias con frecuencias más complejas.

Este orden es orientativo y no introduce estas funciones en el esquema actual
salvo el límite de `workspace_id`.

## Definición de MVP

El MVP termina cuando F-01 a F-15 funcionan, el registro móvil cumple el objetivo
de tiempo, el dashboard usa todo el histórico, la red privada está verificada y
un backup se ha restaurado con éxito.
