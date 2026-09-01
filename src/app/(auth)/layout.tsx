/**
 * Centred card for the sign-in and sign-up pages. No sidebar: there is nothing
 * to navigate to yet, and the page should have one obvious thing to do.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
      {children}
    </div>
  );
}
