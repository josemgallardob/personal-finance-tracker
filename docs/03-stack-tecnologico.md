# Stack tecnológico

**Estado:** aceptado v1.1

**Criterio:** entrada rápida, operación privada sencilla y consultas agregadas
fiables sin sobredimensionar el MVP.

Las versiones exactas se fijarán al crear el proyecto. Este documento define las
tecnologías; el lockfile será la fuente de verdad de versiones.

## Propuesta

| Área | Tecnología | Motivo |
| --- | --- | --- |
| Lenguaje | TypeScript estricto | Contratos verificables de extremo a extremo |
| Runtime | Node.js LTS | Ecosistema maduro y despliegue sencillo |
| Aplicación | Next.js App Router + React | UI y servidor en un único artefacto |
| Estilos | Tailwind CSS + variables CSS | Sistema visual propio e iteración rápida |
| Primitivas UI | Radix Primitives | Interacción accesible sin estética impuesta |
| Formularios | React Hook Form + Zod | Validación clara y entrada eficiente |
| Base de datos | SQLite en modo WAL | Persistencia transaccional embebida y operación mínima |
| Acceso SQL | Drizzle ORM + migraciones SQL | Tipado cercano a SQL y migraciones revisables |
| Gráficos | Recharts | Barras y series temporales integrables con React |
| Fechas | date-fns | Periodos y formato explícitos |
| Tests unitarios | Vitest | Rapidez e integración TypeScript |
| Tests UI | Testing Library | Comportamiento observable y accesibilidad |
| Tests E2E | Playwright | Navegadores reales, móvil y trazas |
| Accesibilidad | axe-core | Apoyo automatizado a la revisión manual |
| Calidad | ESLint + Prettier + TypeScript | Checks reproducibles |
| Despliegue | Docker Compose | Aplicación y volumen SQLite en servidor privado |
| Programación | Comando idempotente ejecutado por cron | Generación diaria y recuperable de recurrencias |
| Acceso remoto | VPN privada, por ejemplo Tailscale/WireGuard | Acceso móvil sin publicar la aplicación |
| CI | GitHub Actions | Verificación automatizada |

No se incorpora una librería de autenticación en el MVP. Se registrará un ADR
antes de añadir usuarios o exponer el servicio fuera de la red privada.

## Estructura prevista

```text
src/
  app/                 # rutas y composición
  modules/
    transactions/      # dominio, aplicación, infraestructura y UI
    classification/    # categorías y tags
    analytics/         # consultas del dashboard
    recurring/         # reglas mensuales y generación
    preferences/       # configuración de la instalación
  shared/              # dinero, fechas y componentes comunes
db/
  migrations/
tests/
  e2e/
docs/
```

La estructura se crea de forma incremental, sin carpetas ni abstracciones vacías.

## Entornos

- **Local:** Node LTS, archivo SQLite local y dataset mock reiniciable.
- **Test:** archivo SQLite aislado por ejecución y reloj controlable.
- **Servidor privado:** imagen inmutable, volumen SQLite persistente, proxy HTTPS,
  acceso por Tailscale y backup externo cifrado.

Se proporcionará `.env.example` sin secretos. Las variables iniciales cubrirán
la ruta del archivo SQLite, URL privada, zona horaria y configuración de backup.

## Decisiones y límites

- SQLite funciona en modo WAL sobre disco local. La aplicación mantiene
  transacciones de escritura breves, claves foráneas activas, restricciones
  únicas e índices explícitos.
- El MVP ejecuta una única instancia de aplicación. Las peticiones y el comando
  de recurrencias comparten la misma base y toleran la serialización puntual de
  escrituras.
- No existe API separada, gestor de estado global, cola ni caché distribuida; un
  comando programado basta para el volumen del MVP.
- Operaciones programa `npm run recurring:run` (por ejemplo con cron diario). El
  repositorio no instala el temporizador. El mismo comando es el que el arranque
  de la aplicación ejecuta para recuperar vencimientos omitidos; `next build` no
  abre SQLite ni lanza el generador.
- Los filtros compartibles viven en URL; formularios y estado efímero permanecen
  en cliente; los datos financieros y cálculos viven en servidor.
- Las gráficas nunca sustituyen la tabla o listado que explica una cifra.
- El tema será oscuro en el MVP; los tokens permitirán añadir tema claro después.

## Alternativas y umbrales de migración

- **libSQL:** se reconsiderará si necesitamos base remota, réplicas embebidas o
  distribución entre nodos.
- **PostgreSQL:** se adoptará si aparecen varias instancias de aplicación,
  concurrencia sostenida de escritores, operación multiusuario relevante o
  integraciones intensivas.

La capa de repositorios y las migraciones evitan dependencias SQL innecesarias de
SQLite, pero no se promete portabilidad automática: cualquier cambio de motor se
tratará como una migración explícita y probada.

## Dependencias

- Runtime LTS y versiones estables fijadas en lockfile.
- Actualizaciones automatizadas, agrupadas y verificadas por CI.
- Cada dependencia nueva debe justificar mantenimiento, licencia, tamaño cliente
  y superficie de seguridad.
- Versiones mayores y migraciones de framework se realizan en cambios aislados.
