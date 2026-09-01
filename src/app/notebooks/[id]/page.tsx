import { redirect } from 'next/navigation';

export default async function NotebookIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/notebooks/${id}/design`);
}
