import { NotebookDetail } from '@/components/community/NotebookDetail';

export const metadata = { title: 'Notebook — nb-make' };

export default async function CommunityNotebookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Fetched on the client so the like/save/rating state can be re-read after
  // each action without a round trip through the server component.
  return <NotebookDetail id={id} />;
}
