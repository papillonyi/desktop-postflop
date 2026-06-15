type PlaceholderPageProps = {
  title: string;
};

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
      {title}
    </div>
  );
}
