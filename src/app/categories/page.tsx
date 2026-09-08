import { ClassificationList } from "../../modules/classification/ui/classification-list";

export default function CategoriesPage() {
  return (
    <section
      aria-labelledby="categories-title"
      className="flex w-full max-w-3xl min-w-0 flex-col gap-6"
    >
      <header className="flex w-full max-w-full min-w-0 flex-col gap-2">
        <h1
          id="categories-title"
          className="text-heading-sm text-text font-medium"
        >
          Categorías
        </h1>
        <p className="text-body text-text-muted max-w-xl">
          Revisa las categorías de gasto e ingreso y las etiquetas que dan
          contexto a tus movimientos.
        </p>
      </header>
      <ClassificationList />
    </section>
  );
}
