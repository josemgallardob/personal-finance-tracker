# Documentación del proyecto

## Propósito

Esta carpeta describe qué se va a construir, cómo se comportará, cómo se
implementará y qué condiciones deberá cumplir para considerarse fiable. Si el
código y estos documentos discrepan, la discrepancia debe resolverse mediante
una decisión explícita y la documentación debe actualizarse en el mismo cambio.

## Mapa documental

| Documento                                                              | Pregunta que responde                                           | Estado           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------- |
| [Diseño funcional](01-diseno-funcional.md)                             | ¿Qué problema resuelve y qué puede hacer el usuario?            | Aceptado v1.9    |
| [Diseño técnico](02-diseno-tecnico.md)                                 | ¿Cómo se organiza el sistema y sus datos?                       | Aceptado v1.9    |
| [Stack tecnológico](03-stack-tecnologico.md)                           | ¿Con qué tecnologías y por qué?                                 | Aceptado v1.1    |
| [Diseño visual y UX](04-diseno-visual-ux.md)                           | ¿Cómo se ve, se entiende y se utiliza?                          | Aceptado v1.6    |
| [Referencia visual](design/references/revolut/README.md)               | ¿Qué materiales visuales inspiran el sistema y cómo se adaptan? | Referencia local |
| [Tests y QA](05-tests-qa.md)                                           | ¿Cómo demostramos que funciona y es seguro cambiarlo?           | Aceptado v1.8    |
| [Plan de implementación](06-plan-implementacion.md)                    | ¿En qué orden lo construiremos y qué valida cada fase?          | Aceptado v1.1    |
| [Flujo de colaboración entre agentes](agent-collaboration-workflow.md) | ¿Cómo se coordinan áreas, worktrees, tareas, PR y estados?      | Activo           |
| [Registro de decisiones](adr/README.md)                                | ¿Por qué se tomaron las decisiones difíciles de revertir?       | Activo           |

## Decisiones del MVP

- Uso personal y un usuario implícito, preparado mediante un workspace para una
  futura segunda persona y finanzas compartidas.
- Una sola bolsa de dinero, sin cuentas ni saldos.
- Registro manual de ingresos y gastos en EUR, con categorías, tags y
  recurrencias mensuales opcionales.
- Dashboard mensual con estadísticas sobre todo el histórico.
- Aplicación responsive en español, formato `dd/mm/yyyy`, zona horaria
  `Europe/Madrid` y tema oscuro.
- Servidor privado accesible desde móvil mediante red de confianza o VPN.
- Sin autenticación, CSV, sincronización bancaria ni exportación en el MVP.

## Convenciones

- **MVP**: alcance mínimo que ya resuelve el ciclo registrar → revisar → decidir.
- **Después**: funcionalidad valiosa que no bloquea ese ciclo.
- **Fuera de alcance**: no se diseña ni implementa salvo cambio de decisión.
- Los importes se almacenan en unidades mínimas enteras (céntimos), nunca en
  punto flotante.
- Las fechas de negocio son locales; las marcas de tiempo técnicas se guardan
  en UTC.
- Las decisiones difíciles de revertir se registrarán en `docs/adr/` mediante
  ADR (Architecture Decision Records).

## Gestión de cambios

Cada cambio funcional debe indicar:

1. Requisito o historia afectada.
2. Criterios de aceptación.
3. Cambio de datos/API, si existe.
4. Pruebas añadidas o modificadas.
5. Impacto en accesibilidad, privacidad y migraciones.

Los estados documentales son `borrador`, `aceptado`, `sustituido` y `obsoleto`.
