import { NotebookWorkspace } from '@/components/NotebookWorkspace';

export default async function NotebookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The notebook itself lives in browser storage, so all this layer does is
  // hand the id to the client.
  return <NotebookWorkspace id={id}>{children}</NotebookWorkspace>;
}
